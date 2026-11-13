/**
 * What the FHIR server says it supports, read once from GET /metadata.
 *
 * US Core 9.0.0 makes only some searches SHALL, and R4 lets a server silently ignore an
 * unsupported search parameter. So anything beyond SHALL is gated here before it is sent:
 * phone search, Encounter class/type/identifier, and _revinclude (plan 3.3 and 3.4).
 */

import type { CapabilityStatement, CapabilityStatementRestResource } from 'fhir/r4.js';

import { UnsupportedServerError } from '../../utils/errors.js';

export interface ServerCapabilities {
  fhirVersion: string;
  /** Patient?phone= (not a US Core SHALL). */
  patientPhoneSearch: boolean;
  /** Encounter search by patient and date (US Core SHALL combination). */
  encounterSearch: boolean;
  /** Encounter?class= and ?type= (US Core SHOULD); filtered client-side when false. */
  encounterClassSearch: boolean;
  encounterTypeSearch: boolean;
  /** Encounter?identifier= (US Core SHOULD). No write without it: it is the duplicate check. */
  encounterIdentifierSearch: boolean;
  /** _revinclude of Observation:encounter and DocumentReference:encounter on Encounter. */
  encounterRevIncludes: boolean;
  /** `full` needs create on Encounter and Observation; otherwise only a note can be written. */
  writeProfile: 'full' | 'note-only';
}

export function parseCapabilities(cs: CapabilityStatement): ServerCapabilities {
  const fhirVersion = typeof cs.fhirVersion === 'string' ? cs.fhirVersion : '';
  if (!fhirVersion.startsWith('4.0')) {
    // The version string is server-supplied: report only that it is not R4.
    throw new UnsupportedServerError('FHIR server is not R4: /metadata fhirVersion must start with 4.0');
  }

  const rest = (cs.rest ?? []).find((r) => r.mode === 'server');
  const byType = new Map<string, CapabilityStatementRestResource>();
  for (const r of rest?.resource ?? []) byType.set(r.type, r);

  const can = (type: string, code: string) =>
    (byType.get(type)?.interaction ?? []).some((i) => i.code === code);
  const param = (type: string, name: string) =>
    can(type, 'search-type') && (byType.get(type)?.searchParam ?? []).some((p) => p.name === name);
  const revInclude = (type: string, value: string) => {
    const list = byType.get(type)?.searchRevInclude ?? [];
    // "Observation:encounter" may also be written with its target, "Observation:encounter:Encounter".
    return list.some((v) => v === '*' || v === value || v === `${value}:${type}`);
  };

  return {
    fhirVersion,
    patientPhoneSearch: param('Patient', 'phone'),
    encounterSearch: param('Encounter', 'patient') && param('Encounter', 'date'),
    encounterClassSearch: param('Encounter', 'class'),
    encounterTypeSearch: param('Encounter', 'type'),
    encounterIdentifierSearch: param('Encounter', 'identifier'),
    encounterRevIncludes:
      revInclude('Encounter', 'Observation:encounter') && revInclude('Encounter', 'DocumentReference:encounter'),
    writeProfile: can('Encounter', 'create') && can('Observation', 'create') ? 'full' : 'note-only',
  };
}
