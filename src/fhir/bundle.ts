/**
 * Visit to one transaction Bundle (plan 3.3 step 4).
 *
 * Every entry: fullUrl urn:uuid, request POST <Type>. The Encounter also sets
 * request.ifNoneExist on the visit identifier as the second line of defense against
 * duplicates; the pre-flight search (PR7) is the first.
 */

import { randomUUID } from 'node:crypto';
import type { Bundle, BundleEntry, FhirResource, Reference } from 'fhir/r4.js';

import { visitFacts } from './context.js';
import type { VisitMappingContext } from './context.js';
import { buildEncounter } from './encounter.js';
import { buildNote } from './note.js';
import { buildProcedures } from './procedures.js';
import { buildVitals } from './vitals.js';
import type { CreateVisitNoteParams } from '../types/index.js';

export type WriteProfile = 'full' | 'note-only';

export interface BundleOptions {
  profile: WriteProfile;
  /** Injectable for deterministic golden files; defaults to crypto.randomUUID. */
  newId?: () => string;
}

export function buildVisitBundle(
  note: CreateVisitNoteParams,
  ctx: VisitMappingContext,
  opts: BundleOptions
): Bundle<FhirResource> {
  const newId = opts.newId ?? randomUUID;
  const facts = visitFacts(note, ctx);
  const entries: BundleEntry<FhirResource>[] = [];
  const add = (resource: FhirResource, ifNoneExist?: string): string => {
    const fullUrl = `urn:uuid:${newId()}`;
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: resource.resourceType, ...(ifNoneExist ? { ifNoneExist } : {}) },
    });
    return fullUrl;
  };

  if (opts.profile === 'note-only') {
    const doc = buildNote(note, ctx, facts, { includeVisitAndVitals: true });
    // The header line is always present, so note-only always has a document.
    if (doc) add(doc);
    return { resourceType: 'Bundle', type: 'transaction', entry: entries };
  }

  const encounter = buildEncounter(note, ctx, facts);
  const encRef: Reference = {
    // Plan 3.3 step 4 form. The system is a URL and the key a UUID or hex digest, so
    // neither needs escaping inside the query string.
    reference: add(encounter, `identifier=${facts.systems.visit}|${ctx.idempotencyKey}`),
  };
  for (const obs of buildVitals(note.vitalSigns, ctx, facts, encRef)) add(obs);
  for (const proc of buildProcedures(note, ctx, facts, encRef)) add(proc);
  const doc = buildNote(note, ctx, facts, { encounter: encRef, includeVisitAndVitals: false });
  if (doc) add(doc);

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}
