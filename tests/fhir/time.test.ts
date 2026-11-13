import { localDateTime, nextDate, offsetFor, visitPeriod } from '../../src/fhir/time.js';

describe('offsetFor', () => {
  it('uses EDT on the day DST starts (2026-03-08) and EST the day before', () => {
    expect(offsetFor('2026-03-08', '09:00', 'America/New_York')).toBe('-04:00');
    expect(offsetFor('2026-03-07', '09:00', 'America/New_York')).toBe('-05:00');
  });

  it('switches back on the day DST ends (2026-11-01)', () => {
    expect(offsetFor('2026-10-31', '09:00', 'America/New_York')).toBe('-04:00');
    expect(offsetFor('2026-11-01', '09:00', 'America/New_York')).toBe('-05:00');
  });

  it('formats UTC as +00:00 and keeps half-hour and positive offsets', () => {
    expect(offsetFor('2026-06-01', '12:00', 'UTC')).toBe('+00:00');
    expect(offsetFor('2026-06-01', '12:00', 'Asia/Kolkata')).toBe('+05:30');
    expect(offsetFor('2026-01-15', '12:00', 'America/St_Johns')).toBe('-03:30');
  });

  it('resolves a spring-forward gap time forward (pre-transition offset) in both hemispheres', () => {
    // 02:30-05:00 is 07:30Z, the same instant as 03:30 EDT.
    expect(offsetFor('2026-03-08', '02:30', 'America/New_York')).toBe('-05:00');
    // 02:30+01:00 is 01:30Z, the same instant as 03:30 CEST.
    expect(offsetFor('2026-03-29', '02:30', 'Europe/Berlin')).toBe('+01:00');
  });

  it('resolves gaps and overlaps correctly in zones beyond +12:00 (Auckland, Chatham)', () => {
    expect(offsetFor('2026-09-27', '02:30', 'Pacific/Auckland')).toBe('+12:00');
    expect(offsetFor('2026-04-05', '02:30', 'Pacific/Auckland')).toBe('+13:00');
    expect(offsetFor('2026-04-05', '02:00', 'Pacific/Chatham')).toBe('+13:45');
    expect(offsetFor('2026-09-27', '02:00', 'Pacific/Chatham')).toBe('+12:45');
    expect(offsetFor('2026-06-01', '12:00', 'Pacific/Kiritimati')).toBe('+14:00');
  });

  it('resolves a fall-back overlap time to the earlier instant', () => {
    expect(offsetFor('2026-11-01', '01:30', 'America/New_York')).toBe('-04:00');
    expect(offsetFor('2026-10-25', '02:30', 'Europe/Berlin')).toBe('+02:00');
  });
});

describe('nextDate', () => {
  it('rolls month, year and leap day', () => {
    expect(nextDate('2026-01-31')).toBe('2026-02-01');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
  });
});

describe('visitPeriod', () => {
  it('formats YYYY-MM-DDTHH:MM:00±hh:mm', () => {
    expect(localDateTime('2026-07-04', '08:15', 'America/Chicago')).toBe('2026-07-04T08:15:00-05:00');
  });

  it('ends on the next date for an overnight visit (23:30 to 00:15)', () => {
    expect(visitPeriod('2026-03-09', '23:30', '00:15', 'America/New_York', true)).toEqual({
      start: '2026-03-09T23:30:00-04:00',
      end: '2026-03-10T00:15:00-04:00',
    });
  });

  it('keeps the same date when not overnight', () => {
    expect(visitPeriod('2026-03-09', '09:00', '09:45', 'America/New_York')).toEqual({
      start: '2026-03-09T09:00:00-04:00',
      end: '2026-03-09T09:45:00-04:00',
    });
  });

  it.each([
    ['01:45', '02:15'],
    ['01:30', '02:20'],
    ['01:59', '02:00'],
    ['02:10', '03:15'],
  ])('a visit straddling the New York spring-forward gap (%s to %s) runs forward', (tin, tout) => {
    const p = visitPeriod('2026-03-08', tin, tout, 'America/New_York');
    expect(Date.parse(p.end)).toBeGreaterThan(Date.parse(p.start));
  });

  it('throws instead of emitting a backward period when a gap time resolves past the end', () => {
    // 02:10 does not exist; it resolves to 03:10 EDT, which is after 03:05.
    expect(() => visitPeriod('2026-03-08', '02:10', '03:05', 'America/New_York')).toThrow('does not run forward');
  });

  it('a visit straddling the Berlin spring-forward gap runs forward', () => {
    const p = visitPeriod('2026-03-29', '01:45', '02:15', 'Europe/Berlin');
    expect(Date.parse(p.end)).toBeGreaterThan(Date.parse(p.start));
  });

  it('New Zealand visits across the gap run forward with the right length', () => {
    const len = (d: string, a: string, b: string, z: string) => {
      const p = visitPeriod(d, a, b, z);
      return (Date.parse(p.end) - Date.parse(p.start)) / 60_000;
    };
    expect(len('2026-09-27', '01:45', '02:15', 'Pacific/Auckland')).toBe(-30 + 60);
    expect(len('2026-04-05', '01:50', '02:10', 'Pacific/Chatham')).toBe(20);
  });

  it('a visit inside the fall-back overlap runs forward', () => {
    const p = visitPeriod('2026-11-01', '01:10', '01:50', 'America/New_York');
    expect(Date.parse(p.end) - Date.parse(p.start)).toBe(40 * 60_000);
  });

  it('every minute of the New York DST days reads back as its wall clock, gap minutes as one hour later', () => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    for (const date of ['2026-03-08', '2026-11-01']) {
      for (let m = 0; m < 24 * 60; m++) {
        const hh = Math.floor(m / 60);
        const mm = String(m % 60).padStart(2, '0');
        const t = `${String(hh).padStart(2, '0')}:${mm}`;
        const inGap = date === '2026-03-08' && hh === 2;
        const want = inGap ? `03:${mm}` : t;
        expect(fmt.format(Date.parse(localDateTime(date, t, 'America/New_York')))).toBe(want);
      }
    }
  });

  it('gives each end of an overnight visit its own offset across a DST change', () => {
    expect(visitPeriod('2026-03-07', '23:30', '04:00', 'America/New_York', true)).toEqual({
      start: '2026-03-07T23:30:00-05:00',
      end: '2026-03-08T04:00:00-04:00',
    });
  });

  it('matches a brute-force oracle every 15 minutes of every 2026 transition day in every IANA zone', () => {
    // Oracle: all offsets the zone uses within a day either side; a candidate o is valid when
    // the instant naive - o really has offset o. Expected = Temporal 'compatible'.
    const fmts = new Map<string, Intl.DateTimeFormat>();
    const offsetAt = (ms: number, tz: string) => {
      let f = fmts.get(tz);
      if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })));
      const name = f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
      const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
      return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
    };
    const fmt = (o: number) =>
      `${o < 0 ? '-' : '+'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}:${String(Math.abs(o) % 60).padStart(2, '0')}`;
    const H = 3_600_000;
    let checked = 0;
    for (const tz of Intl.supportedValuesOf('timeZone')) {
      for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2027, 0, 1); day += 24 * H) {
        if (offsetAt(day - 14 * H, tz) === offsetAt(day + 38 * H, tz)) continue;
        const date = new Date(day).toISOString().slice(0, 10);
        for (let m = 0; m < 24 * 60; m += 15) {
          const naive = day + m * 60_000;
          const cands = [...new Set([offsetAt(naive - 26 * H, tz), offsetAt(naive + 26 * H, tz)])];
          const valid = cands.filter((o) => offsetAt(naive - o * 60_000, tz) === o);
          const pre = offsetAt(naive - 26 * H, tz);
          const want = valid.length === 1 ? valid[0] : valid.length === 0 ? pre : Math.max(...valid);
          const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          const got = offsetFor(date, t, tz);
          if (got !== fmt(want)) throw new Error(`${tz} ${date} ${t}: got ${got}, want ${fmt(want)}`);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5_000);
  });
});
