import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { generatePlaceholders } from "./placeholder.ts";
import { MAX_FLOOR_GRAIN_DRIFT, MIN_FLOOR_GRAIN_SEAMS, checkAssets, grainShare } from "./check.ts";
import { MANIFEST } from "./manifest.ts";
import { loadModel } from "./models.ts";

const GOLDEN = mkdtempSync(join(tmpdir(), "jr-assets-golden-"));

beforeAll(() => {
  generatePlaceholders(GOLDEN);
});

/** Copy the valid delivery, mutate it, and check. */
function mutated(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "jr-assets-"));
  cpSync(GOLDEN, dir, { recursive: true });
  fn(dir);
  return checkAssets(dir);
}

function editPixel(dir: string, frame: string, dx: number, dy: number, rgba: [number, number, number, number]) {
  const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
  const r = atlas.frames[frame];
  const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
  const i = ((r.y + dy) * png.width + (r.x + dx)) * 4;
  [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = rgba;
  writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
}

function rules(report: ReturnType<typeof checkAssets>) {
  return new Set(report.violations.map((v) => v.rule));
}

describe("asset checker", () => {
  it("accepts the generated placeholder delivery", () => {
    const report = checkAssets(GOLDEN);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(MANIFEST.length);
  });

  it("reports a dominant hue for every frame, which the bullet rule uses", () => {
    const report = checkAssets(GOLDEN);
    expect(Object.keys(report.dominantHue).length).toBe(MANIFEST.length);
    for (const h of Object.values(report.dominantHue)) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("catches a missing frame", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      delete atlas.frames["player_s_idle0"];
      writeFileSync(join(dir, "sprites.json"), JSON.stringify(atlas));
    });
    expect(rules(r)).toContain("completeness");
    expect(r.ok).toBe(false);
  });

  it("catches a frame that is not in the manifest", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      atlas.frames["player_diagonal_0"] = { x: 0, y: 0, w: 16, h: 16 };
      writeFileSync(join(dir, "sprites.json"), JSON.stringify(atlas));
    });
    expect(rules(r)).toContain("completeness");
  });

  it("catches a wrong frame size", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      atlas.frames["player_s_idle0"].w = 128;
      writeFileSync(join(dir, "sprites.json"), JSON.stringify(atlas));
    });
    expect(rules(r)).toContain("size");
  });

  it("catches a lightning bolt that no longer lands on its bottom-centre anchor", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["vfx_bolt_1"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = rect.h - 8; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++) {
          const i = ((rect.y + y) * png.width + rect.x + x) * 4;
          png.data.fill(0, i, i + 4);
        }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("lightning-bolt");
  });

  /** Paints every opaque pixel of one frame, for the floor-separation rules. */
  const repaint = (frame: string, colour: (x: number, y: number) => [number, number, number]) =>
    (dir: string) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames[frame];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * png.width + rect.x + x) * 4;
        if (png.data[i + 3] === 0) continue;
        png.data.set(colour(x, y), i);
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    };

  /** The floor's own mean colour in a delivery, which a body must not be. */
  const floorColour = (dir: string): [number, number, number] => {
    const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
    const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
    const rect = atlas.frames["tile_floor_0"];
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
      const i = ((rect.y + y) * png.width + rect.x + x) * 4;
      if (!png.data[i + 3]) continue;
      for (let c = 0; c < 3; c++) sum[c]! += png.data[i + c]!;
      n++;
    }
    return sum.map((v) => Math.round(v / n)) as [number, number, number];
  };

  it("catches an enemy body recoloured to the floor's value and hue", () => {
    // The stone's own mean: the same luminance and the same hue, so nothing
    // about the body reads against the floor it stands on.
    // Measured once: `repaint` asks for a colour per pixel, and measuring the
    // floor decodes the whole sheet — asked inside the callback it decoded the
    // sheet two thousand times and the test took five minutes.
    const r = mutated((dir) => {
      const floor = floorColour(dir);
      repaint("enemy_rusher_s_idle0", () => floor)(dir);
    });
    expect(rules(r)).toContain("enemy-floor-contrast");
  });

  it("accepts a body whose mean matches the floor but whose pixels do not", () => {
    /*
     * The rule the old one could not express. Ink and plate average to about
     * the floor's luminance and read as a body at a glance, because every
     * pixel is far from the floor even though the mean is not. Measuring the
     * mean is what pushed the roster to be scaled brighter until it glowed.
     */
    const r = mutated((dir) => {
      const [fr, fg, fb] = floorColour(dir);
      // Two tones either side of the floor, averaging to it.
      const off = 70;
      repaint("enemy_rusher_s_idle0", (x, y) => (((x + y) & 1) === 0
        ? [Math.max(0, fr - off), Math.max(0, fg - off), Math.max(0, fb - off)]
        : [Math.min(255, fr + off), Math.min(255, fg + off), Math.min(255, fb + off)]))(dir);
    });
    expect(rules(r)).not.toContain("enemy-floor-contrast");
  });

  it("catches a transparent scanline cut through an enemy body", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["enemy_rusher_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      let bestY = 1;
      let best: number[] = [];
      for (let y = 1; y < rect.h - 1; y++) {
        const supported: number[] = [];
        for (let x = 0; x < rect.w; x++) {
          const i = ((rect.y + y) * png.width + rect.x + x) * 4;
          const stride = png.width * 4;
          if (png.data[i - stride + 3] !== 0 && png.data[i + stride + 3] !== 0)
            supported.push(x);
        }
        if (supported.length > best.length) { bestY = y; best = supported; }
      }
      expect(best.length).toBeGreaterThanOrEqual(8);
      for (const x of best) {
        const i = ((rect.y + bestY) * png.width + rect.x + x) * 4;
        png.data.fill(0, i, i + 4);
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("transparent-seam");
  });

  it("accepts many colours and limited edge alpha", () => {
    const r = mutated((dir) => {
      editPixel(dir, "player_s_idle0", 20, 20, [200, 120, 60, 255]);
      editPixel(dir, "player_s_idle0", 21, 20, [201, 121, 61, 255]);
      // Anti-aliasing keeps the sprite's own hue; only a matte introduces a
      // foreign one, which is what the fringe rule looks for.
      editPixel(dir, "player_s_idle0", 22, 20, [74, 84, 128, 128]);
    });
    expect(r.violations).toEqual([]);
  });

  it("catches soft alpha across the body, which is a matte rather than anti-aliasing", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["player_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++) {
          const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
          if (png.data[i + 3] === 255) png.data[i + 3] = 160;
        }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("soft-alpha");
  });

  it("catches a coloured halo, the artefact of cutting alpha over a background", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["player_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      // A saturated green rim at partial alpha, far from the sprite's own hue.
      for (let x = 0; x < rect.w; x++)
        for (const y of [1, rect.h - 2]) {
          const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
          png.data[i] = 20; png.data[i + 1] = 220; png.data[i + 2] = 40; png.data[i + 3] = 120;
        }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("fringe");
  });

  it("accepts dark navy anti-aliased outlines around an ivory icon", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["icon_door_treasure"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * png.width + rect.x + x) * 4;
        const inside = x >= 8 && x < 56 && y >= 8 && y < 56;
        const edge = inside && (x === 8 || x === 55 || y === 8 || y === 55);
        png.data.set(edge ? [13, 11, 31, 140] : inside ? [232, 210, 170, 255] : [0, 0, 0, 0], i);
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(r.violations).toEqual([]);
  });

  it("accepts an anti-aliased accent matching its own nearby opaque paint", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["player_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * png.width + rect.x + x) * 4;
        const inside = x >= 8 && x < 56 && y >= 8 && y < 56;
        const accent = inside && x >= 48;
        const edge = inside && (x === 8 || x === 55 || y === 8 || y === 55);
        const rgb = accent ? [240, 145, 25] : [60, 70, 130];
        png.data.set(inside ? [...rgb, edge ? 140 : 255] : [0, 0, 0, 0], i);
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(r.violations).toEqual([]);
  });

  it("catches bullet families whose hues have converged", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (const name of Object.keys(atlas.frames).filter((n) => n.startsWith("bullet_player"))) {
        const rect = atlas.frames[name];
        for (let y = 0; y < rect.h; y++)
          for (let x = 0; x < rect.w; x++) {
            const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
            if (png.data[i + 3] === 0) continue;
            png.data[i] = 255; png.data[i + 1] = 63; png.data[i + 2] = 164;
          }
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("bullet-separation");
  });

  it("catches an off-centre entity sprite", () => {
    const r = mutated((dir) => {
      // push opaque pixels into one corner only. An entity drawn from a
      // sheet — the roster's bodies are sprite models now, and a model's
      // frames are placed by their rig rather than recentred, so the rule
      // does not apply to them and cannot be demonstrated on one.
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["pet_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++) {
          const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
          const keep = x < 6 && y < 6;
          png.data[i + 3] = keep ? 255 : 0;
          if (keep) { png.data[i] = 13; png.data[i + 1] = 11; png.data[i + 2] = 31; }
        }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("centring");
  });

  it("catches a fully transparent frame", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["player_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++)
          png.data[((rect.y + y) * png.width + (rect.x + x)) * 4 + 3] = 0;
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("empty");
  });

  it("catches a rect that runs off the sheet", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      atlas.frames["player_s_idle0"].x = 10_000;
      writeFileSync(join(dir, "sprites.json"), JSON.stringify(atlas));
    });
    expect(rules(r)).toContain("bounds");
  });

  it("reports a missing delivery instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "jr-assets-empty-"));
    const r = checkAssets(dir);
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain("delivery");
  });
});

describe("tint-aware rules", () => {
  it("catches a separation that only holds before the mood tint", () => {
    // Push player bullets to a hue just over the floor: fine at rest, under
    // the floor once the strongest mood rotates them toward the enemy hue.
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (const name of Object.keys(atlas.frames).filter((n) => n.startsWith("bullet_player"))) {
        const rect = atlas.frames[name];
        for (let y = 0; y < rect.h; y++)
          for (let x = 0; x < rect.w; x++) {
            const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
            if (png.data[i + 3] === 0) continue;
            // Hue 230, about 98 degrees from the enemy magenta at 328: clears
            // the 90-degree floor at rest, falls under it once a mood rotates
            // it 14 degrees toward the enemy hue.
            png.data[i] = 38; png.data[i + 1] = 68; png.data[i + 2] = 217;
          }
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("bullet-separation-tinted");
    expect(rules(r)).not.toContain("bullet-separation");
  });

  it("catches a play-field sprite parked in the reserved enemy-bullet band", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["tile_floor_0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++) {
          const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
          png.data[i] = 255; png.data[i + 1] = 63; png.data[i + 2] = 164; png.data[i + 3] = 255;
        }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("protected-band");
  });

  it("exempts the HUD and door symbols, which are meant to hold their colour", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (const name of ["ui_heart_full", "icon_door_combat"]) {
        const rect = atlas.frames[name];
        for (let y = 0; y < rect.h; y++)
          for (let x = 0; x < rect.w; x++) {
            const i = ((rect.y + y) * png.width + (rect.x + x)) * 4;
            if (png.data[i + 3] === 0) continue;
            png.data[i] = 255; png.data[i + 1] = 63; png.data[i + 2] = 164;
          }
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).not.toContain("protected-band");
  });
});

/**
 * The staff the renderer turns through a cut is the **same staff** as the one
 * the body holds at rest.
 *
 * It is cut from the player's own model rather than drawn again, so there is
 * one staff in the game and it cannot drift; this holds that. It also holds
 * the grip, because the frame is centred on the part's pivot — where the
 * arm's `hand` joint carries it in the idle — which measures at about two
 * fifths of the shaft's length up from the butt, the way a hand holds a
 * staff. Centring it anywhere else spun the staff about its middle.
 */
describe("the staff sprite", () => {
  // The shipped atlas, not the placeholder: this is about the real drawing.
  const sheet = () => ({
    atlas: JSON.parse(readFileSync("assets/sprites.json", "utf8")) as {
      frames: Record<string, { x: number; y: number; w: number; h: number }>;
    },
    png: PNG.sync.read(readFileSync("assets/sprites.png")),
  });

  it("is in the sheet, with room for the crystal past the grip", () => {
    const { atlas } = sheet();
    const r = atlas.frames.weapon_player_staff;
    expect(r, "weapon_player_staff is missing").toBeDefined();
    expect(Math.min(r!.w, r!.h)).toBeGreaterThanOrEqual(96);
  });

  it("is the model's own staff part, at the model's own size", () => {
    const model = loadModel("player");
    const part = model.parts.get("s")?.get("staff.up");
    expect(part, "the player model has no staff.up to cut from").toBeDefined();
    const { atlas, png } = sheet();
    const r = atlas.frames.weapon_player_staff!;
    let top = Infinity, bottom = -1, left = Infinity, right = -1, opaque = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      if (!png.data[((r.y + y) * png.width + r.x + x) * 4 + 3]) continue;
      opaque++;
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      left = Math.min(left, x); right = Math.max(right, x);
    }
    // Exactly the part, plus the ring of ink the compositor traces round it:
    // the same length and the same thickness as the staff in the idle frame.
    const ring = 2 * model.rig.outline;
    expect(right - left + 1, "the swing staff is a different thickness from the idle one").toBe(part!.w + ring);
    expect(bottom - top + 1, "the swing staff is a different length from the idle one").toBe(part!.h + ring);
    // And it is filled like the part, not a solid block of it.
    const drawn = part!.px.filter(Boolean).length;
    expect(opaque).toBeGreaterThan(drawn);
    expect(opaque).toBeLessThan(drawn * 3);
  });

  it("grips it where the idle does: about two fifths up from the butt", () => {
    const { atlas, png } = sheet();
    const r = atlas.frames.weapon_player_staff!;
    let top = Infinity, bottom = -1;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      if (!png.data[((r.y + y) * png.width + r.x + x) * 4 + 3]) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    // The grip is the frame's centre, because that is what the renderer turns
    // the sprite about.
    const fromButt = (bottom - r.h / 2) / (bottom - top + 1);
    expect(fromButt, "the grip has moved along the shaft").toBeGreaterThan(0.3);
    expect(fromButt).toBeLessThan(0.5);
  });
});

/**
 * **The floor layer's stride** (`grainShare`, `floor-grain`).
 *
 * The spike plate shipped as a 32 px drawing doubled on to a 64 px frame, so
 * its holes and rivets were twice the size of the stones they lay between —
 * the right rectangle, the wrong pixels, which is precisely what the size and
 * value rules cannot see.
 */
describe("the floor layer's pixel size", () => {
  const sheet = () => ({
    atlas: JSON.parse(readFileSync("assets/sprites.json", "utf8")) as {
      frames: Record<string, { x: number; y: number; w: number; h: number }>;
    },
    png: PNG.sync.read(readFileSync("assets/sprites.png")),
  });

  /** A field of noise drawn at `stride` pixels: the same drawing, blown up. */
  function noise(size: number, stride: number): PNG {
    const cells = Math.ceil(size / stride);
    const field: number[] = [];
    let s = 12345;
    for (let i = 0; i < cells * cells; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      field.push(60 + ((s >>> 16) % 64));
    }
    const png = new PNG({ width: size, height: size });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = field[Math.floor(y / stride) * cells + Math.floor(x / stride)]!;
      const i = (y * size + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
    return png;
  }

  it("reads half the edges on odd pixels when the art is drawn at its own size", () => {
    const g = grainShare(noise(64, 1), { x: 0, y: 0, w: 64, h: 64 });
    expect(g.seams).toBeGreaterThan(MIN_FLOOR_GRAIN_SEAMS);
    expect(g.odd).toBeGreaterThan(0.44);
  });

  it("reads almost none when the same drawing was doubled", () => {
    const g = grainShare(noise(64, 2), { x: 0, y: 0, w: 64, h: 64 });
    expect(g.seams).toBeGreaterThan(MIN_FLOOR_GRAIN_SEAMS);
    expect(g.odd).toBeLessThan(0.1);
  });

  it("holds every hazard, decal and tile to the floor's own stride", () => {
    const { atlas, png } = sheet();
    const floors = Object.entries(atlas.frames)
      .filter(([n]) => /^tile_floor_\d$/.test(n))
      .map(([, r]) => grainShare(png, r).odd);
    expect(floors.length, "no delivered floor to measure against").toBeGreaterThan(0);
    const reference = floors.reduce((a, b) => a + b, 0) / floors.length;
    for (const [name, rect] of Object.entries(atlas.frames)) {
      if (!/^(tile_|hazard_|deco_)/.test(name)) continue;
      const g = grainShare(png, rect);
      if (g.seams < MIN_FLOOR_GRAIN_SEAMS) continue;
      expect(g.odd, `${name} is drawn in coarser pixels than the floor`)
        .toBeGreaterThanOrEqual(reference - MAX_FLOOR_GRAIN_DRIFT);
    }
  });

  it("fails the delivery when a hazard is drawn at twice the floor's pixel", () => {
    const report = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8")) as {
        frames: Record<string, { x: number; y: number; w: number; h: number }>;
      };
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      // The floor gets one-pixel noise, the hazard the same noise doubled.
      const paint = (frame: string, stride: number) => {
        const r = atlas.frames[frame]!;
        const src = noise(Math.max(r.w, r.h), stride);
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
          const i = ((r.y + y) * png.width + r.x + x) * 4;
          const j = (y * src.width + x) * 4;
          png.data.set(src.data.subarray(j, j + 4), i);
        }
      };
      for (const n of Object.keys(atlas.frames)) if (/^tile_floor_\d$/.test(n)) paint(n, 1);
      paint("hazard_spike_0", 2);
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(report)).toContain("floor-grain");
    expect(report.violations.some((v) => v.rule === "floor-grain" && v.frame === "hazard_spike_0")).toBe(true);
  });
});
