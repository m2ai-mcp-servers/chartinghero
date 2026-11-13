/**
 * FHIR read path: patient search, patient resolution and visit history (plan 3.4).
 *
 * Server answers are checked, not trusted. R4 lets a server ignore a search parameter it
 * does not support, so every filter that matters is applied again on the client, and an
 * identifier lookup only counts when the returned resource really carries the identifier.
 */

import { createHash } from 'node:crypto';

import type {
  Bundle,
  DocumentReference,
  Encounter,
  FhirResource,
  Observation,
  Patient as FhirPatient,
} from 'fhir/r4.js';

import { CATEGORY, CLASS_HOME_HEALTH, CODE, identifierSystems, LOINC } from '../../fhir/codes.js';
import { fromFhirPatient } from '../../fhir/patient.js';
import { localDateOf, localDateTime, nextDate } from '../../fhir/time.js';
import { toSearchResult } from '../../mappers/dto.js';
import { VISIT_TYPES } from '../../schemas/common.js';
import { ApiError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { decodeCursor, encodeCursor } from '../cursor.js';
import { parseNameQuery } from '../query.js';
import type {
  Patient,
  PatientHistoryParams,
  PatientHistoryResponse,
  PatientSearchParams,
  PatientSearchResponse,
  VisitNoteSummary,
  VisitStatus,
  VisitType,
} from '../../types/index.js';
import type { ServerCapabilities } from './capabilities.js';
import { escapeSearchValue, FHIR_ID } from './client.js';
import type { FhirClient, SearchParams } from './client.js';

export interface ReadDeps {
  client: FhirClient;
  caps: ServerCapabilities;
  /** FHIR_IDENTIFIER_SYSTEM base (Q2). */
  identifierSystem: string;
}

type SearchCursor = {
  k: 'search';
  /** The searches this page is cut from. */
  urls: string[];
  /** How many of their merged results earlier pages already returned. */
  skip: number;
  /**
   * Short hashes of patients listed from earlier searches, so one that two queries match is
   * listed once. Empty when one query ran: a server's own pages do not overlap.
   */
  seen: string[];
  /** How many results those earlier searches gave. */
  n: number;
  /** One query ran, so Bundle.total is this search's total. */
  one: boolean;
  status?: string;
};
type HistoryCursor = {
  k: 'history';
  url: string;
  pid: string;
  mode: 'encounter' | 'documents';
  limit: number;
  start?: string;
  end?: string;
  type?: VisitType;
  /** The first page's total, when the server's count could be trusted. */
  total?: number;
  /** How many visits earlier pages returned. */
  n: number;
  /** Documents mode: short hashes of visits already listed, so notes on a later page do not list one twice. */
  keys?: string[];
};

/** A cursor is capped at 8192 chars (schemas/read-tools.ts), so what it remembers is hashed and bounded. */
const REMEMBER_MAX = 300;
const shortHash = (value: string) => createHash('sha256').update(value).digest('base64url').slice(0, 8);

/**
 * A FHIR dateTime may be a bare date, month or year. This is its first or last millisecond
 * in the practice's zone; a full dateTime is itself.
 */
function edgeMs(value: string | undefined, edge: 'start' | 'end', timezone: string): number {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value ?? '');
  if (!m) return Date.parse(value ?? '');
  const [, y, mo, d] = m;
  const first = `${y}-${mo ?? '01'}-${d ?? '01'}`;
  if (edge === 'start') return Date.parse(localDateTime(first, '00:00', timezone));
  const after = d
    ? nextDate(first)
    : mo && mo !== '12'
      ? `${y}-${String(Number(mo) + 1).padStart(2, '0')}-01`
      : `${String(Number(y) + 1).padStart(4, '0')}-01-01`;
  return Date.parse(localDateTime(after, '00:00', timezone)) - 1;
}

/** The local calendar day of a dateTime. A bare date is that day; a bare month or year has none. */
function localDay(value: string | undefined, timezone: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}(-\d{2})?$/.test(value)) return '';
  return localDateOf(value, timezone) ?? '';
}

/** Resources the server matched, as opposed to ones it included or an OperationOutcome. */
function matches<T extends FhirResource>(bundle: Bundle, type: T['resourceType']): T[] {
  return (bundle.entry ?? [])
    .filter((e) => e.search?.mode !== 'include' && e.search?.mode !== 'outcome')
    .map((e) => e.resource)
    .filter((r): r is T => r?.resourceType === type);
}

function included<T extends FhirResource>(bundle: Bundle, type: T['resourceType']): T[] {
  return (bundle.entry ?? []).map((e) => e.resource).filter((r): r is T => r?.resourceType === type);
}

const link = (bundle: Bundle, relation: string) => bundle.link?.find((l) => l.relation === relation)?.url;

/** Search parameter names the server says it applied (R4: the self link lists them). */
export function appliedParams(bundle: Bundle): Set<string> {
  const self = link(bundle, 'self');
  if (!self) return new Set();
  try {
    return new Set([...new URL(self, 'http://self.invalid').searchParams.keys()].map((k) => k.split(':')[0]));
  } catch {
    return new Set();
  }
}

/** "Encounter/12" from a relative or absolute reference. */
function localRef(reference: string | undefined, type: string): string | undefined {
  const m = reference ? new RegExp(`(?:^|/)${type}/([A-Za-z0-9\\-.]{1,64})(?:/_history/[^/]+)?$`).exec(reference) : null;
  return m ? `${type}/${m[1]}` : undefined;
}

// ---------------------------------------------------------------------------
// Patient search and resolution
// ---------------------------------------------------------------------------

export async function searchPatients(deps: ReadDeps, params: PatientSearchParams): Promise<PatientSearchResponse> {
  const { client } = deps;
  const limit = params.limit ?? 10;

  let state: Omit<SearchCursor, 'k'>;
  if (params.cursor) {
    state = decodeCursor<SearchCursor>(params.cursor, 'search');
  } else {
    if (params.status === 'discharged' || params.status === 'pending') {
      throw new ValidationError('a FHIR Patient is only active or inactive; filter by one of those', 'status');
    }
    const queries = patientQueries(deps, params.query.trim(), params.searchType ?? 'all');
    state = {
      // A merge that spans pages re-runs these searches, so ask for a stable order.
      urls: queries.map((q) => client.searchUrl('Patient', [...q, ['_sort', '_id'], ['_count', String(limit)]])),
      skip: 0,
      seen: [],
      n: 0,
      one: queries.length === 1,
      status: params.status,
    };
  }
  const { urls, skip, status } = state;
  const bundles = await Promise.all(urls.map((u) => client.follow(u)));

  const seen = new Set(state.seen);
  const merged: Patient[] = [];
  for (const bundle of bundles) {
    for (const resource of matches<FhirPatient>(bundle, 'Patient')) {
      if (!resource.id) continue;
      const key = shortHash(resource.id);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(fromFhirPatient(resource, deps.identifierSystem));
    }
  }
  const kept = status ? merged.filter((p) => p.status === status) : merged;
  const page = kept.slice(skip, skip + limit);

  // Several queries, or a cursor used with a smaller limit, can match more than one page
  // holds: the rest of this merge comes first, then the servers' own next pages.
  // A next link that points at the page just read would never end.
  const links = bundles.map((b) => link(b, 'next')).filter((u): u is string => !!u && !urls.includes(u));
  // Only several queries can list one patient twice. Past the cap the earliest are kept:
  // the short queries end first, so that is where the overlap is.
  const remembered = state.one ? [] : [...seen].slice(0, REMEMBER_MAX);
  const next: Omit<SearchCursor, 'k'> | undefined =
    kept.length > skip + limit
      ? { ...state, skip: skip + limit }
      : links.length > 0
        ? { urls: links, skip: 0, seen: remembered, n: state.n + kept.length, one: state.one, status }
        : undefined;

  // Bundle.total is optional, and is only this search's total when one query ran unfiltered.
  const soFar = state.n + kept.length;
  const serverTotal = state.one && !status ? bundles[0]?.total : undefined;
  const exact = typeof serverTotal === 'number' && serverTotal >= soFar;
  return {
    // The PT identifier is what a nurse says; the server id is what later calls use.
    results: page.map((p) => ({ ...toSearchResult(p), ...(p.id.mrn ? { identifier: p.id.mrn } : {}) })),
    total: exact ? serverTotal : soFar,
    ...(!exact && links.length > 0 ? { totalIsLowerBound: true } : {}),
    limit,
    offset: 0,
    hasMore: !!next,
    ...(next ? { nextCursor: encodeCursor({ k: 'search', ...next } satisfies SearchCursor) } : {}),
  };
}

/** Digits and phone punctuation only, so an identifier or a name is not sent as a phone number. */
const looksLikePhone = (query: string) => /^\+?[\d\s().-]+$/.test(query) && query.replace(/\D/g, '').length >= 4;

function patientQueries(deps: ReadDeps, query: string, searchType: NonNullable<PatientSearchParams['searchType']>): SearchParams[] {
  const sys = identifierSystems(deps.identifierSystem).patientId;
  const byIdentifier: SearchParams = [['identifier', `${sys}|${escapeSearchValue(query)}`]];
  const byId: SearchParams[] = FHIR_ID.test(query) ? [[['_id', query]]] : [];

  const name = parseNameQuery(query);
  // Repeating `name` ANDs the words, so "Jane Marple" and "Marple, Jane" both match.
  const byName: SearchParams[] =
    name.tokens.length > 0
      ? [[
          ...name.tokens.map((t) => ['name', escapeSearchValue(t)] as const),
          ...(name.birthDate ? [['birthdate', name.birthDate] as const] : []),
        ]]
      : [];
  // A phone is a token: it matches as stored. Ask for the digits-only spelling as well.
  const phones = [...new Set([query, query.replace(/\D/g, '')])].filter(Boolean);
  const byPhone: SearchParams = [['phone', phones.map(escapeSearchValue).join(',')]];

  switch (searchType) {
    case 'id':
      return [byIdentifier, ...byId];
    case 'name':
      if (byName.length === 0) throw new ValidationError('a name search needs at least one name', 'query');
      return byName;
    case 'phone':
      if (!deps.caps.patientPhoneSearch) {
        throw new ValidationError('phone search unsupported by this server', 'searchType');
      }
      return [byPhone];
    case 'all':
      return [
        byIdentifier,
        ...byId,
        ...byName,
        ...(deps.caps.patientPhoneSearch && looksLikePhone(query) ? [byPhone] : []),
      ];
  }
}

/**
 * Resolve a tool-supplied patient id to one FHIR Patient. It may be a `PT-xxxxx`
 * identifier or a server id; the identifier is tried first and must match exactly one
 * patient (plan 3.1).
 */
export async function resolvePatient(deps: ReadDeps, patientId: string): Promise<FhirPatient & { id: string }> {
  const byIdentifier = await findByIdentifier(deps, patientId);
  if (byIdentifier) return byIdentifier;
  return readPatient(deps, patientId);
}

export async function findByIdentifier(deps: ReadDeps, value: string): Promise<(FhirPatient & { id: string }) | undefined> {
  const system = identifierSystems(deps.identifierSystem).patientId;
  const bundle = await deps.client.search('Patient', [
    ['identifier', `${system}|${escapeSearchValue(value)}`],
    ['_count', '2'],
  ]);
  // A server that ignored `identifier` returns arbitrary patients: count only real hits.
  const hits = matches<FhirPatient>(bundle, 'Patient').filter(
    (p): p is FhirPatient & { id: string } =>
      !!p.id && (p.identifier ?? []).some((i) => i.system === system && i.value === value)
  );
  if (hits.length > 1 || (hits.length === 1 && link(bundle, 'next'))) {
    throw new ValidationError('this patient identifier matches more than one patient; use the server id', 'patientId');
  }
  return hits[0];
}

export async function readPatient(deps: ReadDeps, id: string): Promise<FhirPatient & { id: string }> {
  try {
    // client.read refuses an id that is not a FHIR id (as 404) before building a URL.
    const patient = await deps.client.read<FhirPatient>('Patient', id);
    // The id in the answer must be the one asked for.
    if (patient.id !== id) throw new ApiError(200, ['structure']);
    return patient as FhirPatient & { id: string };
  } catch (error) {
    if (error instanceof ApiError && (error.httpStatus === 404 || error.httpStatus === 410)) {
      throw new NotFoundError('Patient');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Visit history
// ---------------------------------------------------------------------------

interface Visit {
  summary: VisitNoteSummary;
  /** Sort key: the visit start instant. */
  startMs: number;
  period?: { start?: string; end?: string };
  hasLinkedVitals: boolean;
}

const VITAL_CODES: ReadonlySet<string> = new Set(
  [
    CODE.bloodPressurePanel, CODE.heartRate, CODE.respiratoryRate, CODE.bodyTemperature,
    CODE.pulseOx, CODE.o2Sat, CODE.bodyWeight, CODE.painScore, CODE.glucose,
  ].map((c) => c.code!)
);

function isVital(o: Observation): boolean {
  const category = (o.category ?? []).some((c) =>
    (c.coding ?? []).some((x) => x.system === CATEGORY.vitalSigns.system && x.code === CATEGORY.vitalSigns.code)
  );
  const code = (o.code?.coding ?? []).some((x) => x.system === LOINC && !!x.code && VITAL_CODES.has(x.code));
  return o.status !== 'entered-in-error' && (category || code);
}

function minutesBetween(period: { start?: string; end?: string } | undefined): number {
  const ms = Date.parse(period?.end ?? '') - Date.parse(period?.start ?? '');
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : 0;
}

/** Signing lives on the note (plan 3.3): an unsigned note means the visit awaits review. */
function noteStatus(notes: DocumentReference[]): VisitStatus | undefined {
  const current = notes.filter((n) => n.status === 'current');
  if (current.some((n) => n.docStatus === 'preliminary')) return 'pending_review';
  if (current.some((n) => n.docStatus === 'final' || n.docStatus === 'amended')) return 'completed';
  return undefined;
}

const ENCOUNTER_STATUS: Readonly<Record<string, VisitStatus>> = {
  planned: 'scheduled',
  arrived: 'in_progress',
  triaged: 'in_progress',
  'in-progress': 'in_progress',
  onleave: 'in_progress',
  finished: 'completed',
  cancelled: 'cancelled',
  // `unknown`, or a code this build does not know: someone has to look at it.
};

function visitTypeOf(encounter: Encounter, system: string): VisitType {
  for (const type of encounter.type ?? []) {
    for (const coding of type.coding ?? []) {
      if (coding.system === system && (VISIT_TYPES as readonly string[]).includes(coding.code ?? '')) {
        return coding.code as VisitType;
      }
    }
  }
  return 'other';
}

function isHomeHealth(encounter: Encounter): boolean {
  const c = encounter.class;
  return c?.code === CLASS_HOME_HEALTH.code && (!c.system || c.system === CLASS_HOME_HEALTH.system);
}

function isNurseNote(doc: DocumentReference): boolean {
  return (doc.type?.coding ?? []).some((c) => c.system === LOINC && c.code === CODE.nurseNote.code);
}

export async function getPatientHistory(
  deps: ReadDeps,
  params: PatientHistoryParams,
  timezone: string
): Promise<PatientHistoryResponse> {
  const { client, caps } = deps;
  const patient = await resolvePatient(deps, params.patientId);
  const domain = fromFhirPatient(patient, deps.identifierSystem);
  // `patient=` is asked for on every query and checked again on every answer.
  const patientRef = `Patient/${patient.id}`;
  const isForPatient = (ref: { reference?: string } | undefined) => localRef(ref?.reference, 'Patient') === patientRef;

  // A cursor carries the filters and page size it was issued with, so every page applies the same ones.
  let cursor: HistoryCursor | undefined;
  if (params.cursor) {
    cursor = decodeCursor<HistoryCursor>(params.cursor, 'history');
    if (cursor.pid !== patient.id) {
      throw new ValidationError('cursor belongs to a different patient; repeat the request without it', 'cursor');
    }
  }
  const limit = cursor?.limit ?? params.limit ?? 10;
  const start = cursor ? cursor.start : params.startDate;
  const end = cursor ? cursor.end : params.endDate;
  const visitType = cursor ? cursor.type : params.visitType;
  // Without Encounter search or _revinclude, fall back to the US Core SHALL note query.
  const mode = cursor?.mode ?? (caps.encounterSearch && caps.encounterRevIncludes ? 'encounter' : 'documents');

  if (mode === 'documents' && visitType) {
    throw new ValidationError('this server cannot filter visits by type', 'visitType');
  }

  const from: SearchParams = start ? [['date', `ge${localDateTime(start, '00:00', timezone)}`]] : [];
  const until: SearchParams = end ? [['date', `lt${localDateTime(nextDate(end), '00:00', timezone)}`]] : [];
  const systems = identifierSystems(deps.identifierSystem);

  let bundle: Bundle;
  let visits: Visit[];
  let matched: number;
  let serverFiltered: boolean;
  let keys: string[] | undefined;
  if (mode === 'encounter') {
    const sentClass = caps.encounterClassSearch;
    const sentType = !!visitType && caps.encounterTypeSearch;
    bundle = cursor
      ? await client.follow(cursor.url)
      : await client.search('Encounter', [
          ['patient', patient.id],
          ...(sentClass ? [['class', `${CLASS_HOME_HEALTH.system}|${CLASS_HOME_HEALTH.code}`] as const] : []),
          ...(sentType ? [['type', `${systems.visitType}|${visitType}`] as const] : []),
          ...from,
          ...until,
          ['_sort', '-date'],
          ['_count', String(limit)],
          ['_revinclude', 'Observation:encounter'],
          ['_revinclude', 'DocumentReference:encounter'],
        ]);
    const applied = appliedParams(bundle);
    serverFiltered =
      sentClass &&
      applied.has('class') &&
      (!visitType || (sentType && applied.has('type'))) &&
      ((!start && !end) || applied.has('date'));

    // What the server included is checked like what it matched: this patient's, and the right kind.
    const observations = included<Observation>(bundle, 'Observation').filter((o) => isVital(o) && isForPatient(o.subject));
    const notes = included<DocumentReference>(bundle, 'DocumentReference').filter(
      (n) => isNurseNote(n) && isForPatient(n.subject)
    );
    const encounters = matches<Encounter>(bundle, 'Encounter');
    matched = encounters.length;
    visits = encounters
      // An Encounter entered in error is not a visit.
      .filter((e) => !!e.id && isForPatient(e.subject) && e.status !== 'entered-in-error' && isHomeHealth(e))
      .filter((e) => !visitType || visitTypeOf(e, systems.visitType) === visitType)
      .map((e) => {
        const ref = `Encounter/${e.id}`;
        const mine = notes.filter((n) => (n.context?.encounter ?? []).some((r) => localRef(r.reference, 'Encounter') === ref));
        const hasLinkedVitals = observations.some((o) => localRef(o.encounter?.reference, 'Encounter') === ref);
        return {
          summary: {
            id: e.id!,
            visitDate: localDay(e.period?.start, timezone),
            visitType: visitTypeOf(e, systems.visitType),
            // A cancelled visit stays cancelled whatever its note says.
            status:
              e.status === 'cancelled' ? 'cancelled' : (noteStatus(mine) ?? ENCOUNTER_STATUS[e.status] ?? 'pending_review'),
            duration: minutesBetween(e.period),
            nurseName: e.participant?.find((p) => p.individual?.display)?.individual?.display ?? '',
            hasVitals: hasLinkedVitals,
          },
          startMs: edgeMs(e.period?.start, 'start', timezone),
          period: e.period,
          hasLinkedVitals,
        };
      });
  } else {
    bundle = cursor
      ? await client.follow(cursor.url)
      : await client.search('DocumentReference', [
          ['patient', patient.id],
          ['category', `${CATEGORY.clinicalNote.system}|${CATEGORY.clinicalNote.code}`],
          // `date` here is when the note was written, which is on or after the visit. So only
          // the lower bound goes to the server; a note written a day late is still found, and
          // the visit date itself is checked below.
          ...from,
          ['_sort', '-date'],
          ['_count', String(limit)],
        ]);
    serverFiltered = false;
    const documents = matches<DocumentReference>(bundle, 'DocumentReference');
    matched = documents.length;
    // One row per visit: a visit with two notes is still one visit.
    // The server pages notes, not visits, so a visit listed on an earlier page is skipped here.
    const byVisit = new Map<string, DocumentReference[]>();
    const listed = new Set(cursor?.keys ?? []);
    for (const d of documents) {
      if (!d.id || d.status !== 'current' || !isNurseNote(d) || !isForPatient(d.subject)) continue;
      const encounterRef = (d.context?.encounter ?? []).map((r) => localRef(r.reference, 'Encounter')).find(Boolean);
      const key = encounterRef ?? `DocumentReference/${d.id}`;
      if (listed.has(shortHash(key))) continue;
      byVisit.set(key, [...(byVisit.get(key) ?? []), d]);
    }
    for (const key of byVisit.keys()) listed.add(shortHash(key));
    keys = [...listed].slice(-REMEMBER_MAX);
    visits = [...byVisit].map(([key, docs]) => {
      const first = docs[0];
      const period =
        docs.find((d) => d.context?.period?.start)?.context?.period ??
        (first.date ? { start: first.date, end: first.date } : undefined);
      return {
        summary: {
          id: key.slice(key.indexOf('/') + 1),
          visitDate: localDay(period?.start, timezone),
          // The note does not carry the visit type; only the Encounter does.
          visitType: 'other',
          status: noteStatus(docs) ?? 'pending_review',
          duration: minutesBetween(period),
          nurseName: docs.flatMap((d) => d.author ?? []).find((a) => a.display)?.display ?? '',
          hasVitals: false,
        },
        startMs: edgeMs(period?.start, 'start', timezone),
        period,
        hasLinkedVitals: false,
      };
    });
  }

  // A period search matches on overlap, so re-check the local start date. A visit with no
  // start date cannot pass a date filter, but is listed when none was asked for.
  visits = visits.filter((v) => {
    const date = v.summary.visitDate;
    if (date === '') return !start && !end;
    return (!start || date >= start) && (!end || date <= end);
  });

  // Observation.encounter is not Must Support: look for vitals taken during the visit.
  await Promise.all(
    visits
      .filter((v) => !v.hasLinkedVitals && v.period?.start && v.summary.visitDate !== '')
      .map(async (v) => {
        // A visit still open has no end: look to the end of its local day.
        const last = v.period!.end ?? localDateTime(nextDate(v.summary.visitDate), '00:00', timezone);
        // The end may be a bare date, which covers that whole local day.
        const lastMs = edgeMs(last, 'end', timezone);
        const found = await client.search('Observation', [
          ['patient', patient.id],
          ['category', `${CATEGORY.vitalSigns.system}|${CATEGORY.vitalSigns.code}`],
          ['date', `ge${v.period!.start}`],
          ['date', `le${last}`],
          ['_count', '5'],
        ]);
        v.summary.hasVitals = matches<Observation>(found, 'Observation').some((o) => {
          const at = Date.parse(o.effectiveDateTime ?? o.effectivePeriod?.start ?? '');
          return isVital(o) && isForPatient(o.subject) && at >= v.startMs && at <= lastMs;
        });
      })
  );

  visits.sort((a, b) => (b.startMs || 0) - (a.startMs || 0));
  // A next link that points at the page just read would never end.
  const nextLink = link(bundle, 'next');
  const next = nextLink && nextLink !== cursor?.url ? nextLink : undefined;
  // Bundle.total counts what the server matched, so it is only this history's total when
  // the server applied every filter and no page dropped a row. Once a page drops one, the
  // total is what has been listed so far, and says so while more pages exist.
  const soFar = (cursor?.n ?? 0) + visits.length;
  const first = cursor ? cursor.total : typeof bundle.total === 'number' ? bundle.total : undefined;
  // A later page has no self link to check; it inherits page one's verdict through the cursor.
  const filtered = cursor ? cursor.total !== undefined : serverFiltered;
  const trusted = filtered && visits.length === matched ? first : undefined;
  const exact = trusted !== undefined && (next ? trusted >= soFar : trusted === soFar);

  return {
    patientId: patient.id,
    patientName: `${domain.demographics.firstName} ${domain.demographics.lastName}`.trim(),
    visits: visits.map((v) => v.summary),
    total: exact ? trusted : soFar,
    ...(!exact && next ? { totalIsLowerBound: true } : {}),
    limit,
    offset: 0,
    hasMore: !!next,
    ...(next
      ? {
          nextCursor: encodeCursor({
            k: 'history', url: next, pid: patient.id, mode, limit, start, end, type: visitType, total: trusted, n: soFar,
            ...(keys ? { keys } : {}),
          } satisfies HistoryCursor),
        }
      : {}),
  };
}
