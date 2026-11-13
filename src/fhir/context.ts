/**
 * Inputs every visit mapper shares. Built once per write by the FHIR backend (PR7).
 */

import type { Meta, Reference } from 'fhir/r4.js';

import { DEV_TAG_CODE, identifierSystems } from './codes.js';
import { visitPeriod } from './time.js';
import type { CreateVisitNoteParams } from '../types/index.js';

export interface VisitMappingContext {
  /** Resolved server reference; every `subject` uses it (plan 3.1). */
  patient: `Patient/${string}`;
  practitioner: { reference: `Practitioner/${string}`; display: string };
  /** FHIR_IDENTIFIER_SYSTEM base (Q2). */
  identifierSystem: string;
  timezone: string;
  idempotencyKey: string;
  /** Adds meta.tag chartinghero-dev (plan 3.3 step 7). */
  devTag: boolean;
}

/** Derived once per visit and passed to each resource builder. */
export interface VisitFacts {
  period: { start: string; end: string };
  subject: Reference;
  performer: Reference;
  systems: ReturnType<typeof identifierSystems>;
}

export function visitFacts(note: CreateVisitNoteParams, ctx: VisitMappingContext): VisitFacts {
  return {
    period: visitPeriod(note.visitDate, note.timeIn, note.timeOut, ctx.timezone, note.overnight === true),
    subject: { reference: ctx.patient },
    performer: { reference: ctx.practitioner.reference, display: ctx.practitioner.display },
    systems: identifierSystems(ctx.identifierSystem),
  };
}

export function meta(ctx: VisitMappingContext, profile?: string): Meta | undefined {
  const m: Meta = {};
  if (profile) m.profile = [profile];
  if (ctx.devTag) m.tag = [{ system: ctx.identifierSystem, code: DEV_TAG_CODE }];
  return m.profile || m.tag ? m : undefined;
}
