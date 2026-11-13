/**
 * Regenerates tests/fixtures/golden (positives) and tests/fixtures/golden-negative.
 * Deterministic: same source, same bytes. CI runs this and fails on `git diff`.
 * Usage: npm run golden
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Observation } from 'fhir/r4.js';

import { buildGolden, GOLDEN_CASES, NEGATIVE_CASES } from '../tests/fhir/golden-cases.js';

const root = join(import.meta.dirname, '..', 'tests', 'fixtures');
const pos = join(root, 'golden');
const neg = join(root, 'golden-negative');

function reset(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(join(dir, f));
}

const write = (dir: string, name: string, value: unknown) =>
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);

reset(pos);
reset(neg);

for (const c of GOLDEN_CASES) write(pos, c.name, buildGolden(c));

const full = GOLDEN_CASES.find((c) => c.name === 'full-vitals');
if (!full) throw new Error('full-vitals case missing');
for (const n of NEGATIVE_CASES) {
  const bundle = buildGolden(full);
  const obs = bundle.entry?.find(
    (e) => e.resource?.resourceType === 'Observation' && (e.resource as Observation).code.coding?.[0]?.code === n.loinc
  )?.resource as Observation | undefined;
  if (!obs?.valueQuantity) throw new Error(`no ${n.loinc} quantity to corrupt`);
  obs.valueQuantity.code = n.badCode;
  write(neg, n.name, bundle);
}

console.log(`golden: ${GOLDEN_CASES.length} positive, ${NEGATIVE_CASES.length} negative`);
