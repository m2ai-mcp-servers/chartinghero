/**
 * A small in-memory FHIR server behind a fetch function. Synthetic data only.
 *
 * It filters the way a real server does, pages by `_count` (the next link carries
 * `_offset`), lists the parameters it applied in the Bundle self link, and can be told to
 * ignore parameters (R4 lets a server do that silently) or
 * to hide them from /metadata.
 */

import type {
  Bundle,
  CapabilityStatement,
  CapabilityStatementRestResource,
  DocumentReference,
  Encounter,
  FhirResource,
  Observation,
  Patient,
} from 'fhir/r4.js';

import type { FhirConfig } from '../../src/config.js';
import { CATEGORY, CLASS_HOME_HEALTH, CODE, LOINC } from '../../src/fhir/codes.js';

export const BASE = 'https://fhir.test/r4';
export const SYS = 'https://example.test/fhir/chartinghero';

export const CONFIG: FhirConfig = {
  baseUrl: BASE,
  host: 'fhir.test',
  environment: 'sandbox',
  write: true,
  writeProfile: 'full',
  practitionerId: 'rn-1',
  identifierSystem: SYS,
};

export interface Request {
  method: string;
  url: URL;
  headers: Record<string, string>;
}

export interface FakeOptions {
  fhirVersion?: string;
  /** Search params left out of /metadata, as "Type.param". */
  hide?: string[];
  /** Search params the server silently ignores, as "Type.param". */
  ignore?: string[];
  /** Drop searchRevInclude from /metadata. */
  noRevInclude?: boolean;
  /** What /metadata lists as Encounter searchRevInclude instead of the two two-part values. */
  revInclude?: string[];
  /** Interactions left out of /metadata, as "Type.code". */
  noInteraction?: string[];
  patients?: Patient[];
  encounters?: Encounter[];
  observations?: Observation[];
  documents?: DocumentReference[];
  /** Answer before the built-in routes; return undefined to fall through. */
  override?: (req: Request) => { status: number; body: unknown } | undefined;
}

const PARAMS: Record<string, string[]> = {
  Patient: ['_id', 'identifier', 'name', 'birthdate', 'phone'],
  Encounter: ['patient', 'date', 'class', 'type', 'identifier'],
  Observation: ['patient', 'category', 'date'],
  DocumentReference: ['patient', 'category', 'date'],
};

export function capabilityStatement(opts: FakeOptions = {}): CapabilityStatement {
  const hide = new Set(opts.hide ?? []);
  const no = new Set(opts.noInteraction ?? []);
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: '2026-01-01',
    kind: 'instance',
    fhirVersion: (opts.fhirVersion ?? '4.0.1') as CapabilityStatement['fhirVersion'],
    format: ['json'],
    rest: [
      {
        mode: 'server',
        resource: Object.entries(PARAMS).map(([type, params]) => ({
          type: type as CapabilityStatementRestResource['type'],
          interaction: (['read', 'search-type', 'create'] as const)
            .filter((code) => !no.has(`${type}.${code}`))
            .map((code) => ({ code })),
          searchParam: params.filter((p) => !hide.has(`${type}.${p}`)).map((name) => ({ name, type: 'string' as const })),
          ...(type === 'Encounter' && !opts.noRevInclude
            ? { searchRevInclude: opts.revInclude ?? ['Observation:encounter', 'DocumentReference:encounter'] }
            : {}),
        })),
      },
    ],
  };
}

const token = (value: string) => {
  const i = value.indexOf('|');
  return i === -1 ? { code: value } : { system: value.slice(0, i), code: value.slice(i + 1) };
};

const refId = (reference: string | undefined) => reference?.split('/').pop();

export function fakeFhir(opts: FakeOptions = {}) {
  const requests: Request[] = [];
  const ignore = new Set(opts.ignore ?? []);

  function search(type: string, url: URL): Bundle {
    const q = url.searchParams;
    const on = (param: string) => q.has(param) && !ignore.has(`${type}.${param}`);
    let matched: FhirResource[] = [];
    const included: FhirResource[] = [];

    if (type === 'Patient') {
      matched = (opts.patients ?? []).filter((p) => {
        if (on('identifier')) {
          const t = token(q.get('identifier')!);
          if (!(p.identifier ?? []).some((i) => i.system === t.system && i.value === t.code)) return false;
        }
        if (on('_id') && p.id !== q.get('_id')) return false;
        if (on('name')) {
          const words = (p.name ?? []).flatMap((n) => [n.family ?? '', ...(n.given ?? [])]).map((w) => w.toLowerCase());
          if (!q.getAll('name').every((n) => words.some((w) => w.startsWith(n.toLowerCase())))) return false;
        }
        if (on('birthdate') && p.birthDate !== q.get('birthdate')) return false;
        if (on('phone')) {
          const wanted = q.get('phone')!.split(',');
          if (!(p.telecom ?? []).some((t) => t.system === 'phone' && wanted.includes(t.value ?? ''))) return false;
        }
        return true;
      });
    } else if (type === 'Encounter') {
      const encounters = (opts.encounters ?? []).filter((e) => {
        if (on('patient') && refId(e.subject?.reference) !== q.get('patient')) return false;
        if (on('class') && e.class?.code !== token(q.get('class')!).code) return false;
        if (on('type')) {
          const t = token(q.get('type')!);
          if (!(e.type ?? []).some((x) => (x.coding ?? []).some((c) => c.system === t.system && c.code === t.code))) return false;
        }
        if (on('identifier')) {
          const t = token(q.get('identifier')!);
          if (!(e.identifier ?? []).some((i) => i.system === t.system && i.value === t.code)) return false;
        }
        return true;
      });
      matched = encounters;
      const ids = new Set(encounters.map((e) => e.id));
      const rev = q.getAll('_revinclude');
      if (rev.includes('Observation:encounter')) {
        included.push(...(opts.observations ?? []).filter((o) => ids.has(refId(o.encounter?.reference))));
      }
      if (rev.includes('DocumentReference:encounter')) {
        included.push(
          ...(opts.documents ?? []).filter((d) => (d.context?.encounter ?? []).some((r) => ids.has(refId(r.reference))))
        );
      }
    } else if (type === 'Observation') {
      const ms = (prefix: string) => {
        const v = q.getAll('date').find((d) => d.startsWith(prefix));
        return v ? Date.parse(v.slice(2)) : undefined;
      };
      const ge = ms('ge');
      const le = ms('le');
      matched = (opts.observations ?? []).filter((o) => {
        if (on('patient') && refId(o.subject?.reference) !== q.get('patient')) return false;
        const at = Date.parse(o.effectiveDateTime ?? '');
        if (on('date') && ((ge !== undefined && at < ge) || (le !== undefined && at > le))) return false;
        return true;
      });
    } else if (type === 'DocumentReference') {
      const from = q.getAll('date').find((d) => d.startsWith('ge'));
      const before = q.getAll('date').find((d) => d.startsWith('lt'));
      matched = (opts.documents ?? []).filter((d) => {
        if (on('patient') && refId(d.subject?.reference) !== q.get('patient')) return false;
        if (on('category')) {
          const t = token(q.get('category')!);
          if (!(d.category ?? []).some((c) => (c.coding ?? []).some((x) => x.system === t.system && x.code === t.code))) return false;
        }
        const at = Date.parse(d.date ?? '');
        if (on('date') && ((from && at < Date.parse(from.slice(2))) || (before && at >= Date.parse(before.slice(2))))) return false;
        return true;
      });
    }

    // Paging: `_count` per page, and a next link that asks for the same search at `_offset`.
    const total = matched.length;
    const offset = Number(q.get('_offset') ?? 0);
    const count = q.has('_count') ? Number(q.get('_count')) : total;
    matched = matched.slice(offset, offset + count);
    const nextUrl = new URL(url.href);
    nextUrl.searchParams.set('_offset', String(offset + count));

    const self = new URL(url.href);
    for (const key of [...self.searchParams.keys()]) {
      if (ignore.has(`${type}.${key}`)) self.searchParams.delete(key);
    }
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total,
      link: [
        { relation: 'self', url: self.href },
        ...(offset + count < total ? [{ relation: 'next', url: nextUrl.href }] : []),
      ],
      entry: [
        ...matched.map((resource) => ({ resource, search: { mode: 'match' as const } })),
        ...included.map((resource) => ({ resource, search: { mode: 'include' as const } })),
      ],
    };
  }

  const all = (): FhirResource[] => [
    ...(opts.patients ?? []),
    ...(opts.encounters ?? []),
    ...(opts.observations ?? []),
    ...(opts.documents ?? []),
  ];
  const basePath = new URL(BASE).pathname;

  const fetchFn = (async (input: URL | string | globalThis.Request, init?: RequestInit) => {
    const url = new URL(input instanceof URL || typeof input === 'string' ? input : input.url);
    const req: Request = {
      method: init?.method ?? 'GET',
      url,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
      ),
    };
    requests.push(req);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/fhir+json' } });

    const custom = opts.override?.(req);
    if (custom) return json(custom.status, custom.body);

    const path = url.pathname.slice(basePath.length + 1).split('/');
    if (path[0] === 'metadata') return json(200, capabilityStatement(opts));
    if (path.length === 1) return json(200, search(path[0], url));
    const found = all().find((r) => r.resourceType === path[0] && r.id === path[1]);
    return found
      ? json(200, found)
      : json(404, {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'not-found', diagnostics: 'secret upstream text' }],
        });
  }) as typeof fetch;

  /** Search requests for one resource type, as their query parameters. */
  const queries = (type: string) =>
    requests.filter((r) => r.url.pathname === `${basePath}/${type}`).map((r) => r.url.searchParams);

  return { fetch: fetchFn, requests, queries };
}

// --- Synthetic resource builders -------------------------------------------------------

export function patient(id: string, pt: string, given: string, family: string, extra: Partial<Patient> = {}): Patient {
  return {
    resourceType: 'Patient',
    id,
    identifier: [{ system: `${SYS}/patient-id`, value: pt }],
    name: [{ use: 'official', family, given: [given] }],
    ...extra,
  };
}

export function encounter(
  id: string,
  patientId: string,
  start: string,
  end: string,
  extra: Partial<Encounter> & { visitType?: string } = {}
): Encounter {
  const { visitType = 'skilled_nursing', ...rest } = extra;
  return {
    resourceType: 'Encounter',
    id,
    status: 'finished',
    class: CLASS_HOME_HEALTH,
    type: [{ coding: [{ system: `${SYS}/visit-type`, code: visitType }] }],
    subject: { reference: `Patient/${patientId}` },
    period: { start, end },
    ...rest,
  };
}

export function heartRate(id: string, patientId: string, at: string, encounterId?: string): Observation {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [CATEGORY.vitalSigns] }],
    code: { coding: [CODE.heartRate] },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: at,
    valueQuantity: { value: 72, unit: '/min', system: 'http://unitsofmeasure.org', code: '/min' },
    ...(encounterId ? { encounter: { reference: `Encounter/${encounterId}` } } : {}),
  };
}

export function nurseNote(
  id: string,
  patientId: string,
  encounterId: string | undefined,
  period: { start: string; end: string },
  docStatus: DocumentReference['docStatus'] = 'preliminary'
): DocumentReference {
  return {
    resourceType: 'DocumentReference',
    id,
    status: 'current',
    docStatus,
    type: { coding: [{ system: LOINC, code: CODE.nurseNote.code }] },
    category: [{ coding: [CATEGORY.clinicalNote] }],
    subject: { reference: `Patient/${patientId}` },
    date: period.end,
    content: [{ attachment: { contentType: 'text/plain', data: 'c3ludGhldGlj' } }],
    context: { ...(encounterId ? { encounter: [{ reference: `Encounter/${encounterId}` }] } : {}), period },
  };
}
