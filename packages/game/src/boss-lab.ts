/**
 * The boss lab: the debug panel's BOSS tab (doc 020, "Verification").
 *
 * Judging a boss move meant playing sixteen rooms to reach it and then
 * waiting for the rotation to come round to the one being looked at. The lab
 * is the real game — the same simulation, renderer, effects and sounds — with
 * the run skipped and the boss on a lead: its own decisions can be held one
 * kind at a time, any move or blade is thrown on demand (still on its beat),
 * the phase is set by hand, and the fight runs slowed, paused or a frame at a
 * time. `?lab=boss` opens the game straight into it.
 *
 * DOM, built once, like the rest of the panel's controls. The beat strip is
 * the one part updated every frame (`frame`), because the panel's readout
 * refreshes four times a second and a beat is a third of one.
 */

import { BAR_MS, BEAT_MS } from "@jr/core";
import type { MeleeKind } from "@jr/core";

/** Which of the boss's own decisions are held (`World.bossHold`). */
export interface BossHold {
  moves: boolean;
  blades: boolean;
  volleys: boolean;
}

/** What the strip shows: read off the boss each frame. */
export interface BossLabFrame {
  readonly fightMs: number;
  readonly phase: number;
  readonly hpFraction: number;
  /** The move in hand and its time to commit, or none. */
  readonly cast: string;
  readonly commitInMs: number | null;
  /** The move queued on the grid and its time to start. */
  readonly next: string;
  readonly startInMs: number | null;
  /** The blade: its state, its kind, and the time to its commit while it winds up. */
  readonly attack: string;
  readonly blade: string | null;
  readonly bladeInMs: number | null;
}

export interface BossLabActions {
  /** Into the boss room, straight from wherever the run is, with the boss held. */
  readonly enter: () => void;
  readonly setPhase: (phase: 1 | 2 | 3) => void;
  readonly hold: () => BossHold;
  readonly setHold: (hold: BossHold) => void;
  /** Queue a move on its beat; false when the boss is busy. */
  readonly move: (name: string) => boolean;
  /** Wind up a blade at the player now; false when the boss is busy. */
  readonly blade: (kind: MeleeKind) => boolean;
  /** The fight's speed: 1, ½, ¼, or 0 for paused. */
  readonly speed: () => number;
  readonly setSpeed: (speed: number) => void;
  /** One sim step, while paused. */
  readonly stepFrame: () => void;
  readonly metronome: () => boolean;
  readonly setMetronome: (on: boolean) => void;
  /** Removes every body but the boss. */
  readonly clearAdds: () => void;
}

/** The moves, in the order the panel offers them. */
const MOVES = ["slam", "quake", "leap", "hook", "storm"] as const;
/**
 * The blades the boss can be asked for: what its phases choose, and the
 * backhand — and the greatcleave, which he never chooses (it read strangely
 * in play) and is kept here only to be looked at for its rework.
 */
const BLADES: readonly MeleeKind[] = ["greatslash", "greatsweep", "dashcut", "maul", "greatcleave"];
const SPEEDS: readonly [number, string][] = [[1, "1×"], [0.5, "½×"], [0.25, "¼×"], [0, "pause"]];

const BTN = "background:#221d46;color:#c9cfe8;border:1px solid #2a2750;font:inherit;padding:1px 6px;margin:0 3px 3px 0;cursor:pointer;border-radius:2px";
const HEAD = "font-size:13px;margin:14px 0 4px;color:#ffe9a8;border-bottom:1px solid #2a2750;padding-bottom:2px";
const NOTE = "color:#5a5f7a";

export class BossLabPanel {
  readonly root: HTMLElement;
  private readonly beatCells: HTMLElement[] = [];
  private readonly status: HTMLElement;
  private readonly say: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];

  constructor(private readonly actions: BossLabActions) {
    this.root = document.createElement("div");
    const r = this.root;
    r.innerHTML =
      `<h2 style="${HEAD}">boss lab</h2>`
      + `<div><button data-enter style="${BTN}">enter boss room</button>`
      + `<button data-clear style="${BTN}">clear adds</button></div>`
      + `<div style="${NOTE}">the real fight, the run skipped; the player is made invincible. <b>?lab=boss</b> opens here.</div>`
      + `<h2 style="${HEAD}">beat</h2>`
      + `<div data-beats style="display:flex;gap:3px;margin:2px 0 4px"></div>`
      + `<div data-status style="white-space:pre;color:#c9cfe8;min-height:5.8em"></div>`
      + `<h2 style="${HEAD}">speed</h2>`
      + `<div data-speeds></div>`
      + `<div><button data-step style="${BTN}">step 1 frame</button>`
      + `<label style="cursor:pointer;margin-left:6px"><input type="checkbox" data-metro> metronome</label></div>`
      + `<div style="${NOTE}">the music mutes off 1× (it cannot slow); the metronome ticks on the fight's clock</div>`
      + `<h2 style="${HEAD}">phase</h2>`
      + `<div>${[1, 2, 3].map((p) => `<button data-phase="${p}" style="${BTN}">${["I", "II", "III"][p - 1]}</button>`).join("")}</div>`
      + `<div style="${NOTE}">sets health just inside the phase; the change plays as in a fight. Also restarts the fight clock</div>`
      + `<h2 style="${HEAD}">hold the boss's own</h2>`
      + `<div>${(["moves", "blades", "volleys"] as const).map((k) =>
        `<label style="cursor:pointer;margin-right:8px"><input type="checkbox" data-hold="${k}"> ${k}</label>`).join("")}</div>`
      + `<div style="${NOTE}">unticked, he fights as in a run; ticked, he does not start that kind himself — the buttons below still do</div>`
      + `<h2 style="${HEAD}">moves</h2>`
      + `<div>${MOVES.map((m) => `<button data-move="${m}" style="${BTN}">${m}</button>`).join("")}</div>`
      + `<h2 style="${HEAD}">blades</h2>`
      + `<div>${BLADES.map((b) => `<button data-blade="${b}" style="${BTN}">${b}</button>`).join("")}</div>`
      + `<div style="${NOTE}">strings from phase II: greatslash is x--x----X (III: x--x--x-----X); sweep and dashcut are followed too; greatcleave is lab-only, not in his turns</div>`
      + `<div data-say style="${NOTE};min-height:1.4em"></div>`
      + `<div style="${NOTE}">a move is queued to commit on its line — the ground strikes on a downbeat, the rest on a beat</div>`;

    const beats = r.querySelector<HTMLElement>("[data-beats]")!;
    for (let i = 0; i < 4; i++) {
      const c = document.createElement("div");
      Object.assign(c.style, {
        flex: "1 1 0", height: "16px", border: "1px solid #2a2750", borderRadius: "2px",
        textAlign: "center", fontSize: "10px", lineHeight: "16px", color: "#5a5f7a",
      } as Partial<CSSStyleDeclaration>);
      c.textContent = String(i + 1);
      beats.appendChild(c);
      this.beatCells.push(c);
    }
    this.status = r.querySelector<HTMLElement>("[data-status]")!;
    this.say = r.querySelector<HTMLElement>("[data-say]")!;

    const speeds = r.querySelector<HTMLElement>("[data-speeds]")!;
    for (const [value, label] of SPEEDS) {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("style", BTN);
      b.addEventListener("click", () => { this.actions.setSpeed(value); this.paintSpeed(); });
      speeds.appendChild(b);
      this.speedButtons.push(b);
    }
    this.paintSpeed();

    r.querySelector("[data-enter]")!.addEventListener("click", () => { this.actions.enter(); this.syncHold(); });
    r.querySelector("[data-clear]")!.addEventListener("click", () => this.actions.clearAdds());
    r.querySelector("[data-step]")!.addEventListener("click", () => { this.actions.stepFrame(); this.paintSpeed(); });
    const metro = r.querySelector<HTMLInputElement>("[data-metro]")!;
    metro.checked = this.actions.metronome();
    metro.addEventListener("change", () => this.actions.setMetronome(metro.checked));
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-phase]")))
      b.addEventListener("click", () => this.actions.setPhase(Number(b.dataset.phase) as 1 | 2 | 3));
    for (const box of Array.from(r.querySelectorAll<HTMLInputElement>("[data-hold]")))
      box.addEventListener("change", () => {
        this.actions.setHold({ ...this.actions.hold(), [box.dataset.hold!]: box.checked });
      });
    this.syncHold();
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-move]")))
      b.addEventListener("click", () => this.report(b.dataset.move!, this.actions.move(b.dataset.move!)));
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>("[data-blade]")))
      b.addEventListener("click", () => this.report(b.dataset.blade!, this.actions.blade(b.dataset.blade as MeleeKind)));
  }

  /** The checkboxes, from the world: entering the room sets them. */
  syncHold(): void {
    const hold = this.actions.hold();
    for (const box of Array.from(this.root.querySelectorAll<HTMLInputElement>("[data-hold]")))
      box.checked = hold[box.dataset.hold as keyof BossHold];
  }

  private paintSpeed(): void {
    const now = this.actions.speed();
    SPEEDS.forEach(([value], i) => {
      const b = this.speedButtons[i]!;
      b.style.color = value === now ? "#ffe9a8" : "#c9cfe8";
      b.style.borderColor = value === now ? "#ffe9a8" : "#2a2750";
    });
  }

  private report(what: string, ok: boolean): void {
    this.say.textContent = ok ? `${what}: queued` : `${what}: busy (a move, a blade or a phase change in hand) or no boss`;
  }

  /** Every frame while the tab is on screen: the beat strip and the boss's timers. */
  frame(f: BossLabFrame | null): void {
    if (!f) {
      for (const c of this.beatCells) { c.style.background = "transparent"; c.style.color = "#5a5f7a"; }
      this.status.textContent = "no boss in this room — enter boss room";
      return;
    }
    const inBar = ((f.fightMs % BAR_MS) + BAR_MS) % BAR_MS;
    const beat = Math.min(3, Math.floor(inBar / BEAT_MS));
    // The lit cell fades across its beat, so the strip reads as a pulse rather than a counter.
    const through = (inBar - beat * BEAT_MS) / BEAT_MS;
    this.beatCells.forEach((c, i) => {
      const on = i === beat;
      const down = i === 0;
      const a = on ? 1 - through * 0.7 : 0;
      c.style.background = on ? (down ? `rgba(255,120,80,${a})` : `rgba(255,233,168,${a})`) : "transparent";
      c.style.color = on ? "#0d0b1f" : "#5a5f7a";
    });
    const ms = (v: number | null): string => (v === null ? "" : ` in ${Math.round(v)} ms (${(v / BEAT_MS).toFixed(2)} beats)`);
    const bar = Math.floor(f.fightMs / BAR_MS) + 1;
    this.status.textContent = [
      `bar ${bar} beat ${beat + 1}   clock ${(f.fightMs / 1000).toFixed(2)} s`,
      `phase ${f.phase}   health ${(f.hpFraction * 100).toFixed(1)}%`,
      `cast   ${f.cast}${f.commitInMs !== null ? ` commit${ms(f.commitInMs)}` : ""}`,
      `queued ${f.next}${f.startInMs !== null ? ` start${ms(f.startInMs)}` : ""}`,
      `blade  ${f.attack}${f.blade ? ` ${f.blade}` : ""}${f.bladeInMs !== null ? ` commit${ms(f.bladeInMs)}` : ""}`,
    ].join("\n");
  }
}
