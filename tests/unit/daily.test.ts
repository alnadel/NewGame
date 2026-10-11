import { describe, expect, it } from 'vitest';
import { hashString } from '../../src/core/rng.ts';
import {
  addDays,
  dailyNumber,
  dailySeed,
  daysBetween,
  formatDateLabel,
  isDateString,
  localDate,
  recentDates,
} from '../../src/meta/daily.ts';

describe('daily numbering', () => {
  it('numbers 2026-10-11 as #284', () => {
    expect(dailyNumber('2026-10-11')).toBe(284);
  });

  it('starts at #1 on 2026-01-01 and keeps counting across years', () => {
    expect(dailyNumber('2026-01-01')).toBe(1);
    expect(dailyNumber('2026-12-31')).toBe(365);
    expect(dailyNumber('2027-01-01')).toBe(366);
  });
});

describe('daily seed', () => {
  it('is xmur3("shady-daily-YYYY-MM-DD") and stable', () => {
    expect(dailySeed('2026-10-11')).toBe(hashString('shady-daily-2026-10-11'));
    expect(dailySeed('2026-10-11')).toBe(dailySeed('2026-10-11'));
    expect(dailySeed('2026-10-11')).not.toBe(dailySeed('2026-10-12'));
    expect(Number.isInteger(dailySeed('2026-10-11'))).toBe(true);
    expect(dailySeed('2026-10-11')).toBeGreaterThanOrEqual(0);
  });
});

describe('local date helpers', () => {
  it('formats the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11');
    expect(localDate(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02');
  });

  it('validates real dates only', () => {
    expect(isDateString('2026-10-11')).toBe(true);
    expect(isDateString('2028-02-29')).toBe(true);
    expect(isDateString('2026-02-29')).toBe(false);
    expect(isDateString('2026-13-01')).toBe(false);
    expect(isDateString('2026-1-1')).toBe(false);
    expect(isDateString('')).toBe(false);
  });

  it('does day arithmetic across months, years and DST changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
  });

  it('lists recent dates newest first', () => {
    expect(recentDates('2026-10-02', 4)).toEqual(['2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29']);
  });

  it('labels dates in English', () => {
    expect(formatDateLabel('2026-10-11')).toBe('Sun, Oct 11');
    expect(formatDateLabel('2026-01-01')).toBe('Thu, Jan 1');
  });
});
