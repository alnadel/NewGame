// Canonical score/time formatting shared by sim, HUD, results and share text.
// Score unit: in-game minutes M = (day-1)*720 + minutesSince6AM, where a daylight lasts 720 min (6 AM-6 PM).

export const MINUTES_PER_DAY = 720;

/** "h:mm AM/PM" for minutes since 6:00 AM within a day (0..720). */
export function formatTimeOfDay(minutesSince6: number): string {
  const total = 6 * 60 + Math.floor(minutesSince6);
  const h24 = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm < 10 ? '0' : ''}${mm} ${suffix}`;
}

/** Same as formatTimeOfDay but floored to 10-minute steps (in-play HUD, avoids digit flicker). */
export function formatTimeOfDay10(minutesSince6: number): string {
  return formatTimeOfDay(Math.floor(minutesSince6 / 10) * 10);
}

/** Splits a score into day (1-based) and minutes since 6 AM. */
export function splitMinutes(m: number): { day: number; minute: number } {
  const day = Math.floor(m / MINUTES_PER_DAY) + 1;
  return { day, minute: m - (day - 1) * MINUTES_PER_DAY };
}

/** "Day 3 · 2:40 PM" */
export function formatScore(m: number): string {
  const { day, minute } = splitMinutes(m);
  return `Day ${day} · ${formatTimeOfDay(minute)}`;
}
