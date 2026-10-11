// Frame-time governor (TECH_SPEC §15): rolling mean over 120 frames; above 20 ms it steps quality
// down one notch every 3 s — DPR 1 → 0.75 → 0.625 of the cap, then particles 400 → 200, then the
// ground detail tiles off. It never steps back up within a session.

const WINDOW = 120;
const LIMIT_MS = 20;
const COOLDOWN_S = 3;

export class Governor {
  enabled = true;
  level = 0;
  dprScale = 1;
  particleCap = 400;
  detail = true;
  private readonly samples = new Float32Array(WINDOW);
  private head = 0;
  private count = 0;
  private sum = 0;
  private cooldown = COOLDOWN_S;
  /** Called after a change of DPR scale. */
  onChange: (() => void) | null = null;

  get mean(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  /** Feed one frame interval (ms). Ignores huge gaps (tab switches). */
  sample(ms: number, dtReal: number): void {
    if (!this.enabled || ms > 250) return;
    this.sum -= this.samples[this.head] as number;
    this.samples[this.head] = ms;
    this.sum += ms;
    this.head = (this.head + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
    this.cooldown -= dtReal;
    if (this.count < WINDOW || this.cooldown > 0 || this.mean <= LIMIT_MS) return;
    this.stepDown();
  }

  private stepDown(): void {
    if (this.level >= 4) return;
    this.level++;
    this.cooldown = COOLDOWN_S;
    this.samples.fill(0);
    this.sum = 0;
    this.count = 0;
    switch (this.level) {
      case 1:
        this.dprScale = 0.75;
        break;
      case 2:
        this.dprScale = 0.625;
        break;
      case 3:
        this.particleCap = 200;
        break;
      case 4:
        this.detail = false;
        break;
    }
    this.onChange?.();
  }
}
