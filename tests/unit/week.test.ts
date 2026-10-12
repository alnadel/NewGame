import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/meta/daily.ts';
import { emptyWeek } from '../../src/meta/save.ts';
import { markSunnyDay, mondayOf, sunnyDays, weekFor } from '../../src/meta/week.ts';

describe('Sunny Week dates', () => {
  it('finds the Monday of any date, across the DST weeks of 2026', () => {
    // EU summer time starts Sun 29 Mar, US Sun 8 Mar; EU ends Sun 25 Oct, US Sun 1 Nov.
    const cases: [string, string][] = [
      ['2026-03-08', '2026-03-02'],
      ['2026-03-09', '2026-03-09'],
      ['2026-03-29', '2026-03-23'],
      ['2026-03-30', '2026-03-30'],
      ['2026-10-25', '2026-10-19'],
      ['2026-10-26', '2026-10-26'],
      ['2026-11-01', '2026-10-26'],
      ['2026-11-02', '2026-11-02'],
      ['2027-01-01', '2026-12-28'],
    ];
    for (const [date, monday] of cases) expect(mondayOf(date), date).toBe(monday);
  });

  it('marks seven distinct days in a week whose Sunday changes the clocks', () => {
    const week = emptyWeek();
    for (let i = 0; i < 7; i++) markSunnyDay(week, addDays('2026-10-26', i), 1);
    expect(week).toMatchObject({ start: '2026-10-26', days: 127, paid: 7 });
    expect(sunnyDays(week)).toBe(7);
  });
});

describe('markSunnyDay', () => {
  it('pays 3, 5 and 7 sunny days once each, never twice for one date', () => {
    const week = emptyWeek();
    const paid: number[] = [];
    for (const date of ['2026-10-12', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
      paid.push(...markSunnyDay(week, date, 2).paid.map((p) => p.snow));
    }
    expect(paid).toEqual([30, 50, 80]);
    expect(week.best).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it('keeps the best Day reached per weekday', () => {
    const week = emptyWeek();
    markSunnyDay(week, '2026-10-14', 3);
    markSunnyDay(week, '2026-10-14', 1);
    markSunnyDay(week, '2026-10-18', 6);
    expect(week.best).toEqual([0, 0, 3, 0, 0, 0, 6]);
    expect(week.days).toBe(0b1000100);
  });

  it('rolls over on a new Monday and reports a closed week with 5+ sunny days', () => {
    const week = emptyWeek();
    for (let i = 0; i < 5; i++) markSunnyDay(week, addDays('2026-03-23', i), 1);
    // Two weeks later (a skipped week costs nothing): the old week still closes sunny.
    const r = markSunnyDay(week, '2026-04-08', 1);
    expect(r.closedSunny).toBe(true);
    expect(week).toEqual({ start: '2026-04-06', days: 0b100, paid: 0, best: [0, 0, 1, 0, 0, 0, 0] });
    for (let i = 0; i < 4; i++) markSunnyDay(week, addDays('2026-04-06', i), 1);
    expect(markSunnyDay(week, '2026-04-13', 1).closedSunny).toBe(false);
  });

  it('leaves a newer week alone when the device clock goes back', () => {
    const week = emptyWeek();
    markSunnyDay(week, '2026-10-20', 2);
    const before = structuredClone(week);
    expect(markSunnyDay(week, '2026-10-11', 4)).toEqual({ closedSunny: false, paid: [] });
    expect(week).toEqual(before);
  });

  it('shows an empty current week once the stored one is over', () => {
    const week = emptyWeek();
    markSunnyDay(week, '2026-10-12', 2);
    expect(weekFor(week, '2026-10-13')).toBe(week);
    expect(weekFor(week, '2026-10-19')).toEqual({ ...emptyWeek(), start: '2026-10-19' });
  });
});
