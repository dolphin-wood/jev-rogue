import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/boss-king/", import.meta.url));

function frame(phase: number, pose: string): PNG {
  return PNG.sync.read(readFileSync(join(root, `p${phase}`, `${pose}.png`)));
}

function armourArea(image: PNG): number {
  let n = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = ((y * 4) * 1024 + x * 4) * 4;
    if (image.data[i + 3]! < 16) continue;
    const r = image.data[i]!, g = image.data[i + 1]!, b = image.data[i + 2]!;
    if (b > r + 15 && b > g + 25) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo < 28 && hi > 120) continue;
    n++;
  }
  return n;
}

/** Compare silhouettes in world coordinates, not at the upper-left corner:
 * raised-sword and airborne drawings use larger cells around the same feet. */
function distance(a: PNG, b: PNG): number {
  const hit = (image: PNG, x: number, y: number): boolean => {
    const ax = x + image.width / 8;
    const ay = y + image.height / 8 + 91;
    if (ax < 0 || ay < 0 || ax >= image.width / 4 || ay >= image.height / 4) return false;
    return image.data[((ay * 4) * image.width + ax * 4) * 4 + 3]! > 0;
  };
  let intersection = 0, union = 0;
  for (let y = -250; y < 160; y++) for (let x = -190; x < 190; x++) {
    const aa = hit(a, x, y), bb = hit(b, x, y);
    if (aa && bb) intersection++;
    if (aa || bb) union++;
  }
  return 1 - intersection / union;
}

describe("Crypt King key poses", () => {
  for (const phase of [1, 2, 3]) {
    it(`phase ${phase} keeps both planted strikes at the guard's physical size`, () => {
      const guard = armourArea(frame(phase, "idle0"));
      for (const pose of ["slam", "cleave_stuck"]) {
        const ratio = armourArea(frame(phase, pose)) / guard;
        expect(ratio, `p${phase}/${pose}`).toBeGreaterThan(.95);
        expect(ratio, `p${phase}/${pose}`).toBeLessThan(1.05);
      }
    });
    it(`phase ${phase} lifts the ground-spell sword before driving it down`, () => {
      const idleArea = armourArea(frame(phase, "idle0"));
      for (const pose of ["slam_lift", "slam_drive"]) {
        const ratio = armourArea(frame(phase, pose)) / idleArea;
        expect(ratio, `p${phase}/${pose}`).toBeGreaterThan(.9);
        expect(ratio, `p${phase}/${pose}`).toBeLessThan(1.1);
      }
      const anchors = JSON.parse(readFileSync(join(root, "../boss-king-anchors.json"), "utf8")) as {
        frames: Record<string, { tip: [number, number] }>;
      };
      const raised = anchors.frames[`boss_p${phase}_slam_lift`]?.tip;
      const planted = anchors.frames[`boss_p${phase}_slam_drive`]?.tip;
      expect(raised).toBeDefined();
      expect(planted).toBeDefined();
      expect(planted![1] - raised![1]).toBeGreaterThanOrEqual(18);
      expect(Math.abs(raised![0] - planted![0])).toBeLessThanOrEqual(8);
    });
    it(`phase ${phase} keeps its breathing and attacks legible`, () => {
      const pair = (a: string, b: string) => distance(frame(phase, a), frame(phase, b));
      const low = frame(phase, "idle0"), high = frame(phase, "idle1");
      let changed = 0, silhouetteChanges = 0, outsideChanges = 0;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const i = ((y * 4) * 1024 + x * 4) * 4;
        if (high.data[i + 3] !== low.data[i + 3]) silhouetteChanges++;
        const different = [0, 1, 2].some((channel) => high.data[i + channel] !== low.data[i + channel]);
        if (different) changed++;
        if (different && (x < 65 || x > 195 || y < 50 || y > 130)) outsideChanges++;
      }
      expect(silhouetteChanges).toBe(0);
      expect(outsideChanges).toBe(0);
      expect(changed).toBeGreaterThan(100);
      expect(pair("windup", "commit")).toBeGreaterThanOrEqual(.40);
      expect(pair("leap_gather", "leap_air")).toBeGreaterThanOrEqual(.40);
      expect(pair("idle1", "slam")).toBeGreaterThanOrEqual(.35);
      expect(pair("idle0", "hit0")).toBeGreaterThan(.25);
      expect(pair("windup", "hook")).toBeGreaterThan(.25);
      expect(pair("commit", "backhand")).toBeGreaterThan(.25);
    });
  }

  it("keeps plate seams opaque in every source while the ceremonial guard stays packed", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../../assets/sprites.json", import.meta.url), "utf8")) as {
      frames: Record<string, unknown>;
    };
    for (const phase of [1, 2, 3]) {
      expect(manifest.frames[`boss_p${phase}_ceremony0`]).toBeDefined();
      expect(manifest.frames[`boss_p${phase}_ceremony1`]).toBeDefined();
      for (const file of readdirSync(join(root, `p${phase}`)).filter((name) => name.endsWith(".png"))) {
        const image = frame(phase, file.slice(0, -4));
        const opaque = new Uint8Array(256 * 256);
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++)
          opaque[y * 256 + x] = image.data[((y * 4) * 1024 + x * 4) * 4 + 3]! >= 128 ? 1 : 0;
        let pinholes = 0;
        for (let y = 1; y < 255; y++) for (let x = 1; x < 255; x++) {
          const i = y * 256 + x;
          if (opaque[i]) continue;
          if (opaque[i - 1]! + opaque[i + 1]! + opaque[i - 256]! + opaque[i + 256]! >= 3) pinholes++;
        }
        expect(pinholes, `p${phase}/${file}`).toBe(0);
      }
    }
  });
});
