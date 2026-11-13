/**
 * Local visit times to FHIR dateTimes with the zone's offset for that date
 * (plan section 4: `YYYY-MM-DDTHH:MM:00±hh:mm`). Pure: depends only on Intl tz data.
 */

const MINUTE = 60_000;

/** One formatter per zone: constructing Intl.DateTimeFormat is far costlier than using it. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset in minutes of `timeZone` at the given instant, via Intl longOffset ("GMT-04:00"). */
function offsetMinutesAt(instant: number, timeZone: string): number {
  const name = formatterFor(timeZone)
    .formatToParts(new Date(instant))
    .find((p) => p.type === 'timeZoneName')?.value;
  if (name === undefined) throw new Error('no timeZoneName from Intl');
  if (name === 'GMT') return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!m) throw new Error('unexpected offset format from Intl');
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Offset that applies to wall-clock `date time` in `timeZone`, resolved like Temporal's
 * 'compatible' disambiguation so instants never run backward:
 * - normal time: the zone's only offset;
 * - fall-back overlap (the wall time happens twice): the earlier instant, i.e. the
 *   pre-transition offset;
 * - spring-forward gap (the wall time does not exist): the pre-transition offset, which
 *   lands the instant after the transition (02:15 in New York on 2026-03-08 becomes
 *   02:15-05:00, the same instant as 03:15-04:00).
 * The before/after offsets are read 12 hours either side of the approximate instant (not of
 * the naive UTC reading, which is up to 14 hours away in zones like Pacific/Kiritimati).
 * No zone changes offset twice within 24 hours.
 */
export function offsetFor(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const approx = naive - offsetMinutesAt(naive, timeZone) * MINUTE;
  const before = offsetMinutesAt(approx - 12 * 60 * MINUTE, timeZone);
  const after = offsetMinutesAt(approx + 12 * 60 * MINUTE, timeZone);
  const valid = (o: number) => offsetMinutesAt(naive - o * MINUTE, timeZone) === o;
  return formatOffset(!valid(before) && valid(after) ? after : before);
}

/** The calendar date after `date` (YYYY-MM-DD). */
export function nextDate(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

export function localDateTime(date: string, time: string, timeZone: string): string {
  return `${date}T${time}:00${offsetFor(date, time, timeZone)}`;
}

/** Encounter.period for a visit. With `overnight`, the end falls on the next date (Q8). */
export function visitPeriod(
  visitDate: string,
  timeIn: string,
  timeOut: string,
  timeZone: string,
  overnight = false
): { start: string; end: string } {
  const endDate = overnight ? nextDate(visitDate) : visitDate;
  const start = localDateTime(visitDate, timeIn, timeZone);
  const end = localDateTime(endDate, timeOut, timeZone);
  // FHIR per-1: start <= end. The schema orders wall-clock times; this guards the instants.
  if (Date.parse(end) <= Date.parse(start)) throw new Error('visit period does not run forward');
  return { start, end };
}

/** The calendar date (YYYY-MM-DD) of a FHIR instant as seen in `timeZone`. */
export function localDateOf(instant: string, timeZone: string): string | undefined {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return undefined;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
