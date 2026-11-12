/**
 * Shared zod building blocks for tool input schemas.
 *
 * Error messages name the rule, never the submitted value: the SDK copies them
 * into the tool result, and a value can be PHI.
 */

import { z } from 'zod';

export const VISIT_TYPES = [
  'skilled_nursing',
  'physical_therapy',
  'occupational_therapy',
  'speech_therapy',
  'home_health_aide',
  'social_work',
  'initial_assessment',
  'recertification',
  'discharge',
  'other',
] as const;

export const visitTypeSchema = z.enum(VISIT_TYPES);

/** True when YYYY-MM-DD names a real calendar date (rejects 2025-02-30). */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const dateSchema = z
  .string()
  .refine(isRealDate, { message: 'must be a real date in YYYY-MM-DD format' });

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'must be HH:MM in 24-hour time' });

/** Minutes since midnight for a value that already passed timeSchema. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .refine(isIanaTimeZone, { message: 'must be an IANA time zone, e.g. America/New_York' });

export const limitSchema = z
  .number()
  .int({ message: 'must be an integer' })
  .min(1, { message: 'must be between 1 and 50' })
  .max(50, { message: 'must be between 1 and 50' });

export const requiredText = z.string().trim().min(1, { message: 'is required' });

/**
 * Options for z.strictObject: zod's default unrecognized_keys message lists the
 * caller's key names, which are submitted text, so replace it with a fixed one.
 */
export const STRICT = {
  error: (issue: { code?: string }) =>
    issue.code === 'unrecognized_keys' ? 'unknown field; check the tool schema for allowed names' : undefined,
};
