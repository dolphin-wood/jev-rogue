/** Restore ink lost when the Crypt King's backgrounds were removed. Idempotent. */
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../../../../assets/source/melee/boss-king/", import.meta.url));
const palette = JSON.parse(readFileSync(join(root, "../boss-king-palette.json"), "utf8")) as { ramps: { heart: string[] } };
const heart = palette.ramps.heart.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const S = 256, N = S * S, SCALE = 4;
const ink = [8, 7, 13, 255];
const write = process.argv.includes("--write");
const at = (x: number, y: number): number => ((y * SCALE) * S * SCALE + x * SCALE) * 4;

function ceremony(phase: number): void {
  const path = join(root, `p${phase}`);
  const original = PNG.sync.read(readFileSync(join(path, "idle_ceremonial.png")));
  if (original.width !== 1024 || original.height !== 1024) throw new Error(`p${phase}: ceremonial size`);
  if (!write) return;
  copyFileSync(join(path, "idle_ceremonial.png"), join(path, "ceremony0.png"));
  const breath = PNG.sync.read(readFileSync(join(path, "idle_ceremonial.png")));
  for (let y = 50; y <= 130; y++) for (let x = 65; x <= 160; x++) {
    const i = at(x, y);
    if (breath.data[i + 3] !== 255) continue;
    const shade = heart.findIndex((color) => color.every((value, n) => value === breath.data[i + n]));
    if (shade < 0 || shade >= heart.length - 1) continue;
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++)
      breath.data.set([...heart[shade + 1]!, 255], i + (dy * 1024 + dx) * 4);
  }
  writeFileSync(join(path, "ceremony1.png"), PNG.sync.write(breath));
}

function maskOf(image: PNG): Uint8Array {
  if (image.width !== 1024 || image.height !== 1024) throw new Error("expected 1024×1024 boss source");
  const mask = new Uint8Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) mask[y * S + x] = image.data[at(x, y) + 3]! >= 128 ? 1 : 0;
  return mask;
}

function repair(image: PNG, phase: number): { added: number; largestHole: number } {
  const original = maskOf(image), dilated = new Uint8Array(N), closed = new Uint8Array(N);
  // A one-art-pixel morphological close reconnects missing 1–2 px ink seams.
  // It leaves the broad openings between Phase III bones open.
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    let hit = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) hit |= original[(y + dy) * S + x + dx]!;
    dilated[y * S + x] = hit;
  }
  for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
    let hit = 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) hit &= dilated[(y + dy) * S + x + dx]!;
    closed[y * S + x] = hit | original[y * S + x]!;
  }
  for (let i = 0; i < N; i++) closed[i] = closed[i]! | original[i]!;

  // Flood the remaining transparent components. Exterior background stays clear;
  // small enclosed plate seams become ink. Large anatomical gaps stay clear.
  const visited = new Uint8Array(N), repaired = closed.slice();
  let largestHole = 0;
  for (let i = 0; i < N; i++) {
    if (closed[i] || visited[i]) continue;
    const queue = [i]; let head = 0, exterior = false;
    let minX = S, maxX = 0, minY = S, maxY = 0;
    visited[i] = 1;
    while (head < queue.length) {
      const u = queue[head++]!, x = u % S, y = Math.floor(u / S);
      if (x === 0 || y === 0 || x === S - 1 || y === S - 1) exterior = true;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || xx >= S || yy < 0 || yy >= S) continue;
        const v = yy * S + xx;
        if (!closed[v] && !visited[v]) { visited[v] = 1; queue.push(v); }
      }
    }
    const smallSeam = phase === 3
      ? queue.length <= 12 && maxX - minX <= 5 && maxY - minY <= 5
      : queue.length <= 200 && maxX - minX <= 30 && maxY - minY <= 30;
    if (!exterior && smallSeam) {
      for (const u of queue) repaired[u] = 1;
      largestHole = Math.max(largestHole, queue.length);
    }
  }

  let added = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const j = y * S + x;
    if (!repaired[j] || original[j]) continue;
    added++;
    if (!write) continue;
    const i = at(x, y);
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++)
      image.data.set(ink, i + (dy * 1024 + dx) * 4);
  }
  return { added, largestHole };
}

let frames = 0, pixels = 0;
const worst: { name: string; added: number; largestHole: number }[] = [];
for (const phase of [1, 2, 3]) {
  ceremony(phase);
  const directory = join(root, `p${phase}`);
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".png"))) {
    const file = join(directory, name), image = PNG.sync.read(readFileSync(file));
    const result = repair(image, phase);
    if (write && result.added) writeFileSync(file, PNG.sync.write(image));
    frames++; pixels += result.added;
    worst.push({ name: `p${phase}/${name}`, ...result });
  }
}
worst.sort((a, b) => b.added - a.added);
console.log(`${write ? "Restored" : "Would restore"} ${pixels} ink pixels across ${frames} boss sources.`);
console.log(worst.slice(0, 12));
