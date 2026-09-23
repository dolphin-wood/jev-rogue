import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { generatePlaceholders } from "./placeholder.ts";
import { checkAssets } from "./check.ts";
import { MANIFEST } from "./manifest.ts";

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

  it("catches an enemy body recoloured to the floor's value", () => {
    const r = mutated((dir) => {
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["enemy_rusher_s_idle0"];
      const png = PNG.sync.read(readFileSync(join(dir, "sprites.png")));
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * png.width + rect.x + x) * 4;
        if (png.data[i + 3] === 0) continue;
        png.data[i] = 43; png.data[i + 1] = 45; png.data[i + 2] = 84;
      }
      writeFileSync(join(dir, "sprites.png"), PNG.sync.write(png));
    });
    expect(rules(r)).toContain("enemy-floor-contrast");
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
      // push opaque pixels into one corner only
      const atlas = JSON.parse(readFileSync(join(dir, "sprites.json"), "utf8"));
      const rect = atlas.frames["player_s_idle0"];
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
