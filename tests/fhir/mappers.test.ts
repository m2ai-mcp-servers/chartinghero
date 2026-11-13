import type { Bundle, DocumentReference, Encounter, FhirResource, Observation, Procedure } from 'fhir/r4.js';

import { buildVisitBundle } from '../../src/fhir/bundle.js';
import { CODE, PROFILE } from '../../src/fhir/codes.js';
import { noteText } from '../../src/fhir/note.js';
import { buildGolden, counterIds, CTX, FULL_VITALS, GOLDEN_CASES, SERVER_PATIENT_ID } from './golden-cases.js';
import type { CreateVisitNoteParams } from '../../src/types/index.js';

const caseNamed = (name: string) => {
  const c = GOLDEN_CASES.find((g) => g.name === name);
  if (!c) throw new Error(`no golden case ${name}`);
  return c;
};
const resources = (b: Bundle<FhirResource>) => (b.entry ?? []).map((e) => e.resource as FhirResource);
const ofType = <T extends FhirResource>(b: Bundle<FhirResource>, t: T['resourceType']) =>
  resources(b).filter((r) => r.resourceType === t) as T[];
const obsByLoinc = (b: Bundle<FhirResource>, code: string) =>
  ofType<Observation>(b, 'Observation').find((o) => o.code.coding?.[0]?.code === code);

const note = (over: Partial<CreateVisitNoteParams>): CreateVisitNoteParams => ({
  patientId: 'PT-00001',
  visitType: 'skilled_nursing',
  visitDate: '2026-03-09',
  timeIn: '09:00',
  timeOut: '09:45',
  ...over,
});

describe('full vitals', () => {
  const bundle = buildGolden(caseNamed('full-vitals'));
  const obs = ofType<Observation>(bundle, 'Observation');

  it('yields 6 profiled vital-signs Observations plus 1 unprofiled pain Observation', () => {
    expect(obs).toHaveLength(7);
    const profiled = obs.filter((o) => o.meta?.profile?.length);
    expect(profiled.map((o) => o.meta?.profile?.[0]).sort()).toEqual(
      [
        PROFILE.bloodPressure,
        PROFILE.heartRate,
        PROFILE.respiratoryRate,
        PROFILE.bodyTemperature,
        PROFILE.pulseOximetry,
        PROFILE.bodyWeight,
      ].sort()
    );
    for (const o of obs) expect(o.category?.[0]?.coding?.[0]?.code).toBe('vital-signs');
  });

  it('BP is panel 85354-9 with systolic/diastolic components in mm[Hg] and no root value', () => {
    const bp = obsByLoinc(bundle, '85354-9');
    expect(bp).toBeDefined();
    expect(bp?.valueQuantity).toBeUndefined();
    expect(bp?.component?.map((c) => [c.code.coding?.[0]?.code, c.valueQuantity?.value, c.valueQuantity?.code])).toEqual([
      ['8480-6', FULL_VITALS.bloodPressureSystolic, 'mm[Hg]'],
      ['8462-4', FULL_VITALS.bloodPressureDiastolic, 'mm[Hg]'],
    ]);
  });

  it('pulse oximetry carries both 59408-5 and 2708-6 codings and %', () => {
    const ox = obsByLoinc(bundle, '59408-5');
    expect(ox?.code.coding?.map((c) => c.code)).toEqual(['59408-5', '2708-6']);
    expect(ox?.valueQuantity).toMatchObject({ value: 96, code: '%', system: 'http://unitsofmeasure.org' });
  });

  it('uses UCUM codes: [degF], [lb_av], /min', () => {
    expect(obsByLoinc(bundle, '8310-5')?.valueQuantity?.code).toBe('[degF]');
    expect(obsByLoinc(bundle, '29463-7')?.valueQuantity?.code).toBe('[lb_av]');
    expect(obsByLoinc(bundle, '8867-4')?.valueQuantity?.code).toBe('/min');
    expect(obsByLoinc(bundle, '9279-1')?.valueQuantity?.code).toBe('/min');
  });

  it('pain is valueInteger with no meta.profile', () => {
    const pain = obsByLoinc(bundle, CODE.painScore.code as string);
    expect(pain?.valueInteger).toBe(FULL_VITALS.painLevel);
    expect(pain?.meta?.profile).toBeUndefined();
  });

  it('every vital is final, effective at period start, and references the encounter', () => {
    const encUrl = bundle.entry?.[0]?.fullUrl;
    for (const o of obs) {
      expect(o.status).toBe('final');
      expect(o.effectiveDateTime).toBe('2026-03-09T09:00:00-04:00');
      expect(o.encounter?.reference).toBe(encUrl);
    }
  });
});

describe('every bundle', () => {
  it.each(GOLDEN_CASES.map((c) => [c.name, c] as const))('%s: subject is Patient/{serverId}, POST, urn:uuid', (_n, c) => {
    const bundle = buildGolden(c);
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'transaction' });
    expect(bundle.entry?.length).toBeGreaterThan(0);
    for (const e of bundle.entry ?? []) {
      expect(e.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
      expect(e.request).toMatchObject({ method: 'POST', url: e.resource?.resourceType });
      const r = e.resource as { subject?: { reference?: string } };
      expect(r.subject?.reference).toBe(`Patient/${SERVER_PATIENT_ID}`);
    }
  });

  it('fullUrls are unique within a bundle', () => {
    const urls = buildGolden(caseNamed('full-vitals')).entry?.map((e) => e.fullUrl) ?? [];
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('defaults to random UUIDs when no newId is given', () => {
    const b = buildVisitBundle(note({}), CTX, { profile: 'full' });
    expect(b.entry?.[0]?.fullUrl).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });
});

describe('encounter', () => {
  const bundle = buildGolden(caseNamed('full-vitals'));
  const enc = ofType<Encounter>(bundle, 'Encounter')[0];

  it('is first, finished, class HH, with the visit identifier and ifNoneExist on it', () => {
    expect(bundle.entry?.[0]?.resource?.resourceType).toBe('Encounter');
    expect(enc.status).toBe('finished');
    expect(enc.class.code).toBe('HH');
    expect(enc.identifier).toEqual([{ system: `${CTX.identifierSystem}/visit`, value: CTX.idempotencyKey }]);
    expect(bundle.entry?.[0]?.request?.ifNoneExist).toBe(`identifier=${CTX.identifierSystem}/visit|${CTX.idempotencyKey}`);
  });

  it('types the visit with the local code and SNOMED home visit', () => {
    expect(enc.type?.[0]?.coding?.map((c) => [c.system, c.code])).toEqual([
      [`${CTX.identifierSystem}/visit-type`, 'skilled_nursing'],
      ['http://snomed.info/sct', '439708006'],
    ]);
  });

  it('tags dev writes and omits the tag otherwise', () => {
    expect(enc.meta?.tag).toEqual([{ system: CTX.identifierSystem, code: 'chartinghero-dev' }]);
    const prod = buildVisitBundle(note({}), { ...CTX, devTag: false }, { profile: 'full', newId: counterIds() });
    const prodEnc = prod.entry?.[0]?.resource as Encounter;
    expect(prodEnc.meta?.tag).toBeUndefined();
    expect(prodEnc.meta?.profile).toEqual([PROFILE.encounter]);
  });

  it('overnight period ends on the next date', () => {
    const o = ofType<Encounter>(buildGolden(caseNamed('overnight')), 'Encounter')[0];
    expect(o.period).toEqual({ start: '2026-03-09T23:30:00-04:00', end: '2026-03-10T00:15:00-04:00' });
  });
});

describe('vitals variants', () => {
  it('temperature in C uses Cel, weight in kg uses kg', () => {
    expect(obsByLoinc(buildGolden(caseNamed('temp-c')), '8310-5')?.valueQuantity?.code).toBe('Cel');
    expect(obsByLoinc(buildGolden(caseNamed('weight-kg')), '29463-7')?.valueQuantity?.code).toBe('kg');
  });

  it('BP only yields exactly the BP panel', () => {
    const obs = ofType<Observation>(buildGolden(caseNamed('bp-only')), 'Observation');
    expect(obs.map((o) => o.code.coding?.[0]?.code)).toEqual(['85354-9']);
  });

  it('no vitals yields no Observations', () => {
    expect(ofType(buildGolden(caseNamed('no-vitals')), 'Observation')).toHaveLength(0);
  });

  it('flow without SpO2 keeps the flow component and records SpO2 as not performed', () => {
    const ox = obsByLoinc(buildGolden(caseNamed('flow-without-spo2')), '59408-5');
    expect(ox?.valueQuantity).toBeUndefined();
    expect(ox?.dataAbsentReason?.coding?.[0]?.code).toBe('not-performed');
    expect(ox?.component?.[0]).toMatchObject({
      code: { coding: [{ code: '3151-8' }] },
      valueQuantity: { value: 2, code: 'L/min' },
    });
  });

  it('glucose is its own lab Observation in mg/dL', () => {
    const b = buildGolden(caseNamed('spo2-with-flow-and-glucose'));
    const glu = obsByLoinc(b, '41653-7');
    expect(glu?.meta?.profile).toEqual([PROFILE.observationLab]);
    expect(glu?.category?.[0]?.coding?.[0]?.code).toBe('laboratory');
    expect(glu?.valueQuantity).toMatchObject({ value: 132, code: 'mg/dL' });
    expect(obsByLoinc(b, '59408-5')?.valueQuantity?.value).toBe(93);
  });

  it('a recorded 0 is kept, not dropped as falsy', () => {
    const b = buildVisitBundle(note({ vitalSigns: { painLevel: 0 } }), CTX, { profile: 'full', newId: counterIds() });
    expect(obsByLoinc(b, CODE.painScore.code as string)?.valueInteger).toBe(0);
  });
});

describe('procedures', () => {
  it('one Procedure per intervention; known ones coded, unknown text-only', () => {
    const procs = ofType<Procedure>(buildGolden(caseNamed('three-interventions')), 'Procedure');
    expect(procs.map((p) => [p.code?.coding?.[0]?.code, p.code?.text])).toEqual([
      ['225358003', 'Wound care'],
      ['385949008', 'Dressing change'],
      [undefined, 'Medication reconciliation'],
    ]);
    for (const p of procs) {
      expect(p.status).toBe('completed');
      expect(p.performedPeriod).toEqual({ start: '2026-03-09T09:00:00-04:00', end: '2026-03-09T09:45:00-04:00' });
      expect(p.meta?.profile).toEqual([PROFILE.procedure]);
    }
  });

  it('education is one Procedure with each topic as a note', () => {
    const procs = ofType<Procedure>(buildGolden(caseNamed('education-only')), 'Procedure');
    expect(procs).toHaveLength(1);
    expect(procs[0].code?.coding?.[0]?.code).toBe('311401005');
    expect(procs[0].note?.map((n) => n.text)).toEqual(['Fall prevention', 'Medication schedule']);
  });

  it('prototype member names are not intervention codes', () => {
    const b = buildVisitBundle(note({ interventions: ['constructor', '__proto__', 'toString'] }), CTX, {
      profile: 'full',
      newId: counterIds(),
    });
    const procs = ofType<Procedure>(b, 'Procedure');
    expect(procs.map((p) => p.code)).toEqual([{ text: 'constructor' }, { text: '__proto__' }, { text: 'toString' }]);
  });

  it('blank interventions and topics produce nothing', () => {
    const b = buildVisitBundle(note({ interventions: ['  '], education: [''] }), CTX, { profile: 'full', newId: counterIds() });
    expect(ofType(b, 'Procedure')).toHaveLength(0);
  });
});

describe('note', () => {
  const decode = (d: DocumentReference) => Buffer.from(d.content[0].attachment.data ?? '', 'base64').toString('utf8');

  it('is a preliminary Nurse Note linked to the encounter', () => {
    const b = buildGolden(caseNamed('full-vitals'));
    const doc = ofType<DocumentReference>(b, 'DocumentReference')[0];
    expect(doc.docStatus).toBe('preliminary');
    expect(doc.type?.coding?.[0]?.code).toBe('34746-8');
    expect(doc.context?.encounter?.[0]?.reference).toBe(b.entry?.[0]?.fullUrl);
    expect(doc.content[0].attachment.contentType).toBe('text/plain; charset=utf-8');
    expect(decode(doc)).toBe(
      'Subjective:\nReports mild fatigue.\n\nObjective:\nAlert and oriented.\n\nAssessment:\nStable.\n\nPlan:\nContinue current plan of care.'
    );
  });

  it('is omitted when there is no narrative content', () => {
    const b = buildGolden(caseNamed('bp-only'));
    expect(ofType(b, 'DocumentReference')).toHaveLength(0);
  });

  it('note-only is a single DocumentReference carrying the visit, vitals and next visit as text', () => {
    const b = buildGolden(caseNamed('note-only'));
    expect(b.entry).toHaveLength(1);
    const doc = b.entry?.[0]?.resource as DocumentReference;
    expect(doc.resourceType).toBe('DocumentReference');
    expect(doc.context?.encounter).toBeUndefined();
    const text = decode(doc);
    expect(text).toContain('Visit:\nSkilled Nursing, 2026-03-09 09:00 to 09:45');
    expect(text).toContain('BP: 128/82 mmHg');
    expect(text).toContain('Pain: 3/10');
    expect(text).toContain('Interventions:\n- Wound care');
    expect(text).toContain('Next visit:\n2026-03-12');
  });

  it('note-only always has a document, even with no narrative', () => {
    const b = buildVisitBundle(note({}), CTX, { profile: 'note-only', newId: counterIds() });
    expect(b.entry).toHaveLength(1);
  });

  it('marks an overnight end in the visit header', () => {
    expect(noteText(note({ timeIn: '23:30', timeOut: '00:15', overnight: true }), { includeVisitAndVitals: true })).toBe(
      'Visit:\nSkilled Nursing, 2026-03-09 23:30 to 00:15 (next day)'
    );
  });
});
