/**
 * Tier 1 of the conformance gate: the fixtures on disk equal what the mappers produce
 * now, and every resource passes @medplum/core's in-process base R4 validation.
 * Tier 2 (US Core profiles and terminology) is scripts/validate-golden.sh.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { indexStructureDefinitionBundle, validateResource } from '@medplum/core';
import { readJson } from '@medplum/definitions';

import { buildGolden, GOLDEN_CASES, NEGATIVE_CASES } from './golden-cases.js';

type Resource = Parameters<typeof validateResource>[0];

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const read = (dir: string, name: string) => JSON.parse(readFileSync(join(FIXTURES, dir, `${name}.json`), 'utf8'));

beforeAll(() => {
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json'));
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json'));
});

describe('in-process validator is live', () => {
  it('rejects an Observation with no status and an unknown element', () => {
    const bad = { resourceType: 'Observation', code: { text: 'x' }, bogus: 1 } as unknown as Resource;
    expect(() => validateResource(bad)).toThrow();
  });
});

describe('golden fixtures', () => {
  it('the fixture set on disk is exactly the case list (run npm run golden)', () => {
    const onDisk = (d: string) =>
      readdirSync(join(FIXTURES, d))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
    expect(onDisk('golden')).toEqual(GOLDEN_CASES.map((c) => c.name).sort());
    expect(onDisk('golden-negative')).toEqual(NEGATIVE_CASES.map((c) => c.name).sort());
  });

  it.each(GOLDEN_CASES.map((c) => [c.name, c] as const))('%s matches the mapper output', (name, c) => {
    expect(read('golden', name)).toEqual(buildGolden(c));
  });

  it.each(GOLDEN_CASES.map((c) => [c.name, c] as const))('%s passes base R4 validation', (_name, c) => {
    const bundle = buildGolden(c);
    expect(() => validateResource(bundle as unknown as Resource)).not.toThrow();
    for (const e of bundle.entry ?? []) {
      expect(() => validateResource(e.resource as unknown as Resource)).not.toThrow();
    }
  });

  it.each(NEGATIVE_CASES.map((n) => [n.name, n] as const))('%s carries the leaked unit code', (name, n) => {
    const bundle = read('golden-negative', name);
    const codes = bundle.entry
      .map((e: { resource: { code?: { coding?: { code: string }[] }; valueQuantity?: { code: string } } }) => e.resource)
      .filter((r: { code?: { coding?: { code: string }[] } }) => r.code?.coding?.[0]?.code === n.loinc)
      .map((r: { valueQuantity?: { code: string } }) => r.valueQuantity?.code);
    expect(codes).toEqual([n.badCode]);
  });
});
