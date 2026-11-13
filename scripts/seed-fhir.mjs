#!/usr/bin/env node
/**
 * Seeds the local FHIR server with the shared synthetic data set (fictional people only).
 *
 *   node scripts/seed-fhir.mjs            # FHIR_IT_BASE_URL, default http://127.0.0.1:8080/fhir
 *
 * One transaction Bundle of conditional creates, so running it twice changes nothing.
 * Waits up to SEED_WAIT_MS (default 180000) for the server to answer /metadata first.
 * Refuses any host that is not loopback: this script writes without auth.
 *
 * PT-10001..10003 match the demo dashboard's patients; PT-10004..10005 come from the mock.
 */

const BASE = (process.env.FHIR_IT_BASE_URL ?? 'http://127.0.0.1:8080/fhir').replace(/\/+$/, '');
const SYS = process.env.FHIR_IDENTIFIER_SYSTEM ?? 'https://memyselfplusai.com/fhir/chartinghero';

const host = new URL(BASE).hostname.replace(/^\[|\]$/g, '');
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`seed-fhir: refusing to seed ${host}; only a loopback FHIR server is allowed`);
  process.exit(1);
}

const TAG = { system: SYS, code: 'chartinghero-dev' };
const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const VITALS = [
  {
    coding: [
      { system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' },
    ],
  },
];

const entries = [];
/** Conditional create keyed on one identifier; returns the urn:uuid other entries reference. */
function add(resource, system, value) {
  const fullUrl = `urn:uuid:00000000-0000-4000-8000-${String(entries.length + 1).padStart(12, '0')}`;
  entries.push({
    fullUrl,
    resource: { ...resource, meta: { tag: [TAG] }, identifier: [{ system, value }] },
    request: { method: 'POST', url: resource.resourceType, ifNoneExist: `identifier=${system}|${value}` },
  });
  return fullUrl;
}

const nurse = add(
  {
    resourceType: 'Practitioner',
    active: true,
    name: [{ use: 'official', family: 'Quinn', given: ['Avery'], suffix: ['RN'] }],
    telecom: [{ system: 'phone', use: 'work', value: '555-0190' }],
  },
  `${SYS}/practitioner-id`,
  'RN-0001'
);
const NURSE = { reference: nurse, display: 'Avery Quinn, RN' };

const PATIENTS = [
  ['PT-10001', 'Jane', 'Marple', '1942-03-15', 'female', '555-0101', true],
  ['PT-10002', 'Hercule', 'Poirot', '1955-07-22', 'male', '555-0102', true],
  ['PT-10003', 'Ariadne', 'Oliver', '1938-11-08', 'female', '555-0103', true],
  ['PT-10004', 'James', 'Thompson', '1960-04-30', 'male', '555-0105', true],
  ['PT-10005', 'Dorothy', 'Anderson', '1945-09-12', 'female', '555-0106', false],
];
const patient = {};
for (const [id, given, family, birthDate, gender, phone, active] of PATIENTS) {
  patient[id] = add(
    {
      resourceType: 'Patient',
      active,
      name: [{ use: 'official', family, given: [given] }],
      telecom: [{ system: 'phone', use: 'home', value: phone }],
      gender,
      birthDate,
    },
    `${SYS}/patient-id`,
    id
  );
}

function encounter(key, pt, visitType, label, start, end, classCode = 'HH') {
  return add(
    {
      resourceType: 'Encounter',
      status: 'finished',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: classCode,
        display: classCode === 'HH' ? 'home health' : 'ambulatory',
      },
      type: [
        {
          coding: [
            { system: `${SYS}/visit-type`, code: visitType, display: label },
            { system: 'http://snomed.info/sct', code: '439708006', display: 'Home visit' },
          ],
          text: label,
        },
      ],
      subject: { reference: patient[pt] },
      participant: [{ individual: NURSE }],
      period: { start, end },
    },
    `${SYS}/visit`,
    key
  );
}

function heartRate(key, pt, when, value, enc) {
  add(
    {
      resourceType: 'Observation',
      status: 'final',
      category: VITALS,
      code: { coding: [{ system: LOINC, code: '8867-4', display: 'Heart rate' }], text: 'Heart rate' },
      subject: { reference: patient[pt] },
      ...(enc ? { encounter: { reference: enc } } : {}),
      effectiveDateTime: when,
      performer: [NURSE],
      valueQuantity: { value, unit: '/min', system: UCUM, code: '/min' },
    },
    `${SYS}/seed`,
    key
  );
}

function note(key, pt, enc, period, docStatus, text) {
  add(
    {
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus,
      type: { coding: [{ system: LOINC, code: '34746-8', display: 'Nurse Note' }], text: 'Nurse Note' },
      category: [
        {
          coding: [
            {
              system: 'http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category',
              code: 'clinical-note',
              display: 'Clinical Note',
            },
          ],
        },
      ],
      subject: { reference: patient[pt] },
      date: period.end,
      author: [NURSE],
      content: [
        {
          attachment: {
            contentType: 'text/plain; charset=utf-8',
            data: Buffer.from(text, 'utf8').toString('base64'),
            title: 'Visit note',
          },
        },
      ],
      context: { encounter: [{ reference: enc }], period },
    },
    `${SYS}/seed`,
    key
  );
}

// PT-10001: two home health visits, each with vitals and a note (one signed, one not).
const P1 = { start: '2026-10-20T09:00:00-04:00', end: '2026-10-20T09:45:00-04:00' };
const e1 = encounter('seed-visit-0001', 'PT-10001', 'skilled_nursing', 'Skilled Nursing', P1.start, P1.end);
heartRate('seed-obs-0001', 'PT-10001', P1.start, 76, e1);
note('seed-note-0001', 'PT-10001', e1, P1, 'preliminary', 'Subjective:\nFeels well today.');

const P2 = { start: '2026-10-17T14:00:00-04:00', end: '2026-10-17T14:30:00-04:00' };
const e2 = encounter('seed-visit-0002', 'PT-10001', 'physical_therapy', 'Physical Therapy', P2.start, P2.end);
heartRate('seed-obs-0002', 'PT-10001', P2.start, 81, e2);
note('seed-note-0002', 'PT-10001', e2, P2, 'final', 'Objective:\nGait steady with walker.');

// PT-10002: one home health visit whose vitals carry no encounter link (Observation.encounter is
// not Must Support), and one clinic visit that is not home health and must not show in history.
const P3 = { start: '2026-10-19T10:00:00-04:00', end: '2026-10-19T10:40:00-04:00' };
encounter('seed-visit-0003', 'PT-10002', 'skilled_nursing', 'Skilled Nursing', P3.start, P3.end);
heartRate('seed-obs-0003', 'PT-10002', '2026-10-19T10:10:00-04:00', 68, undefined);
encounter('seed-visit-0004', 'PT-10002', 'other', 'Other', '2026-10-18T11:00:00-04:00', '2026-10-18T11:20:00-04:00', 'AMB');

// A container that has just started takes a minute or two before it answers.
const WAIT_MS = Number(process.env.SEED_WAIT_MS ?? 180_000);
if (!Number.isFinite(WAIT_MS) || WAIT_MS < 0) {
  console.error('seed-fhir: SEED_WAIT_MS must be a number of milliseconds');
  process.exit(2);
}
const deadline = Date.now() + WAIT_MS;
for (let waited = false; ; waited = true) {
  const up = await fetch(`${BASE}/metadata`, {
    headers: { accept: 'application/fhir+json' },
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (up) break;
  if (Date.now() > deadline) {
    console.error(`seed-fhir: ${BASE}/metadata did not answer within ${Math.round(WAIT_MS / 1000)} s`);
    process.exit(1);
  }
  if (!waited) console.log(`seed-fhir: waiting for ${BASE} ...`);
  await new Promise((r) => setTimeout(r, 3000));
}

const res = await fetch(BASE, {
  method: 'POST',
  headers: { 'content-type': 'application/fhir+json', accept: 'application/fhir+json' },
  body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: entries }),
});
const body = await res.json().catch(() => undefined);
if (!res.ok || body?.resourceType !== 'Bundle') {
  console.error(`seed-fhir: transaction failed (HTTP ${res.status})`);
  for (const i of body?.issue ?? []) console.error(`  ${i.severity} ${i.code}: ${i.diagnostics ?? ''}`);
  process.exit(1);
}
const created = body.entry.filter((e) => e.response?.status?.startsWith('201')).length;
console.log(`seed-fhir: ${entries.length} resources (${created} created, ${entries.length - created} already present) at ${BASE}`);
