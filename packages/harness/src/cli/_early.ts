import { playRun } from "../play/run.ts";
for (const seed of ["seed-0", "seed-1", "seed-2", "seed-3"]) {
  const out = await playRun(seed, "rule");
  console.log(seed, out.rooms.slice(0, 4).map((r) => `#${r.index} ${r.type} roster=${r.shape?.roster ?? "-"} kills=${r.enemies}`).join(" | "));
}
