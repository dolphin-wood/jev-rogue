/**
 * Three vector drawings that belong to the enemies rather than to the floor:
 * the boss's travelling shockwave, the hurry a bell's ringing puts on a body,
 * and the pulse of light a toll sends down a ward line.
 *
 * They live outside the play scene, against the smallest slice of Phaser's
 * `Graphics` they need (`Pen`), for one reason: **they can be rendered
 * headless**. A ring whose geometry is wrong is not something a test can
 * catch and not something the sim knows about, so the harness bakes these
 * into a PNG and the drawing that ships is the drawing that was looked at.
 */

/** The part of `Phaser.GameObjects.Graphics` these drawings use. */
export interface Pen {
  lineStyle(width: number, colour: number, alpha?: number): unknown;
  fillStyle(colour: number, alpha?: number): unknown;
  strokeCircle(x: number, y: number, r: number): unknown;
  fillCircle(x: number, y: number, r: number): unknown;
  fillRect(x: number, y: number, w: number, h: number): unknown;
  lineBetween(x0: number, y0: number, x1: number, y1: number): unknown;
  beginPath(): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise?: boolean): unknown;
  strokePath(): unknown;
  fillPath(): unknown;
}

/** The boss's ground shockwave: the broken stone, and its leading edge. */
// The band's leading edge in the king's wave gold (`TELE_WAVE`): what runs along his floor is one colour.
export const SHOCK_COLOUR = 0xffc21a;
export const SHOCK_CORE = 0xfff6c8;
/** A bell's hurry, and the light a toll sends down a ward line. */
export const HASTE_COLOUR = 0xffd98a;
const PULSE_CORE = 0xfff6e0;

/**
 * **The pixel the shockwave is drawn on**: 2 world units, which is 4 art
 * pixels at `ART_SCALE`.
 *
 * Everything below snaps to this grid, and that is the whole difference
 * between the old drawing and this one. The ring was three smooth
 * `strokeCircle`s and a hatch, and a smooth curve in a game whose every other
 * pixel sits on a grid does not read as a thing in the world — it reads as an
 * overlay, which is what "cheap" meant. A stepped circle is a *drawn* circle:
 * the steps are where the stone broke.
 *
 * Two units rather than one because a step has to be visible to be a step. At
 * one unit the quantisation is invisible at the game's zoom and the ring is
 * back to looking smooth; at four the band's own 34 units is only eight cells
 * thick and the shape stops being a circle.
 */
export const SHOCK_PIX = 2;

/**
 * The shockwave's palette, and the reason it needs two layers.
 *
 * Upturned earth is **darker** than the floor it came out of, and the floor is
 * already dark, so none of it can be drawn additively — an additive layer can
 * only ever add light. The soil, its furrow shadow and the settling dust go on
 * a normal-blended pen; the hot leading edge and the embers in the crack go on
 * the additive one. What the player reads is the bright edge; what makes it
 * look like ground rather than a ring of light is everything behind it.
 */
const SHOCK_SOIL = 0x6d4733;
const SHOCK_SOIL_LIT = 0x9a6a44;
const SHOCK_FURROW = 0x241a2c;
const SHOCK_DUST = 0xb49a86;

/** The shape a shockwave is drawn from; `Shockwave` in the sim satisfies it. */
export interface ShockwaveLike {
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly chargeMs: number;
  readonly chargeMaxMs: number;
  readonly inner: number;
  readonly thickness: number;
  readonly maxRadius: number;
}

/**
 * The world rectangle worth drawing into.
 *
 * A late shockwave's outer edge is most of a room across, and scan-converting
 * all of it costs a few thousand rectangles a frame for a ring that is almost
 * entirely off-camera. The caller passes what the camera can see and the scan
 * is clipped to it; the geometry is unchanged, so the part that *is* on screen
 * is identical either way.
 */
export interface ViewBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Snap to the drawing grid, down and up. */
function floorPix(v: number): number { return Math.floor(v / SHOCK_PIX) * SHOCK_PIX; }
function ceilPix(v: number): number { return Math.ceil(v / SHOCK_PIX) * SHOCK_PIX; }

/**
 * A deterministic hash of an integer, in [0, 1).
 *
 * Deterministic because the breakage has to **stay where it is** as the ring
 * grows: a pattern reseeded per frame crawls, and crawling noise on a thing
 * that is already moving outward is the single most reliable way to make a
 * pixel effect look like static.
 */
function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 4096) / 4096;
}

/**
 * The boss's **ground shockwave**, drawn as a true circle on the pixel grid.
 *
 * An ellipse was tried for it and rejected: a flattened ring reads as a decal
 * painted on the floor in perspective, and this is not a decal, it is a thing
 * arriving. The sim's geometry is a circle, so the drawing is a circle, and
 * the two agree — `shockwaveHits` takes the band between `inner` and `inner +
 * thickness` and so does every scanline here, to within the one cell that
 * snapping to the grid costs.
 *
 * Three states, one shape:
 *
 * - **Charging.** A still, dim stepped ring at the birth radius, tightening
 *   and brightening as the charge runs out, with dust drawn *inward* so the
 *   eye reads "gathering, not yet".
 * - **Travelling.** Scan-converted row by row into runs of soil, with a dark
 *   furrow along the trailing edge, a lit crest, thrown debris ahead of the
 *   front and a crisp two-cell **leading edge** on the outside. That edge is
 *   the brightest thing in the drawing because it is the only part whose
 *   position the player has to read.
 * - **Fading.** Alpha falls away over the last 60 px of the run, so the band
 *   leaves rather than blinking out at `maxRadius`.
 */
export function drawShockwaves(
  ground: Pen, glow: Pen, waves: readonly ShockwaveLike[], nowMs: number, view: ViewBox,
): void {
  for (const s of waves) {
    if (!s.alive) continue;
    if (s.chargeMs > 0) { drawShockCharge(ground, glow, s, nowMs, view); continue; }
    drawShockBand(ground, glow, s, view);
  }
}

/**
 * One run across the annulus, painted **from its outer edge inward** in bands.
 *
 * This is where the pixel-art reading comes from, and it is worth saying why
 * the obvious alternative is not used. Colouring the annulus per cell — a true
 * dither over the whole band — is thousands of rectangles a frame at the radii
 * this ring reaches, and Phaser's `Graphics` pays for every one. Painting each
 * run as five hard-edged blocks costs five, reads as the same thing, and has
 * one property a per-cell dither does not: **the bands are measured from the
 * front**, so the crest and the furrow stay the same width all the way round
 * as the ring grows, the way a real furrow would.
 *
 * The run goes along `axis`, starting at the outer edge `edge` and running
 * inward by `span`, with `dir` saying which way inward is.
 */
function shockRun(
  ground: Pen, glow: Pen, axis: "x" | "y", across: number, edge: number,
  dir: 1 | -1, span: number, fade: number, seed: number,
): void {
  const P = SHOCK_PIX;
  if (span < P) return;
  // One cell of jitter per run, so the boundaries between the bands are a
  // torn line rather than a second set of clean circles.
  const j = hash01(seed) > 0.5 ? 1 : 0;
  const j2 = hash01(seed + 991) > 0.55 ? 1 : 0;

  const block = (from: number, cells: number, pen: Pen, colour: number, alpha: number): void => {
    const w = Math.min(cells * P, span - from * P);
    if (w <= 0) return;
    const at = dir > 0 ? edge + from * P : edge - from * P - w;
    pen.fillStyle(colour, alpha);
    if (axis === "x") pen.fillRect(at, across, w, P);
    else pen.fillRect(across, at, P, w);
  };

  // The bed: everything in the band is soil before anything is drawn on it.
  block(0, Math.ceil(span / P), ground, SHOCK_SOIL, 0.62 * fade);
  // Turned earth, brightest just behind the front and falling away.
  block(1, 3 + j, ground, SHOCK_SOIL_LIT, 0.8 * fade);
  block(4 + j, 3, ground, SHOCK_SOIL, 0.85 * fade);
  // The furrow the stone lifted out of: dark, and the deepest part of it.
  block(9 + j + j2, 5, ground, SHOCK_FURROW, 0.55 * fade);
  // The leading edge: two cells of ember, one of white heat. Additive, and
  // the brightest thing in the drawing, because it is the only part whose
  // position the player has to read.
  block(0, 2, glow, SHOCK_COLOUR, 0.5 * fade);
  block(0, 1, glow, SHOCK_CORE, 0.9 * fade);
}

/**
 * **The cracks.** Radial splits across the band, on fixed bearings so they
 * travel outward with it instead of crawling round it.
 *
 * They are what makes the ring read as ground opening rather than as a
 * coloured annulus: a scanline fill has no feature that runs the *other* way
 * across the band, and without one the eye has nothing to measure the band's
 * thickness against. Drawn dark on the normal-blended pen, because a crack is
 * a hole and a hole cannot glow.
 */
function drawShockCracks(ground: Pen, s: ShockwaveLike, fade: number, view: ViewBox): void {
  const P = SHOCK_PIX;
  const outer = s.inner + s.thickness;
  const cracks = 26;
  for (let i = 0; i < cracks; i++) {
    const h = hash01(i * 37 + 5);
    if (h < 0.22) continue;
    const ang = (i / cracks) * Math.PI * 2 + h * 0.2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const from = s.inner + P * (1 + Math.round(h * 2));
    const to = outer - P * (2 + Math.round(hash01(i * 71) * 2));
    ground.fillStyle(SHOCK_FURROW, 0.6 * fade);
    for (let r = from; r < to; r += P) {
      // A crack wanders: half a cell of sideways drift along its length.
      const drift = hash01(i * 13 + Math.round(r / P)) > 0.62 ? P : 0;
      const x = floorPix(s.x + ca * r - sa * drift);
      const y = floorPix(s.y + sa * r + ca * drift);
      if (x < view.x0 - 8 || x > view.x1 + 8 || y < view.y0 - 8 || y > view.y1 + 8) continue;
      ground.fillRect(x, y, P, P);
    }
  }
}

/**
 * One half of the scan conversion: the quadrants in which the band is more
 * across the given axis than along it.
 *
 * **Both passes are needed and neither is enough.** Scanning an annulus by
 * rows alone paints horizontal runs, which are radial on the left and right of
 * the ring and are a wide flat smear across the top and bottom — the crest and
 * the furrow simply disappear there, which is exactly how the old drawing
 * looked wrong. So rows paint the left and right quadrants (`|dx| >= |dy|`),
 * columns paint the top and bottom, and every run in the drawing points at the
 * centre. They overlap by a cell along the diagonals so the seam has no gap.
 */
function bandPass(
  ground: Pen, glow: Pen, s: ShockwaveLike, view: ViewBox, axis: "x" | "y", fade: number,
): void {
  const P = SHOCK_PIX;
  const outer = s.inner + s.thickness;
  // `across` is the coordinate stepped over; `along` the one runs are drawn on.
  const acrossC = axis === "x" ? s.y : s.x;
  const alongC = axis === "x" ? s.x : s.y;
  const lo = axis === "x" ? view.y0 : view.x0;
  const hi = axis === "x" ? view.y1 : view.x1;
  const first = Math.max(floorPix(acrossC - outer), floorPix(lo));
  const last = Math.min(ceilPix(acrossC + outer), ceilPix(hi));
  for (let u = first; u <= last; u += P) {
    // Sampled at the cell's own centre, so a cell is in the band when its
    // middle is, which is what makes the steps sit evenly either side.
    const d = u + P / 2 - acrossC;
    const ad = Math.abs(d);
    if (ad >= outer) continue;
    const far = Math.sqrt(outer * outer - d * d);
    // The quadrant boundary, with a cell of overlap so the seam is closed.
    const near = Math.max(ad - P, ad < s.inner ? Math.sqrt(s.inner * s.inner - d * d) : 0);
    if (far - near < P) continue;
    const seed = Math.round(u / P) * 131 + Math.round(s.inner / 24) + (axis === "x" ? 0 : 5003);
    shockRun(ground, glow, axis, u, ceilPix(alongC + far), -1, far - near, fade, seed);
    shockRun(ground, glow, axis, u, floorPix(alongC - far), 1, far - near, fade, seed + 7);
  }
}

/** The travelling band, scan-converted on the pixel grid. */
function drawShockBand(ground: Pen, glow: Pen, s: ShockwaveLike, view: ViewBox): void {
  const P = SHOCK_PIX;
  const outer = s.inner + s.thickness;
  const fade = Math.max(0, Math.min(1, (s.maxRadius - s.inner) / 60));
  if (fade <= 0) return;
  bandPass(ground, glow, s, view, "x", fade);
  bandPass(ground, glow, s, view, "y", fade);
  drawShockCracks(ground, s, fade, view);
  /*
   * **Thrown debris and settling dust**, on fixed bearings so they travel out
   * with the ring rather than swarming round it. The chunks sit a little
   * *ahead* of the front — stone the wave has already lifted — and the dust
   * trails a little behind the back edge, which is what gives the band a
   * direction at a glance even when only part of it is on screen.
   */
  const spokes = 32;
  for (let i = 0; i < spokes; i++) {
    const hAng = hash01(i * 17 + 3);
    const ang = (i / spokes) * Math.PI * 2 + hAng * 0.16;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const hR = hash01(i * 29 + 11);
    if (hR > 0.45) {
      const r = outer + P + hR * 10;
      const x = floorPix(s.x + ca * r);
      const y = floorPix(s.y + sa * r);
      if (x >= view.x0 - 8 && x <= view.x1 + 8 && y >= view.y0 - 8 && y <= view.y1 + 8) {
        const wCells = hR > 0.8 ? P * 2 : P;
        ground.fillStyle(SHOCK_SOIL_LIT, 0.85 * fade);
        ground.fillRect(x, y, wCells, P);
        ground.fillStyle(SHOCK_FURROW, 0.6 * fade);
        ground.fillRect(x, y + P, wCells, P);
      }
    }
    const hD = hash01(i * 53 + 19);
    if (hD > 0.35) {
      const r = s.inner - P * 2 - hD * 16;
      if (r <= 0) continue;
      const x = floorPix(s.x + ca * r);
      const y = floorPix(s.y + sa * r);
      if (x < view.x0 - 8 || x > view.x1 + 8 || y < view.y0 - 8 || y > view.y1 + 8) continue;
      ground.fillStyle(SHOCK_DUST, 0.32 * fade * (1 - hD * 0.6));
      ground.fillRect(x, y, P, P);
    }
  }
}

/** The charge: a dim stepped ring at the birth radius, gathering inward. */
function drawShockCharge(
  ground: Pen, glow: Pen, s: ShockwaveLike, nowMs: number, view: ViewBox,
): void {
  const P = SHOCK_PIX;
  const k = 1 - s.chargeMs / Math.max(1, s.chargeMaxMs);
  const r = s.inner + s.thickness * 0.5;
  pixelRing(ground, s.x, s.y, r + P, SHOCK_FURROW, 0.35 + 0.35 * k, view);
  pixelRing(ground, s.x, s.y, r, SHOCK_SOIL_LIT, 0.35 + 0.45 * k, view);
  pixelRing(glow, s.x, s.y, r, SHOCK_COLOUR, 0.35 + 0.5 * k, view);
  // Dust pulled inward: the ground gathering before it goes.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + nowMs / 900;
    const d = r + 14 * (1 - k);
    const x = floorPix(s.x + Math.cos(a) * d);
    const y = floorPix(s.y + Math.sin(a) * d);
    ground.fillStyle(SHOCK_DUST, 0.2 + 0.4 * k);
    ground.fillRect(x, y, P, P);
  }
}

/**
 * A one-cell stepped circle, scan-converted the same way the band is, so the
 * charge ring and the band it becomes are drawn out of the same geometry.
 */
function pixelRing(
  pen: Pen, cx: number, cy: number, r: number, colour: number, alpha: number, view: ViewBox,
): void {
  const P = SHOCK_PIX;
  pen.fillStyle(colour, alpha);
  const top = Math.max(floorPix(cy - r), floorPix(view.y0));
  const bottom = Math.min(ceilPix(cy + r), ceilPix(view.y1));
  let lastX = -1;
  for (let y = top; y <= bottom; y += P) {
    const dy = y + P / 2 - cy;
    if (Math.abs(dy) >= r) continue;
    const dx = Math.sqrt(r * r - dy * dy);
    const x0 = floorPix(cx - dx);
    const x1 = ceilPix(cx + dx);
    /*
     * The horizontal runs at the top and bottom of the circle: without them
     * a scan-converted ring is a column of disconnected dashes where the
     * curve is nearly flat. The run is the width the row grew by.
     */
    const grew = lastX < 0 ? P : Math.max(P, lastX - x0);
    pen.fillRect(x0, y, grew, P);
    pen.fillRect(x1 - grew, y, grew, P);
    lastX = x0;
  }
}

/**
 * **Hurried by a bell**, drawn on the body it is hurrying.
 *
 * The ringing is deliberately not drawn on the floor: a tint on the stone was
 * the old slow field and nobody could read what it was for. The thing the
 * player needs is *which body is quick*, so that is what is drawn — two short
 * speed-lines trailing off its back in the bell's gold, and a beat round its
 * feet.
 */
export function drawHasteCue(
  g: Pen, e: { x: number; y: number; radius: number; facing: number }, tick: number,
): void {
  const back = e.facing + Math.PI;
  for (let k = 0; k < 2; k++) {
    const off = (k === 0 ? 1 : -1) * 3.5;
    const nx = Math.cos(back + Math.PI / 2) * off;
    const ny = Math.sin(back + Math.PI / 2) * off;
    const len = 7 + 4 * ((tick >> 1) % 3);
    g.lineStyle(1, HASTE_COLOUR, 0.8 - 0.2 * k);
    g.lineBetween(
      e.x + nx + Math.cos(back) * e.radius, e.y - 3 + ny + Math.sin(back) * e.radius,
      e.x + nx + Math.cos(back) * (e.radius + len), e.y - 3 + ny + Math.sin(back) * (e.radius + len),
    );
  }
  g.lineStyle(1, HASTE_COLOUR, (tick >> 2) & 1 ? 0.65 : 0.35);
  g.strokeCircle(e.x, e.y + 2, e.radius + 3);
}

/**
 * **The conduction pulse.** The bell tolls and a bead of light runs out along
 * every line the ringer holds, from the ringer to the ally.
 *
 * The shield is already full in the simulation the instant the bell rings, but
 * a number changing off-screen is not an event: the light arriving is what
 * makes the refill something the player watched happen, and it is why
 * interrupting the windup feels like stopping something. The far end pops as
 * the bead lands, so the eye is taken to the shield that was just paid for.
 */
export function drawTollPulse(
  g: Pen, ends: { x0: number; y0: number; x1: number; y1: number }, k: number,
): void {
  const px = ends.x0 + (ends.x1 - ends.x0) * k;
  const py = ends.y0 + (ends.y1 - ends.y0) * k;
  g.lineStyle(2.5, HASTE_COLOUR, 0.25 + 0.5 * (1 - k));
  g.lineBetween(ends.x0, ends.y0, px, py);
  g.fillStyle(HASTE_COLOUR, 0.35);
  g.fillCircle(px, py, 7 - 3 * k);
  g.fillStyle(PULSE_CORE, 0.95);
  g.fillCircle(px, py, 2.6);
  if (k > 0.82) {
    const pop = (k - 0.82) / 0.18;
    g.lineStyle(2 - pop, PULSE_CORE, 0.9 * (1 - pop));
    g.strokeCircle(ends.x1, ends.y1, 10 + 16 * pop);
  }
}

/**
 * **The rotating arm** (`Arm` in the sim, doc 005).
 *
 * Drawn from the same two endpoints the hit test uses, on the same pixel grid
 * as the shockwave: the limb is a run of cells along its spine, so the steel
 * the player sees is the steel that cuts, down to the cell.
 *
 * The telegraph and the sweep are the same drawing at two weights. While it
 * lies still it is a **hollow** limb — an outline and a dotted spine, clearly
 * not yet a thing that hits — and it brightens and fills as the hold runs
 * out. Once it turns it is solid, with a hot tip and a short wake trailing
 * the way it came from, which is what tells the player which way to run.
 */
export interface ArmLike {
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly spin: number;
  readonly inner: number;
  readonly length: number;
  readonly width: number;
  readonly teleMs: number;
  readonly teleMaxMs: number;
  readonly activeMs: number;
  readonly activeMaxMs: number;
}

// Iron: the arm is the king's chain now (doc 020), until its link sprites (art order B8) replace the drawing.
const ARM_DARK = 0x16171f;
const ARM_SKIN = 0x585c6e;
const ARM_LIT = 0xa7abbd;
const ARM_HOT = 0xe6e9f4;

/**
 * The limb's cross-section at one step across it: the interval the capsule
 * covers, or null where it covers none.
 *
 * `q` is the coordinate being stepped over and the interval is along the
 * other one. The capsule is convex, so the interval is the outermost pair of
 * crossings of its three pieces — the two end discs and the rectangle between
 * them — and taking the min and max of all of them is exact.
 */
function capsuleSpan(
  a: { x: number; y: number }, b: { x: number; y: number }, r: number, q: number, swap: boolean,
): [number, number] | null {
  const P0 = swap ? [a.y, a.x] : [a.x, a.y];
  const P1 = swap ? [b.y, b.x] : [b.x, b.y];
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of [P0, P1]) {
    const dq = q - c[1]!;
    if (Math.abs(dq) > r) continue;
    const dp = Math.sqrt(r * r - dq * dq);
    lo = Math.min(lo, c[0]! - dp);
    hi = Math.max(hi, c[0]! + dp);
  }
  const vx = P1[0]! - P0[0]!;
  const vy = P1[1]! - P0[1]!;
  const len = Math.hypot(vx, vy) || 1;
  const nx = (-vy / len) * r;
  const ny = (vx / len) * r;
  const corners: [number, number][] = [
    [P0[0]! + nx, P0[1]! + ny], [P1[0]! + nx, P1[1]! + ny],
    [P1[0]! - nx, P1[1]! - ny], [P0[0]! - nx, P0[1]! - ny],
  ];
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i]!;
    const c1 = corners[(i + 1) % 4]!;
    if ((c0[1] <= q && c1[1] > q) || (c1[1] <= q && c0[1] > q)) {
      const x = c0[0] + ((q - c0[1]) / (c1[1] - c0[1])) * (c1[0] - c0[0]);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * **The rotating arm**, scan-converted across its own width.
 *
 * The drawing *is* the capsule `armHits` tests — the same two endpoints, the
 * same half-width, with no taper. A tapered limb looked better and lied about
 * its own tip, which is the one part of it a player is judging a dash
 * against. What gives it shape instead is the shading: a dark outline cell at
 * each edge, skin between, and a lit spine down the middle.
 *
 * It is scanned across whichever axis the limb is *least* aligned with, so
 * every run crosses the width rather than running along it, and the outline
 * always lands on the limb's long edges. Sampling the capsule on a rotated
 * lattice instead — a row of cells per step along the spine — leaves holes at
 * 45°, because a rotated 2 px lattice does not cover an axis-aligned one.
 */
export function drawArms(ground: Pen, glow: Pen, arms: readonly ArmLike[]): void {
  const P = SHOCK_PIX;
  for (const a of arms) {
    if (!a.alive) continue;
    const arming = a.teleMs > 0;
    const k = arming ? 1 - a.teleMs / Math.max(1, a.teleMaxMs) : 1;
    const ux = Math.cos(a.angle);
    const uy = Math.sin(a.angle);
    const p0 = { x: a.x + ux * a.inner, y: a.y + uy * a.inner };
    const p1 = { x: a.x + ux * a.length, y: a.y + uy * a.length };
    const r = a.width / 2;
    // Scanned across the limb: along y for a limb lying east-west.
    const swap = Math.abs(ux) >= Math.abs(uy);
    const qLo = swap
      ? floorPix(Math.min(p0.x, p1.x) - r)
      : floorPix(Math.min(p0.y, p1.y) - r);
    const qHi = swap
      ? ceilPix(Math.max(p0.x, p1.x) + r)
      : ceilPix(Math.max(p0.y, p1.y) + r);
    for (let q = qLo; q <= qHi; q += P) {
      const span = capsuleSpan(p0, p1, r, q + P / 2, swap);
      if (!span) continue;
      const lo = floorPix(span[0]);
      const hi = ceilPix(span[1]);
      const w = hi - lo;
      if (w < P) continue;
      const rect = (pen: Pen, at: number, len: number): unknown => (swap
        ? pen.fillRect(q, at, P, len)
        : pen.fillRect(at, q, len, P));
      if (arming) {
        // Hollow while it is being read: the two edges and a dotted spine, so
        // it is plainly an outline of something that is not steel yet.
        ground.fillStyle(ARM_LIT, 0.35 + 0.5 * k);
        rect(ground, lo, P);
        rect(ground, hi - P, P);
        continue;
      }
      ground.fillStyle(ARM_SKIN, 1);
      rect(ground, lo, w);
      ground.fillStyle(ARM_DARK, 1);
      rect(ground, lo, P);
      rect(ground, hi - P, P);
    }
    // The lit spine, stepped finely enough to stay unbroken on a diagonal.
    const spineStep = P * 0.5;
    const pen = arming ? glow : ground;
    pen.fillStyle(ARM_LIT, arming ? 0.3 + 0.55 * k : 1);
    for (let d = a.inner; d <= a.length; d += spineStep) {
      if (arming && Math.round((d - a.inner) / spineStep) % 6 >= 2) continue;
      pen.fillRect(floorPix(a.x + ux * d - P / 2), floorPix(a.y + uy * d - P / 2), P, P);
    }
    if (arming) continue;
    // The tip: the fastest and most dangerous part of it, so it is the part
    // that is lit.
    glow.fillStyle(ARM_HOT, 0.85);
    glow.fillRect(floorPix(a.x + ux * a.length - P), floorPix(a.y + uy * a.length - P), P * 2, P * 2);
    /*
     * The wake: cells trailing the tip round the arc it has just swept. It is
     * the only part of the drawing that says which way the arm is turning,
     * and which way it is turning is the whole answer to the move.
     */
    const dir = Math.sign(a.spin) || 1;
    for (let j = 1; j <= 6; j++) {
      const back = a.angle - dir * j * 0.09;
      const rad = a.length - j * 2;
      glow.fillStyle(ARM_LIT, 0.55 / j);
      glow.fillRect(
        floorPix(a.x + Math.cos(back) * rad - P / 2), floorPix(a.y + Math.sin(back) * rad - P / 2), P, P,
      );
    }
  }
}
