/** Measure baked-sword tips and deliver per-frame effect origins on the 256px boss atlas grid. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const atlas = PNG.sync.read(readFileSync(join(root, "assets/sprites.png")));
const manifest = JSON.parse(readFileSync(join(root, "assets/sprites.json"), "utf8")) as {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
};

const sequences = {
  greatsweep: {
    windup: ["sweep_wind"],
    strike: ["sweep_enter", "sweep_cross", "sweep_mid", "sweep_cut"],
    recovery: ["sweep_recover", "sweep_reset", "recover"],
    direction: "Sword tip travels screen-right → lower-right → down → lower-left → screen-left; mirror the complete sequence for the opposite side.",
  },
  greatcleave: {
    windup: ["windup", "cleave_raise"],
    strike: ["cleave_fall", "cleave_cut"],
    recovery: ["cleave_hold", "recover"],
    direction: "Sword tip travels upper-right → screen-right → lower-right ground; mirror the complete sequence for the opposite side.",
  },
  dashcut: {
    windup: ["leap_gather"],
    strike: ["dash_cut"],
    recovery: ["dash_skid", "recover"],
    direction: "Boss lunges screen-right with a level blade, then brakes with the blade trailing lower-left; mirror the complete sequence for the opposite side.",
  },
} as const;

const tipDirection: Record<string, readonly [number, number]> = {
  idle0: [1, -1], idle1: [1, -1], ceremony0: [0, 1], ceremony1: [0, 1], tele: [0, 1],
  windup: [1, -1], sweep_wind: [1, 0], sweep_enter: [1, 1],
  sweep_cross: [0, 1], sweep_mid: [-1, 1], sweep_cut: [-1, 0],
  sweep_recover: [1, 1], sweep_reset: [1, 1],
  cleave_raise: [1, -1], cleave_fall: [1, 0],
  cleave_cut: [1, 1], cleave_hold: [1, 1], cleave_stuck: [0, 1],
  dash_cut: [1, 0], dash_skid: [-1, 1], recover: [1, -1],
  commit: [1, 1], follow: [-1, 1], hit0: [-1, -1], hit1: [-1, -1],
  leap_gather: [-1, -1], leap_air: [1, -1], slam: [0, 1], slam_lift: [0, 1], slam_drive: [0, 1],
  hook: [-1, -1], backhand: [1, 0],
  walk0: [-1, 1], walk1: [-1, 1], walk2: [-1, 1],
  walk3: [-1, 1], walk4: [-1, 1], walk5: [-1, 1],
  chain_wind: [1, -1], chain_cast: [-1, -1], chain_follow: [-1, -1],
  hook_wind: [-1, -1], hook_reel: [-1, -1],
  stagger0: [0, 1], stagger1: [0, 1],
};

// Left-hand chain release points were marked against each packed pose. Phase III
// ejects its chain from the exposed heart instead, measured below from pixels.
const handL: Record<1 | 2, Record<string, [number, number]>> = {
  1: {
    idle0: [101, 121], idle1: [101, 121], ceremony0: [128, 112], ceremony1: [128, 112], tele: [179, 61],
    windup: [89, 79], commit: [113, 114], follow: [133, 132],
    hit0: [177, 143], hit1: [177, 143], leap_gather: [211, 195],
    leap_air: [127, 45], slam: [125, 119], slam_lift: [128, 80], slam_drive: [128, 125], hook: [157, 94], backhand: [112, 150],
    walk0: [181, 145], walk1: [181, 144], walk2: [181, 143],
    walk3: [183, 151], walk4: [183, 150], walk5: [183, 149],
    sweep_wind: [82, 109], sweep_enter: [125, 143], sweep_cross: [113, 102],
    sweep_mid: [129, 137], sweep_cut: [129, 118], sweep_recover: [136, 140],
    sweep_reset: [123, 126], cleave_raise: [116, 85], cleave_fall: [111, 105],
    cleave_cut: [143, 129], cleave_hold: [136, 138], cleave_stuck: [128, 115], dash_cut: [126, 130],
    dash_skid: [124, 139], recover: [101, 121],
    chain_wind: [105, 79], chain_cast: [202, 100], chain_follow: [134, 130],
    hook_wind: [172, 58], hook_reel: [133, 106],
    stagger0: [158, 158], stagger1: [185, 205],
  },
  2: {
    idle0: [109, 119], idle1: [109, 119], ceremony0: [128, 112], ceremony1: [128, 112], tele: [181, 58],
    windup: [93, 80], commit: [114, 113], follow: [139, 130],
    hit0: [168, 132], hit1: [169, 132], leap_gather: [184, 203],
    leap_air: [123, 39], slam: [125, 118], slam_lift: [128, 91], slam_drive: [128, 130], hook: [154, 99], backhand: [112, 137],
    walk0: [189, 143], walk1: [190, 146], walk2: [190, 142],
    walk3: [189, 153], walk4: [189, 152], walk5: [190, 151],
    sweep_wind: [118, 118], sweep_enter: [124, 139], sweep_cross: [117, 103],
    sweep_mid: [132, 135], sweep_cut: [135, 116], sweep_recover: [57, 208],
    sweep_reset: [126, 126], cleave_raise: [115, 82], cleave_fall: [119, 105],
    cleave_cut: [148, 130], cleave_hold: [145, 138], cleave_stuck: [128, 115], dash_cut: [122, 130],
    dash_skid: [149, 144], recover: [109, 119],
    chain_wind: [76, 117], chain_cast: [196, 104], chain_follow: [129, 142],
    hook_wind: [64, 46], hook_reel: [141, 78],
    stagger0: [160, 158], stagger1: [170, 213],
  },
};

function tip(frameName: string, direction: readonly [number, number]): [number, number] {
  const frame = manifest.frames[frameName];
  if (!frame || frame.w !== 256 || frame.h !== 256) throw new Error(`${frameName}: expected a packed 256×256 frame`);
  let best: [number, number] | null = null;
  let score = -Infinity;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    // A planted or lifted blade runs down the centre. Its brightest tip can
    // sit above cream-coloured boots, which otherwise win a downward scan.
    if (/_slam_(?:lift|drive)$/.test(frameName) && Math.abs(x - 128) > 18) continue;
    const i = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    const r = atlas.data[i]!, g = atlas.data[i + 1]!, b = atlas.data[i + 2]!;
    // The blade's cream highlight is present at each authored tip.
    if (atlas.data[i + 3]! < 128 || r <= 145 || g <= 130 || b <= 95 || r <= b) continue;
    const projected = (x - 128) * direction[0] + (y - 128) * direction[1];
    if (projected > score) { score = projected; best = [x, y]; }
  }
  if (!best) throw new Error(`${frameName}: no visible sword tip`);
  return best;
}

function verticalSwordTip(frameName: string, xMin: number, xMax: number): [number, number] {
  const frame = manifest.frames[frameName]!;
  let best: [number, number] | null = null;
  for (let y = 155; y < 235; y++) for (let x = xMin; x <= xMax; x++) {
    const i = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    const r = atlas.data[i]!, g = atlas.data[i + 1]!, b = atlas.data[i + 2]!;
    if (atlas.data[i + 3]! < 128 || r <= 145 || g <= 130 || b <= 95 || r <= b) continue;
    if (!best || y > best[1]) best = [x, y];
  }
  if (!best) throw new Error(`${frameName}: no downward sword tip`);
  return best;
}

function snapToInk(frameName: string, point: [number, number]): [number, number] {
  const frame = manifest.frames[frameName]!;
  let best: [number, number] | null = null;
  let distance = Infinity;
  for (let y = Math.max(0, point[1] - 16); y <= Math.min(255, point[1] + 16); y++)
    for (let x = Math.max(0, point[0] - 16); x <= Math.min(255, point[0] + 16); x++) {
      const i = ((frame.y + y) * atlas.width + frame.x + x) * 4;
      const d = (x - point[0]) ** 2 + (y - point[1]) ** 2;
      if (atlas.data[i + 3]! >= 128 && d < distance) { best = [x, y]; distance = d; }
    }
  if (!best) throw new Error(`${frameName}: hand anchor is more than 16px from the drawing`);
  return best;
}

function heart(frameName: string): [number, number] {
  const frame = manifest.frames[frameName];
  if (!frame) throw new Error(`${frameName}: missing atlas frame`);
  let best: [number, number] = [128, 103], score = -Infinity;
  for (let y = 55; y < 150; y++) for (let x = 80; x < 175; x++) {
    const i = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    const r = atlas.data[i]!, g = atlas.data[i + 1]!, b = atlas.data[i + 2]!;
    if (atlas.data[i + 3]! < 128) continue;
    const warmth = r * 2 + g - b * 2 - Math.abs(x - 128) * 3 - Math.abs(y - 103) * 2;
    if (warmth > score) { score = warmth; best = [x, y]; }
  }
  return best;
}

const frames: Record<string, { source: string; tip: [number, number]; hand_l: [number, number] }> = {};
for (const phase of [1, 2, 3] as const) for (const [pose, baseDirection] of Object.entries(tipDirection)) {
  const frameName = `boss_p${phase}_${pose}`;
  const direction = phase === 3 && ["hit0", "hit1", "chain_wind", "chain_cast", "chain_follow", "hook_wind", "hook_reel"].includes(pose)
    ? [1, -1] as const : baseDirection;
  frames[frameName] = {
    source: `assets/source/melee/boss-king/p${phase}/${pose}.png`,
    tip: phase === 3 && pose === "hook" ? [130, 20]
      : phase === 2 && pose === "hook_wind" ? [222, 107]
      : ["ceremony0", "ceremony1"].includes(pose) ? verticalSwordTip(frameName, 105, 155)
      : ["stagger0", "stagger1"].includes(pose) ? verticalSwordTip(frameName, 80, 115)
      : pose === "slam" ? verticalSwordTip(frameName, 115, 142) : tip(frameName, direction),
    hand_l: phase === 3 ? heart(frameName) : snapToInk(frameName, handL[phase][pose]!),
  };
  if (!frames[frameName].hand_l) throw new Error(`${frameName}: missing hand_l anchor`);
  for (const point of [frames[frameName].tip, frames[frameName].hand_l]) {
    const frame = manifest.frames[frameName]!;
    const i = ((frame.y + point[1]) * atlas.width + frame.x + point[0]) * 4;
    if (atlas.data[i + 3]! < 128) throw new Error(`${frameName}: anchor ${point} is outside the drawing`);
  }
}
const packed = Object.keys(manifest.frames).filter((name) => /^boss_p[123]_(?!model_stand)/.test(name));
const missing = packed.filter((name) => !frames[name]);
if (missing.length) throw new Error(`Missing boss anchors: ${missing.join(", ")}`);

const result = {
  schemaVersion: 1,
  coordinateSpace: "top-left of each unflipped 256×256 atlas frame, in art pixels",
  frameSize: [256, 256],
  handedness: "Boss right hand grips the sword; hand_l is the left-hand chain release point, except Phase III where it is the exposed heart core.",
  mirrorX: "For a horizontally mirrored frame, x becomes 255 - x for both anchors.",
  sequences,
  frames,
};
writeFileSync(join(root, "assets/source/melee/boss-king-anchors.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(`boss action data: ${Object.keys(frames).length} tip and left-hand anchors`);
