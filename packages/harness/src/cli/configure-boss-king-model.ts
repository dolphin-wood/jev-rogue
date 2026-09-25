/** Install the shared B8 rig and split maps before running sprite:split. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../assets/", import.meta.url));
const palette = readFileSync(join(root, "source/melee/boss-king-palette.json"), "utf8");

for (const phase of [1, 2, 3]) {
  const path = join(root, `models/boss_p${phase}`);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "palette.json"), palette);
  const claims: Record<string, number[][]> = {
    head: [[102, 20, 155, 82]],
    arms: [[67, 66, 109, 137], [147, 66, 190, 137], [105, 97, 151, 129]],
    chains: phase === 3
      ? [[75, 105, 99, 214], [154, 105, 180, 214], [119, 112, 137, 197]]
      : [[91, 107, 107, 179], [149, 107, 167, 179]],
    hem: [[100, 124, 158, 162]],
    foot_l: [[65, 149, 126, 229]],
    foot_r: [[130, 149, 191, 229]],
    cape: phase === 3 ? [] : [[32, 85, 93, 202], [163, 85, 224, 202], [112, 157, 146, 203]],
  };
  const cfg = {
    rules: [], outlineLuma: 1,
    paletteFrames: [`boss_p${phase}_model_stand`],
    letters: { head: "h", torso: "t", cape: "c", hem: "m", arms: "a", foot_l: "l", foot_r: "r", chains: "k" },
    rest: "torso", anchorsOn: { grip: "arms", chain: "chains" },
    rig: {
      size: [256, 256], outline: 2, feet: ["foot_l", "foot_r"],
      detached: ["chains"], optionalAnchors: ["chain"],
      facings: { s: { origin: [128, 128], parts: [
        { name: "cape", parent: "torso", joint: "cape_mount", depth: 0 },
        { name: "foot_l", parent: null, depth: .5 },
        { name: "foot_r", parent: null, depth: .5 },
        { name: "torso", parent: null, depth: 1 },
        { name: "hem", parent: "torso", joint: "waist", depth: 1.5 },
        { name: "chains", parent: "torso", joint: "chain_mount", depth: 1.8 },
        { name: "arms", parent: "torso", joint: "shoulders", depth: 2 },
        { name: "head", parent: "torso", joint: "neck", depth: 3 },
        { name: "figure", parent: null, depth: 4 },
      ] } },
    },
    facings: { s: [{
      variant: "stand", frame: `boss_p${phase}_model_stand`, claims,
      joints: { neck: [128, 78], shoulders: [128, 86], cape_mount: [128, 84],
        waist: [128, 129], chain_mount: [128, 102], grip: [128, 112], chain: phase === 3 ? [128, 97] : [91, 115] },
    }] },
  };
  writeFileSync(join(path, "split.json"), JSON.stringify(cfg, null, 2) + "\n");
  writeFileSync(join(path, "anims.json"), JSON.stringify({ facings: ["s"], frames: {
    [`boss_p${phase}_model_stand`]: "stand",
  } }, null, 2) + "\n");
  const motion = {
    base: `boss_p${phase}`, facings: ["s"], flatNames: true,
    weight: "heavy", gait: "walk", stand: "stand",
    roles: { torso: "body", head: "head", foot_l: "foot_l", foot_r: "foot_r",
      arms: "arm_l", cape: "skirt", hem: "skirt", chains: "skirt" },
    // Combat and locomotion now use the authored full-body frames. Retain the
    // split model as a diagnostic reference for phase changes and future art.
    deliver: [],
    extra: { model_stand: "stand" },
    poses: {
      windup: { base: "grip_high" },
      lunge: { base: "grip_forward" },
      follow: { base: "grip_forward", parts: { torso: { at: [-4, 2] } } },
      recover: { between: ["follow", "stand"], t: .5 },
      hit0: { base: "hurt", parts: { torso: { at: [-4, 0] } } },
      hit1: { base: "hurt", parts: { torso: { at: [4, 0] } } },
      tele: { base: "stand", parts: { torso: { at: [0, -1] } } },
      tele1: { base: "stand", parts: { torso: { at: [0, -2] } } },
      sweep_wind: { base: "grip_back", ...(phase === 3 ? { parts: { arms: { at: [-8, 0] } } } : {}) },
      sweep_cut: { base: "grip_forward" },
      sweep_recover: { base: "grip_forward", parts: { torso: { at: [-3, 2] } } },
      ...(phase === 3 ? { chain_cast: { base: "stand", parts: { arms: { v: "chain_cast", at: [10, 0] } } } } : {}),
      cleave_cut: { base: "grip_low", parts: { torso: { at: [0, 3] } } },
      cleave_stuck: { base: "kneel" },
    },
  };
  writeFileSync(join(path, "motion.json"), JSON.stringify(motion, null, 2) + "\n");
}
