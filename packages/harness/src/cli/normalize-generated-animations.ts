/**
 * Normalises approved ImageGen animation sheets onto the game's final pixel
 * grid, then stores them as 4x nearest-neighbour sources. This removes the
 * diffuse generation matte without blurring the authored silhouettes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const OUT = new URL("../../../../assets/source/melee/", import.meta.url);

interface Cell { col: number; row: number; target: number }

function contentBounds(p: PNG, left: number, top: number, right: number, bottom: number): [number, number, number, number] {
  let l = right, t = bottom, r = left, b = top;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (p.data[(y * p.width + x) * 4 + 3]! <= 180) continue;
    l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + 1); b = Math.max(b, y + 1);
  }
  if (r <= l || b <= t) throw new Error(`Empty generated cell ${left},${top},${right},${bottom}`);
  return [l, t, r, b];
}

function renderCell(raw: PNG, bounds: [number, number, number, number], target: number): PNG {
  const [l, t, r, b] = bounds;
  const margin = target >= 96 ? 10 : 7;
  const scale = Math.min((target - margin * 2) / (r - l), (target - margin * 2) / (b - t));
  const w = Math.max(1, Math.round((r - l) * scale));
  const h = Math.max(1, Math.round((b - t) * scale));
  const x0 = Math.floor((target - w) / 2);
  const y0 = Math.floor((target - h) / 2);
  const small = new PNG({ width: target, height: target });
  small.data.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(r - 1, l + Math.floor((x + 0.5) * (r - l) / w));
    const sy = Math.min(b - 1, t + Math.floor((y + 0.5) * (b - t) / h));
    const si = (sy * raw.width + sx) * 4;
    if (raw.data[si + 3]! <= 180) continue;
    const di = ((y0 + y) * target + x0 + x) * 4;
    small.data.set(raw.data.subarray(si, si + 3), di);
    small.data[di + 3] = 255;
  }
  return small;
}

function upscale4(p: PNG): PNG {
  const out = new PNG({ width: p.width * 4, height: p.height * 4 });
  out.data.fill(0);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const si = (y * p.width + x) * 4;
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      const di = (((y * 4 + yy) * out.width) + x * 4 + xx) * 4;
      out.data.set(p.data.subarray(si, si + 4), di);
    }
  }
  return out;
}

function normaliseGrid(outName: string, cols: number, rows: number, target: number): void {
  const raw = PNG.sync.read(readFileSync(new URL(outName.replace(".png", "-draft.png"), OUT)));
  const sheet = new PNG({ width: cols * target, height: rows * target });
  sheet.data.fill(0);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const left = Math.round(col * raw.width / cols), right = Math.round((col + 1) * raw.width / cols);
    const top = Math.round(row * raw.height / rows), bottom = Math.round((row + 1) * raw.height / rows);
    const cell = renderCell(raw, contentBounds(raw, left, top, right, bottom), target);
    PNG.bitblt(cell, sheet, 0, 0, target, target, col * target, row * target);
  }
  writeFileSync(new URL(outName, OUT), PNG.sync.write(upscale4(sheet)));
}

function normaliseDeaths(): void {
  const raw = PNG.sync.read(readFileSync(new URL("enemy-deaths-draft.png", OUT)));
  const specs: Array<{ name: string; cells: Cell[] }> = [
    { name: "enemy-deaths-64.png", cells: [
      { col: 0, row: 0, target: 64 }, { col: 1, row: 0, target: 64 },
      { col: 2, row: 0, target: 64 }, { col: 0, row: 1, target: 64 },
    ] },
    { name: "enemy-deaths-96.png", cells: [
      { col: 1, row: 1, target: 96 }, { col: 2, row: 1, target: 96 },
    ] },
  ];
  for (const spec of specs) {
    const target = spec.cells[0]!.target;
    const sheet = new PNG({ width: target * spec.cells.length, height: target });
    sheet.data.fill(0);
    spec.cells.forEach((cell, i) => {
      const left = Math.round(cell.col * raw.width / 3), right = Math.round((cell.col + 1) * raw.width / 3);
      const top = Math.round(cell.row * raw.height / 2), bottom = Math.round((cell.row + 1) * raw.height / 2);
      const image = renderCell(raw, contentBounds(raw, left, top, right, bottom), target);
      PNG.bitblt(image, sheet, 0, 0, target, target, i * target, 0);
    });
    writeFileSync(new URL(spec.name, OUT), PNG.sync.write(upscale4(sheet)));
  }
}

mkdirSync(OUT, { recursive: true });
normaliseGrid("enemy-rusher-hit.png", 2, 3, 64);
normaliseGrid("enemy-shooter-hit.png", 2, 3, 64);
normaliseGrid("enemy-orbiter-hit.png", 2, 3, 64);
normaliseGrid("enemy-summoner-hit.png", 2, 3, 96);
normaliseGrid("enemy-turret-hit.png", 2, 1, 64);
normaliseGrid("companion-walk.png", 4, 3, 64);
normaliseDeaths();
