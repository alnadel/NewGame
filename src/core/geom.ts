// 2D geometry on flat coordinate arrays [x0, y0, x1, y1, ...]. Convex polygons are counter-clockwise
// (x east, y north). Everything here is allocation-free except the builders explicitly documented
// as allocating (used only at generation time).

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** True when (px, py) is inside or on the CCW convex polygon `pts` with `n` vertices. */
export function pointInConvex(px: number, py: number, pts: Float64Array, n: number): boolean {
  let ax = pts[2 * n - 2] as number;
  let ay = pts[2 * n - 1] as number;
  for (let i = 0; i < n; i++) {
    const bx = pts[2 * i] as number;
    const by = pts[2 * i + 1] as number;
    // Left of (or on) every directed edge a→b.
    if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0) return false;
    ax = bx;
    ay = by;
  }
  return true;
}

/**
 * Liang-Barsky clip of the segment A + t·(B − A), t ∈ [0, 1], against a CCW convex polygon.
 * Returns the entry parameter t ∈ [0, 1] (0 when A is inside), or −1 when the segment misses.
 */
export function segmentEnterConvex(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  pts: Float64Array,
  n: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  let tEnter = 0;
  let tLeave = 1;
  let px = pts[2 * n - 2] as number;
  let py = pts[2 * n - 1] as number;
  for (let i = 0; i < n; i++) {
    const qx = pts[2 * i] as number;
    const qy = pts[2 * i + 1] as number;
    // Outward normal of CCW edge p→q is (ey, −ex).
    const nx = qy - py;
    const ny = px - qx;
    const num = (ax - px) * nx + (ay - py) * ny; // > 0: A is outside this edge
    const den = dx * nx + dy * ny;
    if (den === 0) {
      if (num > 0) return -1;
    } else {
      const t = -num / den;
      if (den < 0) {
        if (t > tEnter) tEnter = t;
      } else if (t < tLeave) {
        tLeave = t;
      }
      if (tEnter > tLeave) return -1;
    }
    px = qx;
    py = qy;
  }
  return tEnter;
}

/** True when the segment A→B touches the CCW convex polygon. */
export function segmentIntersectsConvex(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  pts: Float64Array,
  n: number,
): boolean {
  return segmentEnterConvex(ax, ay, bx, by, pts, n) >= 0;
}

/** Squared distance from P to the segment A→B. */
export function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Distance from P to a CCW convex polygon (0 when inside). */
export function distPointConvex(px: number, py: number, pts: Float64Array, n: number): number {
  if (pointInConvex(px, py, pts, n)) return 0;
  let best = Infinity;
  let ax = pts[2 * n - 2] as number;
  let ay = pts[2 * n - 1] as number;
  for (let i = 0; i < n; i++) {
    const bx = pts[2 * i] as number;
    const by = pts[2 * i + 1] as number;
    const d = distSqPointSegment(px, py, ax, ay, bx, by);
    if (d < best) best = d;
    ax = bx;
    ay = by;
  }
  return Math.sqrt(best);
}

/** True when segments A→B and C→D intersect (touching counts). */
export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (d2 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  if (d3 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (d4 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return (
    px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)
  );
}

/** Minimum distance between two CCW convex polygons (0 when they overlap or touch). */
export function convexDistance(a: Float64Array, na: number, b: Float64Array, nb: number): number {
  if (pointInConvex(a[0] as number, a[1] as number, b, nb)) return 0;
  if (pointInConvex(b[0] as number, b[1] as number, a, na)) return 0;
  let best = Infinity;
  for (let i = 0; i < na; i++) {
    const ax = a[2 * i] as number;
    const ay = a[2 * i + 1] as number;
    const j = (i + 1) % na;
    const bx = a[2 * j] as number;
    const by = a[2 * j + 1] as number;
    for (let k = 0; k < nb; k++) {
      const cx = b[2 * k] as number;
      const cy = b[2 * k + 1] as number;
      const l = (k + 1) % nb;
      const dx = b[2 * l] as number;
      const dy = b[2 * l + 1] as number;
      if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
      const d = Math.min(
        distSqPointSegment(ax, ay, cx, cy, dx, dy),
        distSqPointSegment(cx, cy, ax, ay, bx, by),
      );
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * Minkowski sum of a CCW convex polygon with the segment [0, (dx, dy)]: the area swept when the
 * polygon slides by (dx, dy). Writes a CCW convex polygon into `out` and returns its vertex count
 * (n, or n + 2 when d ≠ 0). This is exactly the shadow of a prism: hull(F ∪ (F − u·L)).
 */
export function sweepConvex(pts: Float64Array, n: number, dx: number, dy: number, out: Float64Array): number {
  if (dx === 0 && dy === 0) {
    for (let i = 0; i < 2 * n; i++) out[i] = pts[i] as number;
    return n;
  }
  // Edge i runs from vertex i to i+1. It is "front" (moves with the sweep) when its outward
  // normal has a positive component along d.
  let m = 0;
  let prevFront = edgeFront(pts, n, n - 1, dx, dy);
  for (let i = 0; i < n; i++) {
    const front = edgeFront(pts, n, i, dx, dy);
    const vx = pts[2 * i] as number;
    const vy = pts[2 * i + 1] as number;
    if (prevFront && front) {
      out[m++] = vx + dx;
      out[m++] = vy + dy;
    } else if (!prevFront && !front) {
      out[m++] = vx;
      out[m++] = vy;
    } else if (!prevFront && front) {
      out[m++] = vx;
      out[m++] = vy;
      out[m++] = vx + dx;
      out[m++] = vy + dy;
    } else {
      out[m++] = vx + dx;
      out[m++] = vy + dy;
      out[m++] = vx;
      out[m++] = vy;
    }
    prevFront = front;
  }
  return m / 2;
}

function edgeFront(pts: Float64Array, n: number, i: number, dx: number, dy: number): boolean {
  const j = i + 1 === n ? 0 : i + 1;
  const ex = (pts[2 * j] as number) - (pts[2 * i] as number);
  const ey = (pts[2 * j + 1] as number) - (pts[2 * i + 1] as number);
  // Outward normal (ey, −ex).
  return ey * dx - ex * dy > 0;
}

/**
 * Convex hull (Andrew's monotone chain) of `n` points, CCW, without collinear points.
 * Allocates; generation-time use only. Returns a new flat array.
 */
export function convexHull(pts: ArrayLike<number>, n: number): Float64Array {
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => {
    const dx = (pts[2 * a] as number) - (pts[2 * b] as number);
    if (dx !== 0) return dx;
    const dy = (pts[2 * a + 1] as number) - (pts[2 * b + 1] as number);
    return dy !== 0 ? dy : a - b;
  });
  const hull: number[] = [];
  const cross = (o: number, a: number, b: number): number =>
    ((pts[2 * a] as number) - (pts[2 * o] as number)) * ((pts[2 * b + 1] as number) - (pts[2 * o + 1] as number)) -
    ((pts[2 * a + 1] as number) - (pts[2 * o + 1] as number)) * ((pts[2 * b] as number) - (pts[2 * o] as number));
  for (const i of idx) {
    while (hull.length >= 2 && cross(hull[hull.length - 2] as number, hull[hull.length - 1] as number, i) <= 0) hull.pop();
    hull.push(i);
  }
  const lowerLen = hull.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k] as number;
    while (hull.length >= lowerLen && cross(hull[hull.length - 2] as number, hull[hull.length - 1] as number, i) <= 0) hull.pop();
    hull.push(i);
  }
  hull.pop();
  const out = new Float64Array(hull.length * 2);
  for (let k = 0; k < hull.length; k++) {
    out[2 * k] = pts[2 * (hull[k] as number)] as number;
    out[2 * k + 1] = pts[2 * (hull[k] as number) + 1] as number;
  }
  return out;
}

/**
 * Rectangle of full size w × d centered at (cx, cy), rotated CCW by the angle whose cos/sin are
 * given. Returns 4 CCW vertices (allocates).
 */
export function rectPoly(cx: number, cy: number, w: number, d: number, cosR: number, sinR: number): Float64Array {
  const hw = w / 2;
  const hd = d / 2;
  const out = new Float64Array(8);
  const corners = [-hw, -hd, hw, -hd, hw, hd, -hw, hd];
  for (let i = 0; i < 4; i++) {
    const lx = corners[2 * i] as number;
    const ly = corners[2 * i + 1] as number;
    out[2 * i] = cx + lx * cosR - ly * sinR;
    out[2 * i + 1] = cy + lx * sinR + ly * cosR;
  }
  return out;
}
