/**
 * Domain unit to UCUM. Exhaustive typed records: an unknown unit is a compile error,
 * never a string passed through. US Core binds temperature and weight units with a
 * required binding (ucum-bodytemp, ucum-bodyweight), so `F` or `lbs` must never reach FHIR.
 */

import type { Quantity } from 'fhir/r4.js';

import { UCUM } from './codes.js';
import type { VitalSigns } from '../types/index.js';

type TempUnit = NonNullable<VitalSigns['temperatureUnit']>;
type WeightUnit = NonNullable<VitalSigns['weightUnit']>;

export const TEMPERATURE_UCUM: Readonly<Record<TempUnit, { code: string; unit: string }>> = {
  F: { code: '[degF]', unit: 'degF' },
  C: { code: 'Cel', unit: 'C' },
};

export const WEIGHT_UCUM: Readonly<Record<WeightUnit, { code: string; unit: string }>> = {
  lbs: { code: '[lb_av]', unit: 'lb' },
  kg: { code: 'kg', unit: 'kg' },
};

export const UCUM_FIXED = {
  mmHg: { code: 'mm[Hg]', unit: 'mmHg' },
  perMin: { code: '/min', unit: '/min' },
  percent: { code: '%', unit: '%' },
  litersPerMin: { code: 'L/min', unit: 'L/min' },
  mgPerDl: { code: 'mg/dL', unit: 'mg/dL' },
} as const;

export function quantity(value: number, u: { code: string; unit: string }): Quantity {
  return { value, unit: u.unit, system: UCUM, code: u.code };
}
