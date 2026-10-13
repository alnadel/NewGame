import { describe, expect, it } from 'vitest';
import { dayParams } from '../../src/config/days.ts';
import {
  dayAtTick,
  dayLength,
  dayStartTick,
  dayStartY,
  dayTicks,
  elevation,
  exactClock,
  hudClock,
  minutesOfDay,
  nightLength,
  nightTicks,
  noonBannerTick,
  noonPassedTick,
  scoreMinutes,
  timeAtY,
  yAtDayTick,
  yAtTick,
  type YTime,
} from '../../src/core/clock.ts';
import { formatScore } from '../../src/core/format.ts';

describe('clock', () => {
  it('elevation is 6° at dawn and dusk and εnoon at noon, per profile', () => {
    const noon = [48, 58, 66, 72, 76, 76, 76, 76, 76, 80, 80];
    for (let d = 1; d <= noon.length; d++) {
      const p = dayParams(d, 3);
      expect(elevation(p, 0)).toBe(6);
      expect(elevation(p, p.dayLen / 2)).toBe(noon[d - 1]);
      expect(Math.abs(elevation(p, p.dayLen) - 6)).toBeLessThan(1e-12);
    }
    expect(elevation(dayParams(1, 0), 25)).toBe(40);
    expect(elevation(dayParams(1, 1), 25)).toBe(44);
    expect(elevation(dayParams(1, 2), 25)).toBe(48);
    expect(elevation(dayParams(2, 0), 25)).toBe(58);
    expect(elevation(dayParams(1, 3), -1)).toBe(0);
  });

  it('day and night lengths ramp per V1_PLAN §4.1', () => {
    expect([1, 2, 3, 4, 5].map(dayLength)).toEqual([50, 50, 50, 50, 50]);
    expect([6, 7, 8, 9, 10, 11].map(dayLength)).toEqual([45, 45, 45, 45, 45, 45]);
    expect([6, 7, 8, 9, 10, 11, 12].map(nightLength)).toEqual([8, 7.5, 7, 6.5, 6, 5.5, 5]);
    expect(nightLength(30)).toBe(5);
    for (let d = 1; d < 40; d++) {
      expect(Number.isInteger(dayTicks(d))).toBe(true);
      expect(Number.isInteger(nightTicks(d))).toBe(true);
      expect(dayTicks(d) % 12).toBe(0);
    }
  });

  it('score minutes and labels', () => {
    // Day 2 · 2:40 PM = 720 + 520 = 1240 (the challenge-code example).
    const t240 = Math.ceil((520 / 720) * dayTicks(2));
    expect(scoreMinutes(2, t240)).toBe(1240);
    expect(formatScore(1240)).toBe('Day 2 · 2:40 PM');
    expect(formatScore(2 * 720 + 520)).toBe('Day 3 · 2:40 PM');
    expect(minutesOfDay(1, 0)).toBe(0);
    expect(minutesOfDay(1, dayTicks(1))).toBe(720);
    expect(minutesOfDay(1, dayTicks(1) + 100)).toBe(720);
    expect(exactClock(1, Math.ceil((367 / 720) * 3000))).toBe('12:07 PM');
    expect(hudClock(1, Math.ceil((367 / 720) * 3000))).toBe('12:00 PM');
    expect(hudClock(1, 0)).toBe('6:00 AM');
  });

  it('absolute ticks and y are cumulative over days', () => {
    expect(dayStartTick(1)).toBe(0);
    expect(dayStartTick(2)).toBe(3000 + 480);
    expect(dayStartY(2)).toBe(70 * 50 + 8 * 70);
    expect(dayStartY(3)).toBe(4060 + 80 * 50 + 8 * 80);
    expect(dayAtTick(0)).toBe(1);
    expect(dayAtTick(3479)).toBe(1);
    expect(dayAtTick(3480)).toBe(2);
    expect(yAtDayTick(1, 3000)).toBe(3500);
    expect(yAtDayTick(1, 3480)).toBe(4060);
    expect(yAtTick(dayStartTick(5) + 600)).toBe(dayStartY(5) + 110 * 10);
  });

  it('timeAtY inverts yAtDayTick in daylight and at night', () => {
    const out: YTime = { day: 0, dayTick: 0, night: false };
    for (let d = 1; d <= 12; d++) {
      const total = dayTicks(d) + nightTicks(d);
      for (let k = 0; k < total; k += 37) {
        const y = yAtDayTick(d, k);
        timeAtY(y, out);
        expect(out.day).toBe(d);
        expect(Math.abs(out.dayTick - k)).toBeLessThan(1e-6);
        expect(out.night).toBe(k > dayTicks(d));
      }
    }
    timeAtY(-50, out);
    expect(out.day).toBe(1);
    expect(out.dayTick).toBeLessThan(0);
  });

  it('noon banner and noon passed ticks', () => {
    expect(noonBannerTick(1)).toBe(23 * 60);
    expect(noonPassedTick(1)).toBe(30 * 60);
    expect(noonBannerTick(7)).toBe(Math.round(20.5 * 60));
    expect(noonPassedTick(7)).toBe(27 * 60);
  });
});
