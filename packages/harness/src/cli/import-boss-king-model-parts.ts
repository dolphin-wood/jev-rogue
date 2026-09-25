/** Bring the approved B8 arm/key drawings into the Crypt King model. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { parsePx, writePx, type PxPart } from "../assets/px.ts";
import { quantise, type Palette } from "../assets/palette.ts";

const root = fileURLToPath(new URL("../../../../assets/", import.meta.url));
const arms = ["grip_stand", "grip_high", "grip_back", "grip_forward", "grip_low",
  "chain_wind", "chain_cast", "chain_reel", "hurt", "open"];
const key = ["kneel", "crouch", "air", "stagger"];
const grip: Record<string, readonly [number, number]> = {
  grip_stand: [128, 112], grip_high: [128, 40], grip_back: [190, 130],
  grip_forward: [232, 118], grip_low: [128, 143], chain_wind: [171, 116],
  chain_cast: [169, 111], chain_reel: [168, 84], hurt: [128, 94], open: [128, 112],
};
const phaseGrip: Record<number, Record<string, readonly [number, number]>> = {
  1: { grip_low: [128, 162] },
  2: { grip_back: [197, 130], grip_forward: [232, 119], grip_low: [128, 166] },
  3: { grip_back: [194, 130], grip_forward: [231, 120], grip_low: [128, 159] },
};
const armGrip = (phase: number, name: string): readonly [number, number] =>
  phaseGrip[phase]?.[name] ?? grip[name]!;
const keyGrip: Record<number, Record<string, readonly [number, number]>> = {
  1: { kneel: [121, 146], crouch: [72, 132], air: [128, 23], stagger: [174, 123] },
  2: { kneel: [128, 164], crouch: [70, 128], air: [128, 22], stagger: [144, 142] },
  3: { kneel: [130, 135], crouch: [69, 119], air: [128, 24], stagger: [112, 129] },
};
const deliveryAnchors: Record<string, unknown> = {
  sword: { grip: [32, 158], artSize: [64, 192] },
  phases: {},
};

for (const phase of [1, 2, 3]) {
  const model = join(root, `models/boss_p${phase}`);
  const palette = JSON.parse(readFileSync(join(model, "palette.json"), "utf8")) as Palette;
  const file = join(model, "s.px");
  const parsed = parsePx(readFileSync(file, "utf8"), file);
  const keep = parsed.parts.filter((p) => p.part !== "figure" && p.part !== "torso" &&
    (p.part !== "arms" || p.variant === "stand"));
  const imported: PxPart[] = [];
  const add = (png: PNG, part: string, variant: string,
    pivot: readonly [number, number], joints: Record<string, readonly [number, number]>) => {
    const w = png.width / 4, h = png.height / 4;
    let left = w, top = h, right = -1, bottom = -1;
    const pixels = Array.from({ length: w * h }, (_, k) => {
      const x = k % w, y = Math.floor(k / w);
      const i = ((y * 4 + 2) * png.width + x * 4 + 2) * 4;
      if (png.data[i + 3]! < 220) return null;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
      return quantise([png.data[i]!, png.data[i + 1]!, png.data[i + 2]!], palette, [], 1);
    });
    if (right < left) throw new Error(`${part}.${variant}: empty`);
    const crop: (typeof pixels)[number][] = [];
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++)
      crop.push(pixels[y * w + x]!);
    imported.push({ part, variant, pivot: [pivot[0] - left, pivot[1] - top],
      joints: Object.fromEntries(Object.entries(joints).map(([n, [x, y]]) => [n, [x - left, y - top]])),
      w: right - left + 1, h: bottom - top + 1, px: crop });
  };
  const oldTorso = parsed.parts.find((p) => p.part === "torso" && p.variant === "stand");
  if (!oldTorso) throw new Error(`boss_p${phase}: missing torso.stand`);
  const oldLeft = 128 - oldTorso.pivot[0], oldTop = 128 - oldTorso.pivot[1];
  const oldJoints = Object.fromEntries(Object.entries(oldTorso.joints).map(([name, [x, y]]) =>
    [name, [oldLeft + x, oldTop + y] as const]));
  add(PNG.sync.read(readFileSync(join(root, `source/melee/boss-king/p${phase}/model_torso.png`))),
    "torso", "stand", [128, 128], oldJoints);
  for (let i = 1; i < arms.length; i++) {
    const png = PNG.sync.read(readFileSync(join(root, `source/melee/boss-king/p${phase}/arm_${i}.png`)));
    add(png, "arms", arms[i]!, [128, 86], { grip: armGrip(phase, arms[i]!) });
  }
  for (const pose of key) {
    const png = PNG.sync.read(readFileSync(join(root, `source/melee/boss-king/p${phase}/model_${pose}.png`)));
    add(png, "figure", pose, [128, 128], { grip: keyGrip[phase]![pose]! });
  }
  writeFileSync(file, writePx(parsed.legend, [...keep, ...imported],
    `Crypt King phase ${phase}: split identity plus separately painted B8 arms and key figures.`));

  const posesPath = join(model, "poses.json");
  const poses = JSON.parse(readFileSync(posesPath, "utf8"));
  poses.s.stand ??= { parts: {} };
  for (const name of arms.slice(1)) poses.s[name] = { base: "stand", parts: { arms: name } };
  for (const name of key) poses.s[name] = { parts: { figure: name } };
  writeFileSync(posesPath, JSON.stringify(poses, null, 2) + "\n");
  (deliveryAnchors.phases as Record<string, unknown>)[`p${phase}`] = {
    identity: { neck: [128, 78], shoulders: [128, 86], waist: [128, 129], grip: [128, 112], feet: [128, 224] },
    arms: Object.fromEntries(arms.map((name) => [name, { grip: armGrip(phase, name) }])),
    keys: Object.fromEntries(key.map((name) => [name, { grip: keyGrip[phase]![name] }])),
    chain: phase === 3 ? [128, 97] : [91, 115],
  };
  console.log(`boss_p${phase}: ${imported.length} B8 part variants imported`);
}
writeFileSync(join(root, "source/melee/boss-king-model-anchors.json"),
  JSON.stringify(deliveryAnchors, null, 2) + "\n");
