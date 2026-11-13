/**
 * Duplicate-visit pre-flight (plan 3.3 step 3). Runs before any write.
 *
 * The check is `GET Encounter?identifier={sys}/visit|{key}`. US Core lists that search as
 * SHOULD, and R4 lets a server ignore a parameter it does not support, in which case the
 * answer is an unfiltered Encounter list: one Encounter on the server would mark every new
 * visit as already charted. So the answer only counts when all of these hold:
 *   1. /metadata advertises Encounter `identifier` search,
 *   2. the request asked for strict handling,
 *   3. the Bundle self link shows `identifier` was applied,
 *   4. every returned Encounter carries exactly that identifier.
 * Otherwise the write is refused. Dedupe is never skipped.
 */

import type { Encounter } from 'fhir/r4.js';

import { identifierSystems } from '../../fhir/codes.js';
import { WriteRefusedError } from '../../utils/errors.js';
import { escapeSearchValue } from './client.js';
import { appliedParams } from './read.js';
import type { ReadDeps } from './read.js';

export const PREFLIGHT_REFUSAL = 'server cannot prove identifier search; refusing write to avoid duplicates';

/** Encounters already holding this visit key. Throws WriteRefusedError when the check cannot be trusted. */
export async function preflightVisit(deps: ReadDeps, idempotencyKey: string): Promise<Encounter[]> {
  if (!deps.caps.encounterIdentifierSearch) throw new WriteRefusedError(PREFLIGHT_REFUSAL);

  const system = identifierSystems(deps.identifierSystem).visit;
  const bundle = await deps.client.search(
    'Encounter',
    [['identifier', `${system}|${escapeSearchValue(idempotencyKey)}`]],
    { prefer: 'handling=strict' }
  );

  if (!appliedParams(bundle).has('identifier')) throw new WriteRefusedError(PREFLIGHT_REFUSAL);

  const encounters = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is Encounter => r?.resourceType === 'Encounter');
  const exact = (e: Encounter) => (e.identifier ?? []).some((i) => i.system === system && i.value === idempotencyKey);
  if (!encounters.every(exact)) throw new WriteRefusedError(PREFLIGHT_REFUSAL);
  return encounters;
}
