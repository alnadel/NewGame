// Controls v3 Gust vane predictions (docs/CONTROLS_V3.md §3.5; CORE): where a cloud lands with the
// vane held at a notch (the arrival ghost) and if you calm now (the calm-now ghost, today's weatherXAt).

import { TUNING } from '../../config/tuning.ts';
import { DT } from '../clock.ts';
import { EL_GONE, type ElObj } from '../objects.ts';
import { arriveTicks, inWeather, weatherXAt } from '../sim/elements.ts';
import type { SimState } from '../sim/types.ts';

const G = TUNING.elements.gust;
const DG = TUNING.drive.gust;

/**
 * §3.5: weather object o's x after `ticks` with the vane held at notch n: the governor's gusts
 * simulated tick by tick (at most 600) as the driver and step() would play them, with no Lift limit, the next gust
 * free to come at once and the fog muffle of where the walker stands now. n = 0 is "calm now":
 * exactly weatherXAt (no gust, the wind decays).
 */
export function driveWeatherX(s: SimState, o: ElObj, ticks: number, n: number): number {
  const el = s.el;
  const t = s.trial;
  if (n === 0 || el === null || t === null || o.state === EL_GONE || (o.kind !== 'rain' && o.kind !== 'fog')) return weatherXAt(s, o, ticks);
  const sg = n > 0 ? 1 : -1;
  const band = DG.band[sg * n] as number;
  const kick = sg * G.kick * (inWeather(el, 'fog', s.nubs.x, s.nubs.y) ? G.fogMuffle : 1);
  const gain = o.kind === 'rain' ? G.rainGain : G.fogGain;
  const from = o.awake ? 0 : arriveTicks(s, o.y - TUNING.elements.weather.wake);
  const m = ticks < 600 ? ticks : 600;
  let x = o.x;
  let w = el.wind;
  let last = -DG.every;
  for (let k = 1; k <= m; k++) {
    // The governor decides on the wind it sees; step() adds the kick, then decays the wind.
    if (sg * w < band && k - 1 - last >= DG.every) {
      w += kick;
      w = w > G.windMax ? G.windMax : w < -G.windMax ? -G.windMax : w;
      last = k - 1;
    }
    const v = w * G.keep;
    w = v < 0.01 && v > -0.01 ? 0 : v;
    if (k >= from) x += (o.drift + gain * (w + t.breeze)) * DT;
  }
  return x;
}
