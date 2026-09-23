/**
 * The debug sidebar: what the Director decided about this room, in DOM.
 *
 * The generation pipeline — space archetype, mood, zone features, encounter
 * profile, pressure band, wave plan, elite affixes, the tension the doors set
 * — was entirely invisible from inside the game. A room looked like a room,
 * and whether it was the product of a decision or a coin toss could not be
 * told from the floor. This panel is the honest answer to "I cannot feel the
 * generator": it prints the plan next to the room it produced, with the
 * *source* of every decision, so a fight can be read against what was asked
 * for.
 *
 * DOM rather than canvas because it is a developer's readout, not part of the
 * game: it wants selectable text, a scrollbar, and to cost the renderer
 * nothing. It also hosts the loadout — the three spells, their costs, what is
 * attached to them, and buttons to reorder the keys — because until there is
 * an in-game staff screen this is the only place the player can see the
 * whole of what they are holding.
 *
 * Toggled with the backquote key or the button in the corner. Hidden by
 * default, so a player who never asks for it never sees it.
 */

import { ENEMY_IDS } from "@jr/core";
import { groupByCategory } from "./director-readout.ts";
import type { ReadoutRequest } from "./director-readout.ts";

export interface DebugSnapshot {
  /** The run's seed, so a room can be reproduced or shared. */
  readonly seed: string;
  readonly room: {
    readonly index: number;
    readonly stage: string;
    readonly type: string;
    readonly elite: boolean;
    readonly tension: string;
    readonly space: string;
    readonly symmetry: string;
    readonly mood: string;
    readonly measured: Readonly<Record<string, number>>;
    readonly zones: readonly { readonly id: string; readonly feature: string }[];
    readonly sources: Readonly<Record<string, string>>;
    readonly trimmed: boolean;
  };
  readonly encounter: {
    readonly profile: Readonly<Record<string, string | number>>;
    readonly band: readonly [number, number];
    readonly pressure: number;
    readonly source: string;
    readonly affixes: readonly string[];
    readonly roster: number;
    readonly waves: readonly { readonly atMs: number; readonly spawns: string }[];
  } | null;
  readonly doors: {
    readonly tension: string;
    readonly sources: Readonly<Record<string, string>>;
  } | null;
  /** What clearing this room pays, and where its portals lead. */
  readonly reward: {
    readonly kind: string;
    readonly cards: readonly { readonly kind: string; readonly label: string; readonly stats: string; readonly origin?: string }[];
    readonly cardsBy: string;
    readonly portalsBy: string;
    readonly portals: readonly { readonly reward: string; readonly elite: boolean; readonly type: string; readonly promise?: string }[];
  } | null;
  readonly player: {
    readonly hearts: number;
    readonly maxHealth: number;
    readonly mana: number;
    readonly manaMax: number;
    readonly gold: number;
    readonly mods: Readonly<Record<string, number>>;
  };
  readonly spells: readonly {
    readonly key: string;
    readonly name: string | null;
    readonly cost: number | null;
    readonly cooldownMs: number;
    readonly affixes: readonly string[];
  }[];
  readonly enemies: {
    readonly alive: number;
    readonly pending: number;
    readonly byArchetype: Readonly<Record<string, number>>;
  };
  readonly history: {
    readonly rooms: readonly string[];
    readonly tensions: readonly string[];
  };
  /** Every Director request for this room: its state and every question, all options. */
  readonly director: readonly ReadoutRequest[];
}

export interface DebugActions {
  /** Swap the spells on two keys. */
  readonly swapSpells: (a: number, b: number) => void;
  /** Put one body of this kind in front of the player, an elite if asked. */
  readonly spawnEnemy: (id: string, elite: boolean) => void;
}

/** What the spawn row can put in the room. */
const SPAWNABLE: readonly string[] = [...ENEMY_IDS, "boss"];

const PANEL_ID = "jr-debug";
const BUTTON_ID = "jr-debug-toggle";
/** Whether the panel was open last time; a developer's convenience, per browser. */
const OPEN_KEY = "jr-debug-open";

export class DebugPanel {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private open = false;
  private last: DebugSnapshot | null = null;
  /**
   * The readout, one element per heading, patched **per section**: a section
   * whose HTML did not change is not touched, so a selection in it survives
   * and the browser does no work for it. The whole panel used to be one
   * `innerHTML` write, which rebuilt every node whenever anything moved —
   * and something always moves during a fight, so the select in the spawn
   * row reset under the pointer. The controls now live outside the readout
   * altogether (`controls`, built once) and are never rewritten.
   */
  private readonly readout: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly sections = new Map<string, { el: HTMLElement; html: string }>();
  /** The kind picked in the spawn row. */
  private spawnPick: string = SPAWNABLE[0]!;

  constructor(private readonly actions: DebugActions) {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
    document.getElementById(BUTTON_ID)?.remove();

    this.root = document.createElement("aside");
    this.root.id = PANEL_ID;
    Object.assign(this.root.style, {
      position: "fixed", top: "0", right: "0", bottom: "0", width: "340px",
      overflowY: "auto", background: "rgba(13, 11, 31, 0.94)", color: "#c9cfe8",
      fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", lineHeight: "1.45",
      padding: "12px 14px 24px", boxSizing: "border-box", borderLeft: "1px solid #2a2750",
      display: "none", zIndex: "20",
    } as Partial<CSSStyleDeclaration>);
    this.readout = document.createElement("div");
    this.controls = document.createElement("div");
    this.root.appendChild(this.readout);
    this.root.appendChild(this.controls);
    this.buildControls();
    document.body.appendChild(this.root);

    this.button = document.createElement("button");
    this.button.id = BUTTON_ID;
    this.button.textContent = "debug `";
    Object.assign(this.button.style, {
      position: "fixed", top: "8px", right: "8px", zIndex: "21",
      background: "#161334", color: "#8792b5", border: "1px solid #2a2750",
      fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px",
      padding: "3px 8px", cursor: "pointer", borderRadius: "3px",
    } as Partial<CSSStyleDeclaration>);
    this.button.addEventListener("click", () => this.toggle());
    document.body.appendChild(this.button);

    let remembered = false;
    try { remembered = localStorage.getItem(OPEN_KEY) === "1"; } catch { /* private window, or blocked */ }
    if (remembered) this.toggle();
  }

  /** The spawn row: built once, wired once, never rerendered. */
  private buildControls(): void {
    this.controls.innerHTML = h2("spawn")
      + `<div style="margin:2px 0"><select data-spawn-pick style="${BTN};margin-left:0">`
      + SPAWNABLE.map((id) => `<option value="${id}">${id}</option>`).join("")
      + `</select><button data-spawn="0" style="${BTN}">spawn</button><button data-spawn="1" style="${BTN}">spawn elite</button>`
      + `<div style="color:#5a5f7a">appears a few tiles ahead of the player, awake</div></div>`;
    const pick = this.controls.querySelector<HTMLSelectElement>("select[data-spawn-pick]");
    pick?.addEventListener("change", () => { this.spawnPick = pick.value; });
    for (const btn of Array.from(this.controls.querySelectorAll<HTMLButtonElement>("button[data-spawn]")))
      btn.addEventListener("click", () => this.actions.spawnEnemy(this.spawnPick, btn.dataset.spawn === "1"));
  }

  toggle(): void {
    this.open = !this.open;
    this.root.style.display = this.open ? "block" : "none";
    this.button.style.right = this.open ? "352px" : "8px";
    try { localStorage.setItem(OPEN_KEY, this.open ? "1" : "0"); } catch { /* not available: the panel still works */ }
    if (this.open && this.last) this.render(this.last);
  }

  isOpen(): boolean {
    return this.open;
  }

  render(snap: DebugSnapshot): void {
    this.last = snap;
    if (!this.open) return;
    const r = snap.room;
    const e = snap.encounter;
    const parts: string[] = [];

    parts.push(h2(`room ${r.index}  ${r.type}${r.elite ? "  ELITE" : ""}`));
    parts.push(kv([
      ["seed", `${snap.seed}  (?seed=… in the URL replays it)`],
      ["stage", r.stage], ["tension", r.tension],
      ["space", r.space], ["symmetry", r.symmetry], ["mood", r.mood],
      ["trimmed", r.trimmed ? "yes (commit check cut the plan)" : "no"],
    ]));
    parts.push(h3("decision sources"));
    parts.push(kv(Object.entries(r.sources)));
    parts.push(h3("measured"));
    parts.push(kv(Object.entries(r.measured).map(([k, v]) => [k, fmt(v)])));
    parts.push(h3(`zones (${r.zones.length})`));
    parts.push(r.zones.length
      ? list(r.zones.map((z) => `${esc(z.id)}: ${z.feature === "none" ? dim("none") : esc(z.feature)}`))
      : dim("no zone slots in this archetype"));

    parts.push(h2("encounter"));
    if (!e) parts.push(dim("none: the merchant and the boss are placed, not assembled"));
    else {
      parts.push(kv([
        ...Object.entries(e.profile).map(([k, v]) => [k, String(v)] as [string, string]),
        ["band", `${e.band[0]} .. ${e.band[1]}`],
        ["pressure", fmt(e.pressure)],
        ["roster", String(e.roster)],
        ["source", e.source],
        ["elite affixes", e.affixes.length ? e.affixes.join(", ") : dim("none")],
      ]));
      parts.push(h3(`waves (${e.waves.length})`));
      parts.push(list(e.waves.map((w) => `t+${(w.atMs / 1000).toFixed(1)}s  ${esc(w.spawns)}`)));
    }

    parts.push(h2("live"));
    parts.push(kv([
      ["enemies alive", String(snap.enemies.alive)],
      ["waves pending", String(snap.enemies.pending)],
      ...Object.entries(snap.enemies.byArchetype).map(([k, v]) => [`  ${k}`, String(v)] as [string, string]),
    ]));

    parts.push(h2("player"));
    parts.push(kv([
      // Health in the bar's units, as the HUD shows it: a heart is ten.
      ["health", `${Math.round(snap.player.hearts * 10)} / ${snap.player.maxHealth}`],
      ["mana", `${fmt(snap.player.mana)} / ${snap.player.manaMax}`],
      ["gold", String(snap.player.gold)],
      ...Object.entries(snap.player.mods)
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => [`  mod ${k}`, fmt(v)] as [string, string]),
    ]));

    parts.push(h2("spells"));
    parts.push(snap.spells.map((s, i) => {
      const name = s.name ? esc(s.name) : dim("empty");
      const cost = s.cost === null ? "" : `  ${fmt(s.cost)} mana`;
      const cd = s.cooldownMs > 0 ? `  cd ${Math.ceil(s.cooldownMs)}ms` : "";
      const affixes = s.affixes.length ? `<div style="color:#8792b5;padding-left:26px">${s.affixes.map(esc).join(", ")}</div>` : "";
      const up = i > 0 ? `<button data-swap="${i - 1},${i}" style="${BTN}">↑</button>` : "";
      const down = i < snap.spells.length - 1 ? `<button data-swap="${i},${i + 1}" style="${BTN}">↓</button>` : "";
      return `<div style="margin:2px 0"><b style="color:#ffe9a8">${esc(s.key)}</b> ${name}<span style="color:#8792b5">${cost}${cd}</span> ${up}${down}${affixes}</div>`;
    }).join(""));

    if (snap.reward) {
      parts.push(h2("reward"));
      parts.push(kv([
        // Who decides: the Director's planCards and planPortals, over the legal
        // answers code enumerated; the rule code only if the Director failed.
        ["cards decided by", snap.reward.cardsBy],
        ["portals decided by", snap.reward.portalsBy],
        ["kind", snap.reward.kind],
        ...snap.reward.cards.map((c, i) => [`card ${i + 1}`, `${c.kind}: ${c.label}  (${c.stats})${c.origin ? `  · ${c.origin}` : ""}`] as [string, string]),
        ...snap.reward.portals.map((p, i) => [`portal ${i + 1}`, `${p.reward}${p.promise ? ` (${p.promise})` : ""}${p.elite ? "  ELITE" : ""}  → ${p.type}`] as [string, string]),
      ]));
    }

    if (snap.doors) {
      parts.push(h2("tension"));
      parts.push(kv([
        ["tension set", snap.doors.tension],
        ...Object.entries(snap.doors.sources),
      ]));
    }

    /*
     * **Every Director parameter**: what each request was sent, and every
     * question it held with all its options — the answer drawn in gold, the
     * arm that answered beside it.
     */
    parts.push(h2(`director inputs (${snap.director.length} requests)`));
    if (snap.director.length === 0) parts.push(dim("no requests: this room was placed, not planned"));
    for (const req of snap.director) {
      parts.push(h3(`${req.title} · ${req.source}${req.fallback ? ` (fell back: ${req.fallback})` : ""}`));
      parts.push(kv(req.state.map(([k, v]) => [k, v] as [string, string])));
    }
    parts.push(h2("director questions"));
    if (snap.director.length === 0) parts.push(dim("none"));
    // By subject, not by request: one request carries a room's space, mood,
    // portals and cards together.
    for (const group of groupByCategory(snap.director)) {
      parts.push(h3(group.category));
      parts.push(group.questions.map((q) => {
        const opts = q.probs.map(([k, p]) => {
          const pct = `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
          return k === q.choice
            ? `<b style="color:#ffe9a8">${esc(k)} ${pct}</b>`
            : `<span style="color:#8792b5">${esc(k)} ${pct}</span>`;
        }).join(" · ");
        const head = `<b style="color:#c9cfe8">${esc(q.name)}</b>`
          + ` <span style="color:${q.source === "jev" ? "#8fdcff" : "#5a5f7a"}">${esc(q.source)}</span>`
          + (q.choice ? ` → <b style="color:#ffe9a8">${esc(q.choice)}</b>` : "")
          + (q.note ? ` <span style="color:#5a5f7a">(${esc(q.note)})</span>` : "")
          + ` <span style="color:#5a5f7a;font-size:10px">· ${esc(q.request)}</span>`;
        return `<div style="margin:3px 0">${head}<div style="padding-left:10px;font-size:11px">${opts || dim("no options")}</div></div>`;
      }).join(""));
    }

    parts.push(h2("history"));
    parts.push(kv([
      ["rooms", snap.history.rooms.join(" › ") || dim("—")],
      ["tensions", snap.history.tensions.join(" › ") || dim("—")],
    ]));

    this.patch(groupByHeading(parts));
  }

  /**
   * Writes each section only if its HTML changed, and never over a selection
   * inside it. Sections are keyed by their heading, kept in the order given,
   * and moved rather than rebuilt when the order changes.
   */
  private patch(sections: readonly (readonly [string, string])[]): void {
    const sel = document.getSelection();
    const seen = new Set<string>();
    sections.forEach(([key, html], i) => {
      seen.add(key);
      let s = this.sections.get(key);
      if (!s) {
        const el = document.createElement("section");
        el.dataset.key = key;
        s = { el, html: "" };
        this.sections.set(key, s);
      }
      if (this.readout.children[i] !== s.el) this.readout.insertBefore(s.el, this.readout.children[i] ?? null);
      if (s.html === html) return;
      if (sel && !sel.isCollapsed && sel.anchorNode && s.el.contains(sel.anchorNode)) return;
      s.html = html;
      s.el.innerHTML = html;
      for (const btn of Array.from(s.el.querySelectorAll<HTMLButtonElement>("button[data-swap]"))) {
        btn.addEventListener("click", () => {
          const [a, b] = (btn.dataset.swap ?? "0,0").split(",").map(Number);
          this.actions.swapSpells(a ?? 0, b ?? 0);
        });
      }
    });
    for (const [key, s] of this.sections)
      if (!seen.has(key)) { s.el.remove(); this.sections.delete(key); }
  }
}

/** Splits the flat part list into sections, one per `h2`, keyed by the heading text. */
function groupByHeading(parts: readonly string[]): (readonly [string, string])[] {
  const out: [string, string][] = [];
  for (const part of parts) {
    if (part.startsWith("<h2")) {
      const key = part.replace(/<[^>]+>/g, "").trim() || `section ${out.length}`;
      out.push([key, part]);
    } else if (out.length === 0) out.push(["", part]);
    else out[out.length - 1]![1] += part;
  }
  return out;
}

const BTN = "background:#221d46;color:#c9cfe8;border:1px solid #2a2750;font:inherit;padding:0 5px;margin-left:3px;cursor:pointer;border-radius:2px";

function h2(text: string): string {
  return `<h2 style="font-size:13px;margin:14px 0 4px;color:#ffe9a8;border-bottom:1px solid #2a2750;padding-bottom:2px">${esc(text)}</h2>`;
}
function h3(text: string): string {
  return `<h3 style="font-size:11px;margin:8px 0 2px;color:#8792b5;text-transform:uppercase;letter-spacing:0.05em">${esc(text)}</h3>`;
}
function kv(rows: readonly (readonly [string, string])[]): string {
  return `<table style="border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><td style="color:#8792b5;padding:0 10px 0 0;vertical-align:top;white-space:nowrap">${esc(k)}</td><td>${v.startsWith("<") ? v : esc(v)}</td></tr>`).join("")}</table>`;
}
/** Items are HTML the caller has already escaped. */
function list(items: readonly string[]): string {
  return `<div>${items.map((i) => `<div>· ${i}</div>`).join("")}</div>`;
}
function dim(text: string): string {
  return `<span style="color:#5a5f7a">${esc(text)}</span>`;
}
function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}
