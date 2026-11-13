/**
 * FHIR Patient to the domain Patient (read path, used by the FHIR backend in PR6).
 *
 * `id.id` is the server id, so the tools and every later `subject` use `Patient/{id.id}`.
 * The PT-xxxxx identifier under `{sys}/patient-id` (Q2) becomes `id.mrn` when present.
 */

import type { ContactPoint, HumanName, Patient as FhirPatient } from 'fhir/r4.js';

import { identifierSystems } from './codes.js';
import type { Patient } from '../types/index.js';

/**
 * A name or phone is history when marked old/maiden or when its period has an end. The mapper
 * is pure, so an end date counts as ended without comparing it to today.
 */
const RETIRED_NAME_USES = new Set(['old', 'maiden']);
/** Never the legal name when anything better exists. */
const INFORMAL_NAME_USES = new Set(['nickname', 'anonymous', 'temp']);

const isCurrent = (x: { use?: string; period?: { end?: string } }, retired: Set<string>) =>
  !(x.use && retired.has(x.use)) && !x.period?.end;

/** FHIR JSON pads primitive arrays with null where an element has only an extension. */
const givenParts = (n: HumanName | undefined): string[] =>
  (n?.given ?? []).filter((g): g is string => typeof g === 'string' && g !== '');

const hasParts = (n: HumanName) => Boolean(n.family) || givenParts(n).length > 0;

function pickName(all: HumanName[] | undefined): HumanName | undefined {
  if (!all?.length) return undefined;
  // A text-only or data-absent name never beats one with family or given, whatever its use.
  const withParts = all.filter(hasParts);
  const names = withParts.length ? withParts : all;
  const current = names.filter((n) => isCurrent(n, RETIRED_NAME_USES));
  return (
    current.find((n) => n.use === 'official') ??
    current.find((n) => n.use === 'usual') ??
    current.find((n) => !n.use || !INFORMAL_NAME_USES.has(n.use)) ??
    current[0] ??
    names[0]
  );
}

const PHONE_USE_ORDER = ['home', 'mobile', 'work'];
const phoneUseRank = (use: string | undefined) => {
  const i = use ? PHONE_USE_ORDER.indexOf(use) : -1;
  return i === -1 ? PHONE_USE_ORDER.length : i;
};

/** Current phones by ContactPoint.rank (1 = preferred), then home, mobile, work, other. */
function pickPhone(telecom: ContactPoint[] | undefined): ContactPoint | undefined {
  const phones = (telecom ?? []).filter((t) => t.system === 'phone' && t.value);
  const current = phones.filter((t) => isCurrent(t, new Set(['old'])));
  const ranked = [...current].sort(
    (x, y) => (x.rank ?? Infinity) - (y.rank ?? Infinity) || phoneUseRank(x.use) - phoneUseRank(y.use)
  );
  return ranked[0] ?? phones[0];
}

const GENDERS = new Set(['male', 'female', 'other', 'unknown']);

export function fromFhirPatient(resource: FhirPatient, identifierSystem: string): Patient {
  if (!resource.id) throw new Error('FHIR Patient has no id');
  const name = pickName(resource.name);
  const given = givenParts(name);
  const ptSystem = identifierSystems(identifierSystem).patientId;
  const pt = resource.identifier?.find((i) => i.system === ptSystem)?.value;

  const phone = pickPhone(resource.telecom);

  return {
    id: { id: resource.id, ...(pt ? { mrn: pt } : {}) },
    demographics: {
      firstName: given[0] ?? '',
      lastName: name?.family ?? '',
      ...(given.length > 1 ? { middleName: given.slice(1).join(' ') } : {}),
      dateOfBirth: resource.birthDate ?? '',
      ...(resource.gender && GENDERS.has(resource.gender) ? { gender: resource.gender } : {}),
    },
    contact: {
      ...(phone?.value ? { phone: phone.value } : {}),
      ...(phone?.use === 'home' || phone?.use === 'mobile' || phone?.use === 'work' ? { phoneType: phone.use } : {}),
    },
    // Patient.active is the only status FHIR carries; discharged/pending have no equivalent (plan 3.4).
    status: resource.active === false ? 'inactive' : 'active',
    createdAt: resource.meta?.lastUpdated ?? '',
    updatedAt: resource.meta?.lastUpdated ?? '',
  };
}
