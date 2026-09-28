/**
 * The animation lab (dev page: `/anim-lab.html`): every animated thing in the
 * game on one stage, played the way the game draws it.
 *
 * - **Rigs**: the player (drawn parts) and the warden (cut parts), posed by
 *   the moves in `lab/rig.ts`, steerable with the keyboard, each joint
 *   adjustable by hand, with the pixel-art answers to rotation as switches:
 *   angle steps, whole-pixel positions, clean rotation, and a frame rate —
 *   12 is what "baked" frames played on twos would look like.
 * - **Frames**: any delivered sheet in the atlas — every body, every pose,
 *   every facing, with its frames as a strip.
 * - **Effects**: the code-baked effect sheets (`fx/sheets.ts`), at any angle
 *   and frame length.
 */
import { GUARDIAN_ATTACK_RANGE_MULT, GUARDIAN_MUSKET_SPREAD_MULT, MUSKET_RANGE, MUSKET_SPREAD_DEG } from "@jr/core";
import { bakeSheets } from "./fx/sheets.ts";
import type { FxSheet } from "./fx/sheets.ts";
import { drawRig, loadImage, playerRig, wardenRig } from "./lab/rig.ts";
import type { Pose, RenderOptions, Rig } from "./lab/rig.ts";

type Atlas = Record<string, { x: number; y: number; w: number; h: number }>;
type Kind = "rig" | "frames" | "fx";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main(): Promise<void> {
  const [img, json] = await Promise.all([
    loadImage("/sprites.png"),
    fetch("/sprites.json").then((r) => r.json()) as Promise<{ frames: Atlas }>,
  ]);
  const atlas = json.frames;
  const rigs: Rig[] = [await playerRig(img, atlas), wardenRig(img, atlas)];
  const fx: FxSheet[] = bakeSheets({
    blastLen: Math.round(MUSKET_RANGE * GUARDIAN_ATTACK_RANGE_MULT * 2),
    blastSpreadDeg: MUSKET_SPREAD_DEG * GUARDIAN_MUSKET_SPREAD_MULT,
  });
  const fxFrames = new Map(fx.map((s) => [s.name, s.frames.map((f) => {
    const c = document.createElement("canvas");
    c.width = f.w;
    c.height = f.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.w, f.h), 0, 0);
    return c;
  })]));

  /*
   * The atlas's sheets as sequences: `enemy_warden_s_walk2` is frame 2 of
   * `walk` for the warden facing south. Names without a facing are one-off
   * sequences of their own (`enemy_rusher_death`).
   */
  const sheets = new Map<string, Map<string, Map<string, string[]>>>();
  for (const name of Object.keys(atlas).sort()) {
    const m = /^(enemy_[a-z]+|player|pet|boss_p\d)_(?:([nsw])_)?([a-z_]+?)(\d*)$/.exec(name);
    if (!m) continue;
    const [, who, facing = "-", pose] = m;
    const byFacing = sheets.get(who!) ?? new Map();
    const byPose = byFacing.get(facing) ?? new Map();
    byPose.set(pose!, [...(byPose.get(pose!) ?? []), name]);
    byFacing.set(facing, byPose);
    sheets.set(who!, byFacing);
  }
  // The player's swing is one move in four drawings, played in order.
  for (const byPose of sheets.get("player")?.values() ?? []) {
    const swing = ["windup", "strike", "follow", "recover"].flatMap((p) => byPose.get(p) ?? []);
    if (swing.length > 1) byPose.set("swing", swing);
  }

  const state = {
    kind: "rig" as Kind,
    subject: "player",
    move: "walk",
    facing: "s",
    playing: true,
    ms: 0,
    last: performance.now(),
    keys: new Set<string>(),
    x: 0,
    y: 0,
    mirror: false,
    oneShot: null as { move: string; ms: number } | null,
    joints: {} as Record<string, number>,
  };

  const main = $<HTMLCanvasElement>("main");
  const cmp = $<HTMLCanvasElement>("cmp");
  const strip = $<HTMLCanvasElement>("stripCanvas");
  const art = document.createElement("canvas");

  const buttons = (row: HTMLElement, items: readonly string[], current: string, pick: (v: string) => void, label = (v: string) => v) => {
    row.innerHTML = "";
    for (const v of items) {
      const b = document.createElement("button");
      b.textContent = label(v);
      b.setAttribute("aria-pressed", String(v === current));
      b.onclick = () => { pick(v); };
      row.appendChild(b);
    }
  };

  function currentRig(): Rig { return rigs.find((r) => r.name === state.subject) ?? rigs[0]!; }

  function rebuild(): void {
    buttons($("kinds"), ["rig", "frames", "fx"], state.kind, (v) => {
      state.kind = v as Kind;
      state.subject = v === "rig" ? "player" : v === "frames" ? "enemy_warden" : fx[0]!.name;
      state.move = v === "rig" ? "walk" : "";
      state.ms = 0;
      rebuild();
    }, (v) => ({ rig: "skeleton", frames: "frames", fx: "effects" }[v] ?? v));
    const subjects = state.kind === "rig" ? rigs.map((r) => r.name) : state.kind === "frames" ? [...sheets.keys()] : fx.map((s) => s.name);
    const sel = $<HTMLSelectElement>("subject");
    sel.innerHTML = subjects.map((s) => `<option ${s === state.subject ? "selected" : ""}>${s}</option>`).join("");
    sel.onchange = () => { state.subject = sel.value; state.move = ""; state.ms = 0; rebuild(); };

    let moves: string[] = [];
    let facings: string[] = [];
    if (state.kind === "rig") moves = [...currentRig().moves];
    if (state.kind === "frames") {
      const byFacing = sheets.get(state.subject)!;
      facings = [...byFacing.keys()];
      if (!facings.includes(state.facing)) state.facing = facings[0]!;
      moves = [...byFacing.get(state.facing)!.keys()];
    }
    if (moves.length && !moves.includes(state.move)) state.move = moves.includes("walk") ? "walk" : moves[0]!;
    buttons($("moves"), moves, state.move, (v) => { state.move = v; state.ms = 0; rebuild(); });
    buttons($("facing"), facings, state.facing, (v) => { state.facing = v; state.ms = 0; rebuild(); }, (v) => (v === "-" ? "one" : v));
    $("rigopts").style.display = state.kind === "rig" ? "" : "none";
    $("fxopts").style.display = state.kind === "fx" ? "" : "none";

    if (state.kind === "rig") {
      const box = $("jointSliders");
      box.innerHTML = "";
      for (const part of ["pelvis", ...currentRig().parts.map((p) => p.name)]) {
        const row = document.createElement("div");
        row.className = "joint";
        const v = state.joints[`${state.subject}.${part}`] ?? 0;
        row.innerHTML = `<span>${part}</span><input type="range" min="-3.14" max="3.14" step="0.02" value="${v}" /><span>${Math.round((v * 180) / Math.PI)}°</span>`;
        const input = row.querySelector("input")!;
        input.oninput = () => {
          state.joints[`${state.subject}.${part}`] = Number(input.value);
          row.lastElementChild!.textContent = `${Math.round((Number(input.value) * 180) / Math.PI)}°`;
        };
        box.appendChild(row);
      }
    }
  }
  rebuild();

  $("play").onclick = () => { state.playing = !state.playing; $("play").textContent = state.playing ? "pause" : "play"; };
  $("step").onclick = () => { state.playing = false; $("play").textContent = "play"; state.ms += 1000 / Number($<HTMLSelectElement>("fps").value); };
  $("restart").onclick = () => { state.ms = 0; };
  $("zeroJoints").onclick = () => { state.joints = {}; rebuild(); };
  $<HTMLInputElement>("speed").oninput = () => { $("speedv").textContent = `${$<HTMLInputElement>("speed").value}×`; };
  $<HTMLInputElement>("fxAngle").oninput = () => { $("fxAnglev").textContent = `${$<HTMLInputElement>("fxAngle").value}°`; };
  $<HTMLInputElement>("fxMs").oninput = () => { $("fxMsv").textContent = $<HTMLInputElement>("fxMs").value; };

  // Keyboard control of a rig: held keys walk it about, one-shot keys play a move once.
  main.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d"].includes(k)) { state.keys.add(k); e.preventDefault(); }
    const once: Record<string, string> = state.subject === "player" ? { j: "swing", k: "cast", h: "hurt" } : { j: "fire", k: "fire", h: "hit" };
    if (once[k] && state.kind === "rig") state.oneShot = { move: once[k]!, ms: 0 };
  });
  main.addEventListener("keyup", (e) => { state.keys.delete(e.key.toLowerCase()); });
  main.addEventListener("click", () => main.focus());

  function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number): void {
    const bg = $<HTMLSelectElement>("bg").value;
    ctx.imageSmoothingEnabled = false;
    if (bg === "dark") { ctx.fillStyle = "#1f1c30"; ctx.fillRect(0, 0, w, h); return; }
    if (bg === "check") {
      for (let y = 0; y < h; y += 8 * zoom) for (let x = 0; x < w; x += 8 * zoom) {
        ctx.fillStyle = ((x + y) / (8 * zoom)) % 2 ? "#34304a" : "#2a2740";
        ctx.fillRect(x, y, 8 * zoom, 8 * zoom);
      }
      return;
    }
    // The room's stone, roughly: the dungeon floor's blue-violet in 16 px slabs.
    const t = 16 * zoom;
    for (let y = 0; y < h; y += t) for (let x = 0; x < w; x += t) {
      ctx.fillStyle = ((x + y) / t) % 2 ? "#433d6e" : "#3d3866";
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = "#2c2850";
      ctx.fillRect(x, y, t, zoom);
      ctx.fillRect(x, y, zoom, t);
    }
  }

  function frame(now: number): void {
    const dt = Math.min(100, now - state.last) * Number($<HTMLInputElement>("speed").value);
    state.last = now;
    if (state.playing) state.ms += dt;
    const fps = Number($<HTMLSelectElement>("fps").value);
    // Sampled at the chosen rate, as frames played at that rate would be.
    const tick = 1000 / fps;
    const ms = Math.floor(state.ms / tick) * tick;
    const zoom = Number($<HTMLInputElement>("zoom").value);
    const status: string[] = [];

    if (state.kind === "rig") {
      const rig = currentRig();
      const pad = 24;
      const box = rig.size + pad * 2;
      let move = state.move;
      let moveMs = ms % (rig.moveMs[move] ?? 1000);
      // Steering: WASD walks the body round the stage and faces it the way it goes.
      const vx = (state.keys.has("d") ? 1 : 0) - (state.keys.has("a") ? 1 : 0);
      const vy = (state.keys.has("s") ? 1 : 0) - (state.keys.has("w") ? 1 : 0);
      if (vx || vy) {
        move = rig.moves.includes("walk") ? "walk" : move;
        moveMs = ms % (rig.moveMs["walk"] ?? 1000);
        const speed = (rig.name === "player" ? 120 : 46) * (dt / 1000) / 2;
        state.x = Math.max(-pad, Math.min(pad, state.x + vx * speed));
        state.y = Math.max(-pad, Math.min(pad, state.y + vy * speed));
        if (vx) state.mirror = vx > 0;
      }
      if (state.oneShot) {
        state.oneShot.ms += dt;
        const len = rig.moveMs[state.oneShot.move] ?? 800;
        if (state.oneShot.ms >= len) state.oneShot = null;
        else { move = state.oneShot.move; moveMs = Math.floor(state.oneShot.ms / tick) * tick; }
      }
      const pose: Pose = rig.pose(move, moveMs);
      for (const [key, v] of Object.entries(state.joints)) {
        const [who, part] = key.split(".");
        if (who === rig.name && pose[part!]) pose[part!] = { ...pose[part!]!, rot: pose[part!]!.rot + v };
      }
      const opt: RenderOptions = {
        pixel: $<HTMLInputElement>("pixel").checked,
        angleSteps: Number($<HTMLSelectElement>("steps").value),
        snapPosition: $<HTMLInputElement>("snap").checked,
        cleanRotation: $<HTMLInputElement>("clean").checked,
        joints: $<HTMLInputElement>("joints").checked,
        mirror: state.mirror,
      };
      main.width = box * zoom;
      main.height = box * zoom;
      const ctx = main.getContext("2d")!;
      paintBackground(ctx, main.width, main.height, zoom);
      const ox = pad + Math.round(state.x);
      const oy = pad + Math.round(state.y);
      if (opt.pixel) {
        art.width = box;
        art.height = box;
        const a = art.getContext("2d")!;
        a.imageSmoothingEnabled = false;
        a.translate(ox, oy);
        drawRig(a, rig, pose, 1, opt);
        ctx.drawImage(art, 0, 0, box * zoom, box * zoom);
      } else {
        ctx.save();
        ctx.translate(ox * zoom, oy * zoom);
        drawRig(ctx, rig, pose, zoom, opt);
        ctx.restore();
      }
      $("mainCap").textContent = `${rig.name} · ${move} · ${Math.round(moveMs)} ms`;
      // The delivered frames for the same move, alongside.
      const showCmp = $<HTMLInputElement>("compare").checked;
      $("cmpFig").style.display = showCmp ? "" : "none";
      if (showCmp) {
        const name = deliveredFor(rig.name, move, moveMs, (n) => n in atlas);
        const fr = atlas[name];
        cmp.width = box * zoom;
        cmp.height = box * zoom;
        const c = cmp.getContext("2d")!;
        paintBackground(c, cmp.width, cmp.height, zoom);
        if (fr) {
          c.save();
          if (state.mirror) { c.translate(cmp.width, 0); c.scale(-1, 1); }
          c.drawImage(img, fr.x, fr.y, fr.w, fr.h, (state.mirror ? pad - Math.round(state.x) : ox) * zoom, oy * zoom, fr.w * zoom, fr.h * zoom);
          c.restore();
        }
      }
      strip.width = 0;
      status.push(`angle steps ${opt.angleSteps || "none"}, ${opt.snapPosition ? "whole-pixel" : "sub-pixel"} positions, ${opt.cleanRotation ? "clean" : "plain"} rotation, ${fps} fps`);
    } else if (state.kind === "frames") {
      $("cmpFig").style.display = "none";
      const names = sheets.get(state.subject)!.get(state.facing)!.get(state.move) ?? [];
      const per = Math.max(1, tick);
      const i = names.length ? Math.floor(ms / Math.max(per, 1000 / 8)) % names.length : 0;
      const fr = atlas[names[i]!]!;
      main.width = fr.w * zoom + 32;
      main.height = fr.h * zoom + 32;
      const ctx = main.getContext("2d")!;
      paintBackground(ctx, main.width, main.height, zoom);
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 16, 16, fr.w * zoom, fr.h * zoom);
      $("mainCap").textContent = `${names[i]} · frame ${i + 1} of ${names.length}`;
      drawStrip(names.map((n) => atlas[n]!), zoom);
      status.push(`${names.length} frame(s); sequences play at up to 8 fps, as the game's walk cycles run near it`);
    } else {
      $("cmpFig").style.display = "none";
      const frames = fxFrames.get(state.subject)!;
      const sheet = fx.find((s) => s.name === state.subject)!;
      const per = Number($<HTMLInputElement>("fxMs").value);
      const i = Math.floor(ms / per) % frames.length;
      const f = frames[i]!;
      const o = sheet.frameOrigins?.[i] ?? sheet.origin;
      const size = Math.max(...frames.map((c) => Math.max(c.width, c.height))) * 2;
      main.width = size * zoom * 0.5 + 32;
      main.height = size * zoom * 0.5 + 32;
      const ctx = main.getContext("2d")!;
      paintBackground(ctx, main.width, main.height, zoom);
      ctx.save();
      ctx.translate(main.width / 2, main.height / 2);
      ctx.rotate((Number($<HTMLInputElement>("fxAngle").value) * Math.PI) / 180);
      ctx.scale(zoom * 0.5, zoom * 0.5);
      ctx.drawImage(f, -o[0], -o[1]);
      ctx.restore();
      $("mainCap").textContent = `${sheet.name}_${i} · ${f.width}×${f.height} texels`;
      drawStrip(frames.map((c) => ({ canvas: c })), Math.max(2, Math.round(zoom / 2)));
      status.push(`${frames.length} frames, ${per} ms each (drawn at half a world pixel per texel)`);
    }
    $("status").textContent = status.join(" · ");
    requestAnimationFrame(frame);
  }

  /** Every frame of the current sequence side by side, the current one outlined. */
  function drawStrip(frames: readonly ({ x: number; y: number; w: number; h: number } | { canvas: HTMLCanvasElement })[], zoom: number): void {
    const sizes = frames.map((f) => ("canvas" in f ? [f.canvas.width, f.canvas.height] : [f.w, f.h]) as [number, number]);
    const h = Math.max(...sizes.map((s) => s[1])) * zoom + 8;
    strip.width = sizes.reduce((t, s) => t + s[0] * zoom + 8, 8);
    strip.height = h;
    const c = strip.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#1f1c30";
    c.fillRect(0, 0, strip.width, strip.height);
    let x = 8;
    frames.forEach((f, k) => {
      const [w, hh] = sizes[k]!;
      if ("canvas" in f) c.drawImage(f.canvas, x, 4, w * zoom, hh * zoom);
      else c.drawImage(img, f.x, f.y, f.w, f.h, x, 4, w * zoom, hh * zoom);
      x += w * zoom + 8;
    });
  }

  requestAnimationFrame(frame);
}

/** The delivered frame the game would show for a rig's move at this moment. */
function deliveredFor(who: string, move: string, ms: number, atlasHas: (name: string) => boolean): string {
  if (who === "warden") {
    if (move === "walk") return `enemy_warden_s_walk${Math.floor(ms / 125) % 4}`;
    if (move === "idle") return `enemy_warden_s_idle${Math.floor(ms / 400) % 2}`;
    if (move === "hit") return ms < 200 ? "enemy_warden_s_hit0" : ms < 400 ? "enemy_warden_s_hit1" : "enemy_warden_s_idle0";
    return ms < 950 ? "enemy_warden_s_windup" : ms < 2300 ? "enemy_warden_s_lunge" : "enemy_warden_s_idle0";
  }
  if (move === "walk") {
    let n = 0;
    while (atlasHas(`player_s_walk${n}`)) n++;
    return `player_s_walk${Math.floor(ms / (500 / Math.max(1, n))) % Math.max(1, n)}`;
  }
  if (move === "idle") return `player_s_idle${Math.floor(ms / 350) % 4}`;
  if (move === "hurt") return ms < 180 ? "player_s_hurt0" : ms < 360 ? "player_s_hurt1" : "player_s_idle0";
  if (move === "swing") return ms < 200 ? "player_s_windup" : ms < 300 ? "player_s_strike" : ms < 480 ? "player_s_follow" : ms < 600 ? "player_s_recover" : "player_s_idle0";
  return ms < 600 ? "player_s_windup" : "player_s_idle0";
}

void main();
