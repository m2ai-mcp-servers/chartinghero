import type { Patient as FhirPatient } from 'fhir/r4.js';

import { fromFhirPatient } from '../../src/fhir/patient.js';

const SYS = 'https://memyselfplusai.com/fhir/chartinghero';

const fhir: FhirPatient = {
  resourceType: 'Patient',
  id: 'synthetic-patient-0001',
  meta: { lastUpdated: '2026-03-01T12:00:00Z' },
  identifier: [
    { system: 'urn:example:other', value: 'X-1' },
    { system: `${SYS}/patient-id`, value: 'PT-00001' },
  ],
  active: true,
  name: [
    { use: 'nickname', given: ['Tess'] },
    { use: 'official', family: 'Testcase', given: ['Theresa', 'Ann'] },
  ],
  telecom: [
    { system: 'email', value: 'test@example.invalid' },
    { system: 'phone', use: 'work', value: '555-0100' },
    { system: 'phone', use: 'home', value: '555-0101' },
  ],
  gender: 'female',
  birthDate: '1940-05-17',
};

describe('fromFhirPatient', () => {
  it('maps the server id, PT identifier, official name and home phone', () => {
    expect(fromFhirPatient(fhir, SYS)).toEqual({
      id: { id: 'synthetic-patient-0001', mrn: 'PT-00001' },
      demographics: {
        firstName: 'Theresa',
        middleName: 'Ann',
        lastName: 'Testcase',
        dateOfBirth: '1940-05-17',
        gender: 'female',
      },
      contact: { phone: '555-0101', phoneType: 'home' },
      status: 'active',
      createdAt: '2026-03-01T12:00:00Z',
      updatedAt: '2026-03-01T12:00:00Z',
    });
  });

  it('ignores identifiers under another system and maps inactive', () => {
    const p = fromFhirPatient({ ...fhir, active: false }, 'https://other.example/fhir');
    expect(p.id).toEqual({ id: 'synthetic-patient-0001' });
    expect(p.status).toBe('inactive');
  });

  it('tolerates a minimal Patient', () => {
    const p = fromFhirPatient({ resourceType: 'Patient', id: 'p1' }, SYS);
    expect(p).toMatchObject({
      id: { id: 'p1' },
      demographics: { firstName: '', lastName: '', dateOfBirth: '' },
      contact: {},
      status: 'active',
    });
  });

  it('skips old and maiden names and old phones when no official name or home phone exists', () => {
    const p = fromFhirPatient(
      {
        resourceType: 'Patient',
        id: 'p2',
        name: [
          { use: 'maiden', family: 'Oldname', given: ['Theresa'] },
          { use: 'old', family: 'Older', given: ['Theresa'] },
          { family: 'Current', given: ['Theresa'] },
        ],
        telecom: [
          { system: 'phone', use: 'old', value: '555-0199' },
          { system: 'phone', use: 'work', value: '555-0100' },
          { system: 'phone', use: 'mobile', value: '555-0102' },
        ],
      },
      SYS
    );
    expect(p.demographics.lastName).toBe('Current');
    expect(p.contact).toEqual({ phone: '555-0102', phoneType: 'mobile' });
  });

  it('prefers a phone with no use over an old one listed first', () => {
    const p = fromFhirPatient(
      {
        resourceType: 'Patient',
        id: 'p4',
        telecom: [
          { system: 'phone', use: 'old', value: '555-0199' },
          { system: 'phone', value: '555-0103' },
        ],
      },
      SYS
    );
    expect(p.contact).toEqual({ phone: '555-0103' });
  });

  it('skips an official name whose period has ended', () => {
    const p = fromFhirPatient(
      {
        resourceType: 'Patient',
        id: 'p5',
        name: [
          { use: 'official', family: 'Jones', given: ['Mary'], period: { start: '1980-01-01', end: '2010-06-01' } },
          { use: 'official', family: 'Smith', given: ['Mary'], period: { start: '2010-06-01' } },
        ],
      },
      SYS
    );
    expect(p.demographics.lastName).toBe('Smith');
  });

  it('prefers an unlabeled name over a nickname when there is no official or usual name', () => {
    const p = fromFhirPatient(
      { resourceType: 'Patient', id: 'p6', name: [{ use: 'nickname', given: ['Bobby'] }, { family: 'Smith', given: ['Robert'] }] },
      SYS
    );
    expect(p.demographics).toMatchObject({ firstName: 'Robert', lastName: 'Smith' });
  });

  it('honours ContactPoint.rank and skips phones whose period has ended', () => {
    const ranked = fromFhirPatient(
      {
        resourceType: 'Patient',
        id: 'p7',
        telecom: [
          { system: 'phone', value: '555-0002', use: 'home', rank: 2 },
          { system: 'phone', value: '555-0001', use: 'mobile', rank: 1 },
        ],
      },
      SYS
    );
    expect(ranked.contact).toEqual({ phone: '555-0001', phoneType: 'mobile' });
    const ended = fromFhirPatient(
      {
        resourceType: 'Patient',
        id: 'p8',
        telecom: [
          { system: 'phone', value: '555-0009', use: 'home', period: { end: '2015-01-01' } },
          { system: 'phone', value: '555-0003', use: 'mobile' },
        ],
      },
      SYS
    );
    expect(ended.contact).toEqual({ phone: '555-0003', phoneType: 'mobile' });
  });

  it('a current nickname beats a retired name listed first', () => {
    const p = fromFhirPatient(
      { resourceType: 'Patient', id: 'p9', name: [{ use: 'old', family: 'Former' }, { use: 'nickname', given: ['Bobby'] }] },
      SYS
    );
    expect(p.demographics).toMatchObject({ firstName: 'Bobby', lastName: '' });
  });

  it('falls back to an old name or phone when it is the only one', () => {
    const p = fromFhirPatient(
      {
        resourceType: 'Patient',
        id: 'p3',
        name: [{ use: 'old', family: 'Only' }],
        telecom: [{ system: 'phone', use: 'old', value: '555-0199' }],
      },
      SYS
    );
    expect(p.demographics.lastName).toBe('Only');
    expect(p.contact.phone).toBe('555-0199');
  });

  it('prefers a name with family or given over a text-only or data-absent official name', () => {
    const usual = { use: 'usual' as const, family: 'Smith', given: ['Mary'] };
    const absent = {
      use: 'official' as const,
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'masked' }],
    };
    for (const official of [{ use: 'official' as const, text: 'Smith, Mary' }, absent]) {
      const p = fromFhirPatient({ resourceType: 'Patient', id: 'p10', name: [official, usual] }, SYS);
      expect(p.demographics).toMatchObject({ firstName: 'Mary', lastName: 'Smith' });
    }
    // An old name with parts still beats a current one with none.
    const old = fromFhirPatient(
      { resourceType: 'Patient', id: 'p11', name: [{ use: 'official', text: 'X' }, { use: 'old', family: 'Former' }] },
      SYS
    );
    expect(old.demographics.lastName).toBe('Former');
  });

  it('ignores null placeholders in given (primitive-extension padding)', () => {
    const map = (given: unknown[]) =>
      fromFhirPatient(
        { resourceType: 'Patient', id: 'p12', name: [{ family: 'Smith', given: given as string[] }] },
        SYS
      ).demographics;
    expect(map([null, 'Ann'])).toEqual({ firstName: 'Ann', lastName: 'Smith', dateOfBirth: '' });
    expect(map(['Ann', null])).toEqual({ firstName: 'Ann', lastName: 'Smith', dateOfBirth: '' });
    expect(map([null, 'Ann', 'Lee'])).toMatchObject({ firstName: 'Ann', middleName: 'Lee' });
  });

  it('rejects a Patient with no id', () => {
    expect(() => fromFhirPatient({ resourceType: 'Patient' }, SYS)).toThrow('no id');
  });
});
