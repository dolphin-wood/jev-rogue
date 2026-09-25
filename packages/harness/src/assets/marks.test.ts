import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { MANIFEST, MARK_SIZE, SIZE, markFrame, markFrameSpecs } from "./manifest.ts";
import { compose, loadModel, modelFrames, modelNames, type Facing, type Model, type Rig } from "./models.ts";
import { SUBSPECIES_ART, MARK_PX, drawMark, paletteTable, shiftPalette } from "./subspecies.ts";
import { hsl, rgb } from "./palette.ts";
import { parsePx } from "./px.ts";
import { ENEMIES, SUBSPECIES_IDS, SUBSPECIES_OF } from "../../../core/src/encounters/enemies.ts";

/**
 * **A subspecies is its base's frames in a shifted palette, with one mark**
 * (doc 019), and this is the whole contract between the three pieces that
 * make that true: the rig's `mark` anchor, the atlas the pipeline writes, and
 * the renderer that reads it.
 *
 * The anchor is declared once on the rig as an offset from a part's **pivot**,
 * rather than drawn as a joint into every variant of that part — a point that
 * changes no pixel should not mean editing dozens of `.px` drawings.
 *
 * What the renderer needs from a delivery, and therefore what is asserted
 * here: every subspecies has a swap and three mark frames; every frame of
 * every base carries the anchor those marks hang from; and adding all of it
 * moved no pixel of any body.
 */

const LEGEND = "legend outline:k cloth:abc";

/** A two-part rig: a body and a head hanging off it, enough to place a mark on. */
function toyModel(marks?: Rig["marks"]): Model {
  const px = parsePx([
    LEGEND,
    "",
    "part torso.stand pivot 1,0",
    "joint neck 1,0",
    "abc",
    "abc",
    "abc",
    "",
    "part head.stand pivot 1,2",
    "bb",
    "bb",
    "bb",
    "",
    "part head.horned pivot 1,2",
    "cc",
    "bb",
    "bb",
    "",
  ].join("\n"));
  const rig: Rig = {
    size: [16, 16],
    outline: 1,
    anchors: {},
    marks,
    facings: {
      s: {
        origin: [6, 6],
        parts: [
          { name: "torso", parent: null, depth: 1 },
          { name: "head", parent: "torso", joint: "neck", depth: 2 },
        ],
      },
    } as unknown as Rig["facings"],
  };
  return {
    name: "toy",
    palette: { ramps: { outline: ["#000000"], cloth: ["#111111", "#222222", "#333333"] } },
    rig,
    poses: {
      s: {
        stand: { parts: { torso: "stand", head: "stand" } },
        // The head one pixel over, in a different drawing: a mark must follow both.
        lean: { parts: { torso: "stand", head: { v: "horned", at: [1, -1] } } },
        headless: { parts: { torso: "stand", head: null } },
      },
    } as unknown as Model["poses"],
    anims: { facings: ["s"], frames: { toy_s_idle0: "stand" } },
    parts: new Map<Facing, Map<string, typeof px.parts[number]>>([
      ["s", new Map(px.parts.map((p) => [`${p.part}.${p.variant}`, p]))],
    ]),
  };
}

describe("the mark anchor", () => {
  it("is absent when the rig declares none", () => {
    expect(compose(toyModel(), "s", "stand").anchors.mark).toBeUndefined();
  });

  it("sits at the named part's pivot plus its offset", () => {
    const plain = compose(toyModel(), "s", "stand");
    const head = plain.placed.find((p) => p.part === "head")!;
    const marked = compose(toyModel({ mark: { part: "head", at: [0, -2] } }), "s", "stand");
    expect(marked.anchors.mark).toEqual([
      head.x + head.drawing.pivot[0],
      head.y + head.drawing.pivot[1] - 2,
    ]);
  });

  it("rides the pose: it moves with the part and holds across its variants", () => {
    const model = toyModel({ mark: { part: "head", at: [0, -2] } });
    const stand = compose(model, "s", "stand").anchors.mark as [number, number];
    const lean = compose(model, "s", "lean").anchors.mark as [number, number];
    // `lean` moves the head by (1, -1) and swaps its drawing; both variants
    // pivot at the same pixel, so the mark moves by exactly the pose's offset.
    expect(lean).toEqual([stand[0] + 1, stand[1] - 1]);
  });

  it("is absent from a pose that hides its part, like a joint anchor", () => {
    const model = toyModel({ mark: { part: "head", at: [0, -2] } });
    expect(compose(model, "s", "headless").anchors.mark).toBeUndefined();
  });

  it("changes no pixel: it is a point, not a part", () => {
    const plain = compose(toyModel(), "s", "stand");
    const marked = compose(toyModel({ mark: { part: "head", at: [0, -2] } }), "s", "stand");
    expect(marked.px).toEqual(plain.px);
  });
});

describe("mark frames", () => {
  it("are one per facing, at the size a horn reads at", () => {
    const specs = markFrameSpecs(["pinner", "wisp"]);
    expect(specs.map((s) => s.name)).toEqual([
      "mark_pinner_s", "mark_pinner_n", "mark_pinner_w",
      "mark_wisp_s", "mark_wisp_n", "mark_wisp_w",
    ]);
    expect(specs.every((s) => s.size === MARK_SIZE && !s.centred)).toBe(true);
    expect(markFrame("beacon", "w")).toBe("mark_beacon_w");
  });

  it("are in the manifest, three per subspecies and nothing else", () => {
    /*
     * This used to assert the opposite — that no `mark_` frame was packed —
     * because the drawings existed and nothing read them, and holding the
     * atlas still was the only honest claim to make. Both halves are joined
     * now: the pipeline packs them and `drawSubspeciesMark` hangs them off the
     * anchor, so what has to be true is that the sheet carries exactly the
     * marks the roster names.
     */
    const packed = MANIFEST.filter((s) => s.name.startsWith("mark_")).map((s) => s.name);
    expect(packed).toEqual(SUBSPECIES_ART.flatMap((a) => ["s", "n", "w"].map((f) => markFrame(a.id, f))));
    expect(packed.length).toBe(SUBSPECIES_ART.length * 3);
  });

  it("costs about two per cent of the sheet, against the +58% a model apiece would", () => {
    // The measurement doc 019 turns on, kept as an assertion so it cannot
    // quietly stop being true.
    const area = (s: { size: keyof typeof SIZE; width?: number; height?: number }) =>
      (s.width ?? SIZE[s.size]) * (s.height ?? SIZE[s.size]);
    const total = MANIFEST.reduce((a, s) => a + area(s), 0);
    const marks = MANIFEST.filter((s) => s.name.startsWith("mark_")).reduce((a, s) => a + area(s), 0);
    expect(marks / total).toBeLessThan(0.03);
  });
});

/**
 * **What the renderer is handed** (`assets/sprites.json`).
 *
 * `drawSubspeciesMark` looks up one frame and one anchor per drawn body and
 * draws nothing when either is missing, and `SubspeciesVisuals` swaps nothing
 * when a body has no entry in the table. Every one of those is a silent
 * failure — a subspecies that simply looks like its base — so the delivery is
 * checked here rather than discovered in a room.
 */
describe("the delivery a subspecies is drawn from", () => {
  const atlas = JSON.parse(readFileSync("assets/sprites.json", "utf8")) as {
    frames: Record<string, { x: number; y: number; w: number; h: number }>;
    markAnchors?: Record<string, [number, number]>;
    subspecies?: { id: string; base: string; from: string[]; to: string[] }[];
  };

  it("carries a swap and three mark frames for every subspecies but the lancer", () => {
    // The lancer predates doc 019: it has its own drawn model, so it needs
    // neither half of this and must not be given one.
    const expected = SUBSPECIES_IDS.filter((id) => id !== "lancer");
    expect([...expected].sort()).toEqual(SUBSPECIES_ART.map((a) => a.id).sort());
    expect(SUBSPECIES_OF.rusher).toBe("lancer");
    for (const id of expected) {
      expect(atlas.subspecies?.some((s) => s.id === id), `${id} has no palette swap`).toBe(true);
      for (const f of ["s", "n", "w"])
        expect(atlas.frames[markFrame(id, f)], `${markFrame(id, f)} is not in the sheet`).toBeDefined();
    }
  });

  it("names, for each swap, the base whose frames it recolours", () => {
    for (const swap of atlas.subspecies ?? [])
      expect(SUBSPECIES_OF[swap.base as keyof typeof SUBSPECIES_OF], swap.id).toBe(swap.id);
  });

  it("anchors the mark on every frame of every base that has one", () => {
    // The renderer reads the anchor by frame name; a frame the pipeline
    // delivered without one is a frame the mark vanishes on.
    for (const art of SUBSPECIES_ART) {
      const frames = [...modelFrames(loadModel(art.base)).keys()];
      expect(frames.length, `${art.base} delivers no frames`).toBeGreaterThan(0);
      for (const frame of frames)
        expect(atlas.markAnchors?.[frame], `${frame} has no mark anchor in the sheet`).toBeDefined();
    }
  });

  it("puts every anchor inside the frame it belongs to", () => {
    for (const [frame, at] of Object.entries(atlas.markAnchors ?? {})) {
      const rect = atlas.frames[frame];
      expect(rect, `${frame} has an anchor and no frame`).toBeDefined();
      expect(at[0], `${frame} x`).toBeGreaterThanOrEqual(0);
      expect(at[1], `${frame} y`).toBeGreaterThanOrEqual(0);
      expect(at[0], `${frame} x`).toBeLessThan(rect!.w);
      expect(at[1], `${frame} y`).toBeLessThan(rect!.h);
    }
  });

  it("moves enough of a body's colour to be a different body at 1x", () => {
    /*
     * The measurable half of "reads as distinct". A first pass gave several
     * of these twenty or thirty degrees with the chroma pulled down, which
     * looks like a difference on a contact sheet and is invisible in a room:
     * a breaker at eighteen degrees off a tank was, at 1x, a tank.
     *
     * Two ways to be different, because the roster uses both. **Hue**: the
     * body is carried round the wheel far enough to be another colour.
     * **Chroma**: the emberling goes grey and keeps a hot core, which is a
     * shift of fourteen degrees and unmistakable, because what changed is how
     * much colour there is rather than which.
     *
     * And a share, not only a palette: a swap that moved four shades nothing
     * is painted in would pass every colour test and change no pixel.
     */
    const png = PNG.sync.read(readFileSync("assets/sprites.png"));
    for (const art of SUBSPECIES_ART) {
      const swap = atlas.subspecies?.find((s) => s.id === art.id);
      expect(swap, art.id).toBeDefined();

      const turned = swap!.from.map((c, i) => {
        const a = hsl(rgb(c)), b = hsl(rgb(swap!.to[i]!));
        const d = Math.abs(a[0] - b[0]) % 360;
        return { hue: d > 180 ? 360 - d : d, chroma: a[1] > 0.02 ? b[1] / a[1] : 1 };
      });
      const meanHue = turned.reduce((a, t) => a + t.hue, 0) / turned.length;
      const meanChroma = turned.reduce((a, t) => a + t.chroma, 0) / turned.length;
      expect(meanHue >= 40 || meanChroma <= 0.6,
        `${art.id} turns ${meanHue.toFixed(0)} degrees at ${meanChroma.toFixed(2)}x chroma: too close to its base`)
        .toBe(true);

      // How much of the body that actually repaints.
      const frame = atlas.frames[`enemy_${art.base}_s_idle0`]
        ? `enemy_${art.base}_s_idle0` : `enemy_${art.base}_idle0`;
      const r = atlas.frames[frame]!;
      const from = new Set(swap!.from.map((c) => Number.parseInt(c.slice(1), 16)));
      let opaque = 0, moved = 0;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = ((r.y + y) * png.width + (r.x + x)) * 4;
        if (png.data[i + 3]! < 16) continue;
        opaque++;
        if (from.has((png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!)) moved++;
      }
      expect(moved / opaque, `${art.id} repaints only ${((moved / opaque) * 100).toFixed(0)}% of ${frame}`)
        .toBeGreaterThan(0.2);
    }
  });

  it("hangs the mark on the upper half of the body, where a head is", () => {
    // A mark that resolved to the feet would still pass every test above and
    // read as a dropped item rather than as part of the body.
    for (const [frame, at] of Object.entries(atlas.markAnchors ?? {})) {
      const rect = atlas.frames[frame]!;
      expect(at[1] / rect.h, `${frame} hangs its mark at ${(at[1] / rect.h).toFixed(2)} down the frame`)
        .toBeLessThan(0.62);
    }
  });
});

describe("the marks the roster declares", () => {
  const withMark = modelNames().filter((n) => loadModel(n).rig.marks !== undefined);

  it("puts one on every base that has a subspecies, and nowhere else", () => {
    const bases = new Set(SUBSPECIES_ART.map((a) => a.base));
    for (const base of bases) {
      expect(loadModel(base).rig.marks?.mark, `${base} has a subspecies and no mark anchor`).toBeDefined();
    }
    // And nothing else carries one: a mark on a body with no variant is an
    // anchor nothing will ever hang from.
    for (const name of withMark) expect([...bases], `${name}`).toContain(name);
  });

  it("names the same part the roster does", () => {
    /*
     * The fact lives twice: on the rig, where the pipeline reads it, and on
     * `EnemyDef.mark_anchor`, where the roster states it. Two sources for one
     * fact drift, and they had — the roster still named the fins and the pods
     * the first pass hung marks from after the rigs moved them to the crown.
     */
    for (const art of SUBSPECIES_ART) {
      const def = ENEMIES[art.id as keyof typeof ENEMIES] as { mark_anchor?: string };
      expect(def.mark_anchor, `${art.id} has no mark_anchor`).toBeDefined();
      expect(def.mark_anchor, art.id).toBe(loadModel(art.base).rig.marks!.mark!.part);
    }
  });

  it("names a part every facing of that rig actually has", () => {
    /*
     * The orbiter is why this is a test. Its side view has no horns, so a mark
     * anchored to `horn_l` was a mark that vanished when the body turned —
     * which reads as a rendering fault rather than as a body facing away.
     */
    for (const name of withMark) {
      const model = loadModel(name);
      const part = model.rig.marks!.mark!.part;
      for (const facing of Object.keys(model.rig.facings) as Facing[]) {
        expect(model.rig.facings[facing].parts.map((p) => p.name), `${name}/${facing}`).toContain(part);
      }
    }
  });

  it("resolves on every frame the model delivers", () => {
    // The anchor is what the mark is drawn at, so a frame without one is a
    // frame the mark disappears on.
    for (const name of withMark) {
      const model = loadModel(name);
      for (const [frame, f] of modelFrames(model)) {
        expect(f.composed.anchors.mark, `${name} ${frame} carries no mark anchor`).toBeDefined();
      }
    }
  });

  it("changes no pixel of any body that declares one", () => {
    // The whole bargain: a mark is a point the renderer hangs a decal from,
    // so adding the anchors cannot have moved the atlas.
    for (const name of withMark) {
      const model = loadModel(name);
      const facing = Object.keys(model.rig.facings)[0] as Facing;
      const pose = Object.keys(model.poses[facing])[0]!;
      const composed = compose(model, facing, pose);
      const bare = compose({ ...model, rig: { ...model.rig, marks: undefined } }, facing, pose);
      expect(composed.px).toEqual(bare.px);
    }
  });
});

describe("the mark drawings", () => {
  const opaqueMask = (art: typeof SUBSPECIES_ART[number], facing: "s" | "n" | "w"): string => {
    const png = drawMark(art, facing);
    return [...Array(png.width * png.height).keys()].map((i) => (png.data[i * 4 + 3]! > 0 ? "1" : "0")).join("");
  };

  it("draws one per subspecies per facing, with pixels in it", () => {
    for (const art of SUBSPECIES_ART) {
      for (const facing of ["s", "n", "w"] as const) {
        const png = drawMark(art, facing);
        const opaque = [...Array(png.width * png.height).keys()].filter((i) => png.data[i * 4 + 3]! > 0);
        expect(opaque.length, `${art.id}/${facing} drew nothing`).toBeGreaterThan(6);
      }
    }
  });

  it("gives no two subspecies the same silhouette", () => {
    /*
     * The mark is the half of the difference that survives at 1x, and it
     * survives as a **shape**. Two subspecies drawn as the same shape in two
     * hues would be two bodies the player has to tell apart by colour on a
     * floor the room has just tinted — which is the failure this whole
     * mechanism exists to avoid.
     */
    const seen = new Map<string, string>();
    for (const art of SUBSPECIES_ART) {
      const mask = opaqueMask(art, "s");
      const owner = seen.get(mask);
      expect(owner, `${art.id} has the same silhouette as ${owner}`).toBeUndefined();
      seen.set(mask, art.id);
    }
  });

  it("fits inside its frame, so nothing is clipped at the edge", () => {
    for (const art of SUBSPECIES_ART) {
      for (const facing of ["s", "n", "w"] as const) {
        const png = drawMark(art, facing);
        for (let i = 0; i < MARK_PX; i++) {
          const edges = [i, (MARK_PX - 1) * MARK_PX + i, i * MARK_PX, i * MARK_PX + MARK_PX - 1];
          for (const p of edges)
            expect(png.data[p * 4 + 3], `${art.id}/${facing} touches the frame edge`).toBe(0);
        }
      }
    }
  });

  it("keeps every accent out of the reserved enemy-bullet hue", () => {
    /*
     * Doc 008 reserves 328 degrees, plus or minus 25, above half saturation
     * for enemy projectiles. A mark in that band is a pixel the player has
     * been trained to read as a bullet, sitting on a body's head.
     */
    for (const art of SUBSPECIES_ART) {
      const png = drawMark(art, "s");
      for (let i = 0; i < png.width * png.height; i++) {
        if (png.data[i * 4 + 3]! === 0) continue;
        const [h, s] = hsl([png.data[i * 4]!, png.data[i * 4 + 1]!, png.data[i * 4 + 2]!]);
        if (s < 0.5) continue;
        const d = Math.min(Math.abs(h - 328), 360 - Math.abs(h - 328));
        expect(d, `${art.id} paints ${h.toFixed(0)} degrees, inside the bullet band`).toBeGreaterThan(25);
      }
    }
  });
});

describe("the palette table", () => {
  const palettes = Object.fromEntries(modelNames().map((n) => [n, loadModel(n).palette]));
  const table = paletteTable(palettes);

  it("covers every subspecies and actually changes its colours", () => {
    expect(table.map((t) => t.id).sort()).toEqual(SUBSPECIES_ART.map((a) => a.id).sort());
    for (const swap of table) {
      expect(swap.from.length, `${swap.id} swaps nothing`).toBeGreaterThan(2);
      expect(swap.from.length).toBe(swap.to.length);
      expect(swap.from.some((c, i) => c !== swap.to[i]), swap.id).toBe(true);
    }
  });

  it("never moves a colour's lightness, so a body stays inside the value band", () => {
    for (const swap of table) {
      swap.from.forEach((c, i) => {
        expect(hsl(rgb(swap.to[i]!))[2], `${swap.id} ${c}`).toBeCloseTo(hsl(rgb(c))[2], 2);
      });
    }
  });

  it("leaves the outline alone, which is most of a body's separation from the floor", () => {
    for (const art of SUBSPECIES_ART) {
      const base = loadModel(art.base).palette;
      const shifted = shiftPalette(base, art);
      expect(shifted.ramps.outline, art.id).toEqual(base.ramps.outline);
    }
  });

  it("stays inside what one body's palette may hold", () => {
    // Doc 016 caps a body at 32 colours, and the shader's table is sized to it.
    for (const swap of table) expect(swap.from.length, swap.id).toBeLessThanOrEqual(32);
  });
});
