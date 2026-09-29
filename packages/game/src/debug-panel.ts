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

import { ENEMY_IDS, RoomWatch } from "@jr/core";
import type { RoomBalance, World } from "@jr/core";
import { BossLabPanel } from "./boss-lab.ts";
import type { BossLabActions, BossLabFrame } from "./boss-lab.ts";
import { SpellLabPanel } from "./spell-lab.ts";
import type { SpellLabActions } from "./spell-lab.ts";
import { groupRequest } from "./director-readout.ts";
import type { ReadoutRequest } from "./director-readout.ts";

/* ------------------------------------------------------------------------ *
 * The playtest log (design doc 011, "Calibration against real play").
 * ------------------------------------------------------------------------ */

/**
 * What a real session costs, per room, in the same shape the harness writes.
 *
 * The harness reports balance bands measured against a model player, and that
 * model is far stronger than anybody: it cleared the first room in five seconds
 * for nothing where a person took two minutes and a third of their health. The
 * only way to close that gap is to have both play the same rooms and write the
 * same kind of record, which is what this is — the browser's half of it.
 *
 * The contract is `packages/harness/src/play/playtest-log.ts`, and it is a
 * plain JSON shape rather than an import because the game does not depend on
 * the harness and should not start: the harness is a development tool, and
 * nothing in it belongs in the bundle a player downloads.
 *
 * Nothing here re-derives what the simulation knows. The HP and the cause
 * strings are exactly what `player_hit` publishes, the kills are
 * `enemy_killed`, and the rest is counted off the player's own state.
 */
export interface PlaytestRoom {
  index: number;
  /** `combat`, `elite`, `boss`, `shop`. */
  type: string;
  ms: number;
  hpLost: number;
  /** HP lost keyed by the sim's own cause strings: `melee:tank`, `bullet:shooter`, … */
  bySource: Record<string, number>;
  kills: number;
  /** The body's level at the end of the room (`run/levels.ts`). */
  level: number;
  dashes: number;
  casts: number;
  swings: number;
  /** How long an enemy bullet was within `NEAR_BULLET_PX`. */
  nearMs: number;
  /**
   * The mana economy, as the player met it (doc 011): presses of a key holding
   * a spell, how many the bar refused for cost, and how long the bar spent
   * under the cheapest key's cost. Read straight off `WorldStats`, so the
   * browser reports what the harness reports.
   */
  castPresses: number;
  castRefusedMana: number;
  manaShortMs: number;
  /**
   * The auto-cast mode the room was fought in (`space` or `auto`; absent
   * for `off`), and how many of `castPresses` were the assist's pick — a
   * Space press, or the assist's own beat. Without them a log could not say
   * whether a room's casts were chosen key by key.
   */
  autoCast?: string;
  autoCasts?: number;
  /**
   * **What the Director decided for this room, every answer of it**: the
   * room's own questions, the doors out and what each promised, the cards
   * offered and the one taken. Without these the log said how a room went
   * and nothing about why it was that room — whether Jev or the rule table
   * chose it, over which options, how sure it was.
   */
  decisions?: PlaytestDecision[];
  /** The doors out of this room: `spell:storm`, `stat:mana`, `npc:fountain`, `gold`. */
  doors?: string[];
  /** Each card offer: its kind (or shelf) and the card ids shown. */
  offers?: { label: string; ids: readonly string[] }[];
  /** The card taken, if one was. */
  picked?: string;
  /*
   * **What balance is read from** (doc 011). Each is a few numbers a room —
   * never an event list — and none is written to storage (`flush`): they
   * live for the session and leave with the export.
   */
  /** What `RoomWatch` read off the room (`sim/room-watch.ts`), the harness's rooms carrying the same. */
  build?: RoomBalance["build"];
  hp?: RoomBalance["hp"];
  dealtBy?: RoomBalance["dealtBy"];
  castsBy?: RoomBalance["castsBy"];
  manaBy?: RoomBalance["manaBy"];
  killTime?: RoomBalance["killTime"];
  statuses?: RoomBalance["statuses"];
}

/** The fields that stay in memory only: `flush` writes a room to storage without them. */
const SESSION_ONLY = ["build", "hp", "dealtBy", "castsBy", "manaBy", "killTime", "statuses"] as const;
const lean = (r: PlaytestRoom): PlaytestRoom => {
  const out = { ...r };
  for (const k of SESSION_ONLY) delete out[k];
  return out;
};


/**
 * One Director answer, as the log keeps it. `purpose` is the request it came
 * in (`room`, `offer`, `doors`); `p` its distribution to two places, options
 * at nothing left out; `fallback` how it reached the rule table if it did.
 */
export interface PlaytestDecision {
  purpose: string;
  question: string;
  choice: string;
  source: string;
  confidence?: number;
  fallback?: string;
  p: Record<string, number>;
}

/** The shape of a Director decision this log reads, without a dependency on the director package. */
interface DecisionLike {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number | null;
  readonly source: string;
  readonly fallback_path?: unknown;
  readonly question?: string;
}

/** A Director plan's decisions as the log keeps them. */
export function logDecisions(purpose: string, decisions: readonly DecisionLike[]): PlaytestDecision[] {
  return decisions.map((d) => {
    const p: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.probabilities)) if (v >= 0.005) p[k] = Math.round(v * 100) / 100;
    return {
      purpose, question: d.question ?? "?", choice: d.choice, source: d.source, p,
      ...(d.confidence !== null ? { confidence: Math.round(d.confidence * 100) / 100 } : {}),
      ...(d.fallback_path ? { fallback: String(d.fallback_path) } : {}),
    };
  });
}

/** A heart is ten HP, as the HUD draws it, and as a person reports it. */
const HP_PER_HEART = 10;
/** How near an enemy bullet has to be to count as pressure. Matches the harness. */
const NEAR_BULLET_PX = 90;
/** Where the log lives between sessions. One key, one browser. */
const LOG_KEY = "jr-playtest-log";
/** The run the log is of: which Director, and the style and words the player gave it. */
const META_KEY = "jr-playtest-run";
/**
 * How many rooms are kept: a safety net only. The log is cleared at the start
 * of every run (`startRun`), so it is one run, at most sixteen rooms and a
 * few retries of the boss; it used to keep several runs back to back, which
 * a log that now carries every Director answer cannot afford.
 */
const LOG_LIMIT = 40;

/** Who planned the run the log is of. */
export interface PlaytestRun {
  director: string;
  style: string;
  words?: string;
}

export class PlaytestRecorder {
  private rooms: PlaytestRoom[] = [];
  private live: PlaytestRoom | null = null;
  private run: PlaytestRun | null = null;
  /** Additions for a room not begun yet: its doors' pacing is decided while leaving the room before. */
  private pending = new Map<number, ((r: PlaytestRoom) => void)[]>();
  private seed = "";
  /** The player state this recorder last saw, for counting the starts of things. */
  private was = { swingMs: 0, dashMs: 0, shotsFired: 0 };
  /** The room in progress's balance watch (`RoomWatch`), closed into its record by `flush`. */
  private watch = new RoomWatch();

  constructor() {
    try {
      const saved = localStorage.getItem(LOG_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) this.rooms = parsed as PlaytestRoom[];
        const run = localStorage.getItem(META_KEY);
        if (run) this.run = JSON.parse(run) as PlaytestRun;
      }
    } catch { /* private window, blocked, or a log from an older shape */ }
  }

  /** A new room starts, which also closes the one before it. */
  begin(seed: string, index: number, type: string): void {
    this.flush();
    this.seed = seed;
    this.live = {
      index, type, ms: 0, hpLost: 0, bySource: {}, kills: 0, level: 1,
      dashes: 0, casts: 0, swings: 0, nearMs: 0,
      castPresses: 0, castRefusedMana: 0, manaShortMs: 0,
    };
    this.was = { swingMs: 0, dashMs: 0, shotsFired: 0 };
    this.watch = new RoomWatch();
    for (const add of this.pending.get(index) ?? []) add(this.live);
    this.pending.clear();
  }

  /** A new run: the log starts over, headed by who plans it. */
  startRun(run: PlaytestRun): void {
    this.clear();
    this.run = run;
    try { localStorage.setItem(META_KEY, JSON.stringify(run)); } catch { /* the session still records */ }
  }

  /** Adds to room `index`'s record: now if it is the room being played, else when it begins. */
  attach(index: number, add: (r: PlaytestRoom) => void): void {
    if (this.live && this.live.index === index) { add(this.live); return; }
    this.pending.set(index, [...(this.pending.get(index) ?? []), add]);
  }

  /** The auto-cast assist, in `mode`, was asked for a key on this step, and gave one if `cast`. */
  autoCast(mode: string, cast: boolean): void {
    const r = this.live;
    if (!r) return;
    r.autoCast = mode;
    if (cast) r.autoCasts = (r.autoCasts ?? 0) + 1;
  }

  /** Adds a plan's decisions to room `index`'s record. */
  decide(index: number, purpose: string, decisions: readonly DecisionLike[]): void {
    if (decisions.length === 0) return;
    this.attach(index, (r) => { r.decisions = [...(r.decisions ?? []), ...logDecisions(purpose, decisions)]; });
  }

  /**
   * One simulation step's worth of record, called straight after `step`.
   *
   * A dash and a swing are counted when the simulation *starts* one rather
   * than while a key is held, so a held key is one act; a cast is counted off
   * `shotsFired` for the same reason. The harness counts all three the same
   * way, which is the only thing that makes the two logs comparable.
   */
  sample(w: World, dtMs: number): void {
    const r = this.live;
    if (!r) return;
    const p = w.player;
    this.watch.sample(w, dtMs);
    r.ms += dtMs;
    if (this.was.swingMs <= 0 && p.swingMs > 0) r.swings++;
    if (this.was.dashMs <= 0 && p.dashMs > 0) r.dashes++;
    if (w.stats.shotsFired > this.was.shotsFired) r.casts++;
    this.was = { swingMs: p.swingMs, dashMs: p.dashMs, shotsFired: w.stats.shotsFired };
    for (const b of w.enemyBullets)
      if (b.alive && Math.hypot(b.x - p.x, b.y - p.y) < NEAR_BULLET_PX) { r.nearMs += dtMs; break; }
    // Counted by the simulation, so the log says the same thing in the browser
    // as it does in the harness.
    r.castPresses = w.stats.castPresses;
    r.castRefusedMana = w.stats.castRefusedMana;
    r.manaShortMs = Math.round(w.stats.manaBelowKeyMs);
    // The body's level as the room leaves it (`run/levels.ts`): the last
    // value sampled is the one the flushed room carries.
    r.level = w.level;
    for (const ev of w.events) {
      if (ev.kind === "player_hit" && ev.amount) {
        const hp = ev.amount * HP_PER_HEART;
        const cause = ev.what ?? "unknown";
        r.hpLost += hp;
        r.bySource[cause] = (r.bySource[cause] ?? 0) + hp;
      } else if (ev.kind === "enemy_killed" && !ev.what?.startsWith("prop:")) {
        r.kills++;
      }
    }
  }

  /**
   * The share of the room in progress spent with an enemy bullet close, which
   * is what `movement_pressure_recent` is bucketed from (doc 011). Zero before
   * a room has run for any time, which reads as `light` — correct for a room
   * nobody has fought in yet.
   */
  nearShare(): number {
    const r = this.live;
    return r && r.ms > 0 ? r.nearMs / r.ms : 0;
  }

  /** Closes the room in progress and writes the log out. */
  flush(): void {
    if (!this.live) return;
    this.live.ms = Math.round(this.live.ms);
    const balance = this.watch.result();
    if (balance) Object.assign(this.live, balance);
    this.watch = new RoomWatch();
    // A room no step was simulated in — the title's backdrop, replaced the moment a run starts — is not a room played.
    if (this.live.ms > 0) this.rooms.push(this.live);
    this.live = null;
    if (this.rooms.length > LOG_LIMIT) this.rooms = this.rooms.slice(-LOG_LIMIT);
    // The balance fields stay in memory: storage keeps the lean record a reload needs.
    try { localStorage.setItem(LOG_KEY, JSON.stringify(this.rooms.map(lean))); } catch { /* the session still records */ }
  }

  /** The log as the calibration command reads it. */
  json(): string {
    this.flush();
    return JSON.stringify({
      source: "game", seed: this.seed, at: new Date().toISOString(), ...(this.run ? { run: this.run } : {}), rooms: this.rooms,
    }, null, 2);
  }

  count(): number {
    return this.rooms.length + (this.live ? 1 : 0);
  }

  clear(): void {
    this.rooms = [];
    this.live = null;
    this.run = null;
    this.pending.clear();
    try { localStorage.removeItem(LOG_KEY); localStorage.removeItem(META_KEY); } catch { /* nothing to forget */ }
  }
}

/**
 * The one recorder. A singleton because the scene writes it and the panel reads
 * it, and threading it between them would be a constructor argument on both for
 * a developer's readout.
 */
export const playtestLog = new PlaytestRecorder();

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
    readonly size: string;
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
    /**
     * `spawns` is the English line this panel prints; `parts` is the same
     * wave unjoined, which the room plan page says in the player's language.
     */
    readonly waves: readonly {
      readonly atMs: number;
      readonly spawns: string;
      readonly parts: readonly { readonly count: number; readonly archetype: string; readonly group: string }[];
    }[];
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
    /** The style the player chose, and their own words if any. */
    readonly style?: string;
    readonly words?: string;
    /** Each room so far as it was built — the run the briefing gives Jev. */
    readonly built?: readonly { readonly room: number; readonly facts: Readonly<Record<string, string>> }[];
  };
  /** Every Director request for this room: its state and every question, all options. */
  readonly director: readonly ReadoutRequest[];
}

export interface DebugActions {
  /** Swap the spells on two keys. */
  readonly swapSpells: (a: number, b: number) => void;
  /** Put one body of this kind in front of the player, an elite if asked. */
  readonly spawnEnemy: (id: string, elite: boolean) => void;
  /** Remove every enemy and queued wave so the room can clear on the next step. */
  readonly clearEnemies: () => void;
  /** How large the floor's stones are drawn, and the switch for it. */
  readonly floorGrain: () => FloorGrain;
  readonly setFloorGrain: (grain: FloorGrain) => void;
  /**
   * Whether the player can be hurt, and the switch for it.
   *
   * It lives here rather than in the pause menu's Settings: it is a testing
   * switch, and a menu the player opens mid-run should not offer to turn the
   * run off.
   */
  readonly invincible: () => boolean;
  readonly setInvincible: (on: boolean) => void;
  /** Buy, forge and refresh without spending gold while testing. */
  readonly infiniteGold: () => boolean;
  readonly setInfiniteGold: (on: boolean) => void;
  /**
   * Forgets that the first-launch key guide was seen, so it can be looked at
   * again. It shows once per browser, which makes it the one screen that is
   * otherwise impossible to test twice.
   */
  readonly resetFirstLaunch: () => void;
  /**
   * Straight to the next room, without clearing this one.
   *
   * It was `N`, on the controls page, in a list of keys a player reads: a
   * developer's shortcut has no business there, and it is the only action in
   * the game that is not part of playing it.
   */
  readonly skipRoom: () => void;
  /**
   * Straight to one of the king's two meetings (doc 022), with the build the
   * run holds now: room 5's first audience from its opening, or the throne
   * hall's final from its entrance.
   */
  readonly toAudience: () => void;
  readonly toGuardian: () => void;
  /** This room again with a room objective forced on it (doc 025). */
  readonly toObjective: (kind: "hold" | "destroy") => void;
  readonly toFinal: () => void;
  /** The BOSS tab: the boss on a lead (`boss-lab.ts`). */
  readonly bossLab: BossLabActions;
  /**
   * The SPELLS tab: every spell in a practice arena (`spell-lab.ts`). Only
   * given with `?lab=spells`; without it the tab is not there at all.
   */
  readonly spellLab?: SpellLabActions;
}

/** What the spawn row can put in the room. */
const SPAWNABLE: readonly string[] = [...ENEMY_IDS, "boss"];

/** How large the floor's stones are drawn: a tile, two thirds of one, half of one. */
export const FLOOR_GRAINS = ["coarse", "mid", "fine"] as const;
export type FloorGrain = (typeof FLOOR_GRAINS)[number];

const PANEL_ID = "jr-debug";
const BUTTON_ID = "jr-debug-toggle";
/** Whether the panel was open last time; a developer's convenience, per browser. */
const OPEN_KEY = "jr-debug-open";
/** Which tab was last looked at, remembered for the same reason. */
const TAB_KEY = "jr-debug-tab";

/**
 * The sidebar's tabs.
 *
 * It was one column that ran to several screens, so reading the encounter
 * meant scrolling past the whole Director readout. Five tabs, each scrolling
 * on its own, and only the one on screen is built each frame — which is also
 * most of the DOM work gone.
 *
 * `director` rather than "director questions": it is the same thing the room
 * plan's third tab shows, and the two should be called one name.
 */
const TABS = ["run", "room", "director", "enemies", "boss", "spells", "tools"] as const;
type Tab = (typeof TABS)[number];

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
  private readonly tabBar: HTMLElement;
  /** The built-once, wired-once controls, shown on the tab that owns them. */
  private readonly spawnBox: HTMLElement;
  private readonly toolBox: HTMLElement;
  private readonly bossLab: BossLabPanel;
  /** The SPELLS tab, when the page asked for the spell lab. */
  private readonly spellLab: SpellLabPanel | null;
  private tab: Tab = "run";
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
      padding: "8px 0 0", boxSizing: "border-box", borderLeft: "1px solid #2a2750",
      display: "none", zIndex: "20", flexDirection: "column",
    } as Partial<CSSStyleDeclaration>);
    // The bar is fixed and the page under it scrolls, so a long readout never
    // takes the tabs off the top of the panel.
    this.root.style.overflowY = "hidden";
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved && (TABS as readonly string[]).includes(saved) && (saved !== "spells" || actions.spellLab)) this.tab = saved as Tab;
    } catch { /* private window, or blocked */ }
    this.tabBar = document.createElement("nav");
    Object.assign(this.tabBar.style, {
      display: "flex", flexWrap: "wrap", gap: "2px", padding: "0 10px 6px", borderBottom: "1px solid #2a2750", flex: "0 0 auto",
    } as Partial<CSSStyleDeclaration>);
    this.readout = document.createElement("div");
    Object.assign(this.readout.style, {
      flex: "1 1 auto", minHeight: "0", overflowY: "auto", padding: "0 14px 24px", boxSizing: "border-box",
    } as Partial<CSSStyleDeclaration>);
    this.spawnBox = document.createElement("div");
    this.toolBox = document.createElement("div");
    this.root.appendChild(this.tabBar);
    this.root.appendChild(this.readout);
    this.readout.appendChild(this.spawnBox);
    this.readout.appendChild(this.toolBox);
    this.bossLab = new BossLabPanel(actions.bossLab);
    this.readout.appendChild(this.bossLab.root);
    this.spellLab = actions.spellLab ? new SpellLabPanel(actions.spellLab) : null;
    if (this.spellLab) this.readout.appendChild(this.spellLab.root);
    this.buildTabs();
    this.buildControls();
    document.body.appendChild(this.root);

    this.button = document.createElement("button");
    this.button.id = BUTTON_ID;
    this.button.textContent = "DEBUG";
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

  /** The tab bar: one button each, the current one lit. */
  private buildTabs(): void {
    for (const name of TABS) {
      if (name === "spells" && !this.spellLab) continue;
      const b = document.createElement("button");
      b.textContent = name;
      b.dataset.tab = name;
      Object.assign(b.style, {
        background: "transparent", color: "#8792b5", border: "1px solid transparent",
        borderBottom: "2px solid transparent", font: "inherit", padding: "2px 7px",
        cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "11px",
      } as Partial<CSSStyleDeclaration>);
      b.addEventListener("click", () => this.setTab(name));
      this.tabBar.appendChild(b);
    }
    this.paintTabs();
  }

  private paintTabs(): void {
    for (const b of Array.from(this.tabBar.querySelectorAll<HTMLButtonElement>("button[data-tab]"))) {
      const on = b.dataset.tab === this.tab;
      b.style.color = on ? "#ffe9a8" : "#8792b5";
      b.style.borderBottomColor = on ? "#ffe9a8" : "transparent";
    }
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* not available: the panel still works */ }
    this.paintTabs();
    // A tab keeps its own scroll position badly if the last one's is carried
    // into it, and the reader is always at the top of something new.
    this.readout.scrollTop = 0;
    if (this.last) this.render(this.last);
  }

  /** The spawn row: built once, wired once, never rerendered. */
  private buildControls(): void {
    this.spawnBox.innerHTML = h2("spawn")
      + `<div style="margin:2px 0"><select data-spawn-pick style="${BTN};margin-left:0">`
      + SPAWNABLE.map((id) => `<option value="${id}">${id}</option>`).join("")
      + `</select><button data-spawn="0" style="${BTN}">spawn</button><button data-spawn="1" style="${BTN}">spawn elite</button>`
      + `<div style="color:#5a5f7a">appears a few tiles ahead of the player, awake</div></div>`
      + `<div style="margin:6px 0"><button data-clear-enemies style="${BTN};margin-left:0">clear enemies</button>`
      + `<div style="color:#5a5f7a">removes current enemies and queued waves; the room clears normally</div></div>`;
    const pick = this.spawnBox.querySelector<HTMLSelectElement>("select[data-spawn-pick]");
    pick?.addEventListener("change", () => { this.spawnPick = pick.value; });
    for (const btn of Array.from(this.spawnBox.querySelectorAll<HTMLButtonElement>("button[data-spawn]")))
      btn.addEventListener("click", () => this.actions.spawnEnemy(this.spawnPick, btn.dataset.spawn === "1"));
    this.spawnBox.querySelector<HTMLButtonElement>("button[data-clear-enemies]")
      ?.addEventListener("click", () => this.actions.clearEnemies());

    const scale = document.createElement("div");
    scale.innerHTML = h2("floor")
      + `<div style="margin:2px 0"><select data-floor-grain style="${BTN};margin-left:0">`
      + FLOOR_GRAINS.map((g) => `<option value="${g}">${g}</option>`).join("")
      + `</select><span style="color:#5a5f7a"> stones 1, 2/3 or 1/2 a tile</span></div>`;
    this.toolBox.appendChild(scale);
    const grain = scale.querySelector<HTMLSelectElement>("select[data-floor-grain]")!;
    grain.value = this.actions.floorGrain();
    grain.addEventListener("change", () => this.actions.setFloorGrain(grain.value as FloorGrain));

    const cheats = document.createElement("div");
    cheats.innerHTML = h2("testing")
      + `<div style="margin:2px 0"><label style="cursor:pointer"><input type="checkbox" data-invincible> invincible</label>`
      + `<div style="color:#5a5f7a">the player takes no damage; remembered per browser</div>`
      + `<div style="margin-top:4px"><label style="cursor:pointer"><input type="checkbox" data-infinite-gold> infinite gold</label></div>`
      + `<div style="color:#5a5f7a">purchases, forging and rerolls cost nothing; remembered per browser</div>`
      + `<div style="margin-top:4px"><button data-reset-hints style="${BTN};margin-left:0">reset first-launch hints</button></div>`
      + `<div style="color:#5a5f7a">the key guide shows again on the next first room</div>`
      + `<div style="margin-top:4px"><button data-skip-room style="${BTN};margin-left:0">skip to the next room</button></div>`
      + `<div style="color:#5a5f7a">leaves this room uncleared; was the N key</div>`
      + `<div style="margin-top:4px"><button data-to-audience style="${BTN};margin-left:0">king: first audience</button>`
      + `<button data-to-guardian style="${BTN}">guardian</button>`
      + `<button data-to-final style="${BTN}">king: final</button></div>`
      + `<div style="color:#5a5f7a">the first audience's room from its opening, room 10's guardian, or the throne hall from its entrance, with the build held now</div>`
      + `<div style="margin-top:4px"><button data-objective="hold" style="${BTN};margin-left:0">objective: hold</button>`
      + `<button data-objective="destroy" style="${BTN}">objective: destroy</button></div>`
      + `<div style="color:#5a5f7a">this room again, with the objective forced on it</div></div>`;
    this.toolBox.appendChild(cheats);

    /*
     * **The playtest log**, out of the browser and into the calibration
     * command. It lives here rather than anywhere a player can reach it: the
     * in-game UI does not change, and a readout of how badly the session is
     * going is not something to put in front of somebody playing.
     */
    const playtest = document.createElement("div");
    playtest.innerHTML = h2("playtest log")
      + `<div style="margin:2px 0"><button data-log-copy style="${BTN};margin-left:0">copy JSON</button>`
      + `<button data-log-save style="${BTN}">download</button>`
      + `<button data-log-clear style="${BTN}">clear</button>`
      + `<div data-log-count style="color:#5a5f7a"></div>`
      + `<div style="color:#5a5f7a">this run only (cleared when a run begins), headed by its Director and style.`
      + ` Per room: time, HP lost by source, kills, dashes, casts, swings, the mana economy, and every`
      + ` Director answer made for it — question, choice, source, confidence and distribution — with the doors`
      + ` out, the cards offered and the card taken.`
      + ` Feed it to <b>pnpm play:calibrate &lt;file&gt;</b> to compare it against the skill profiles.</div></div>`;
    this.toolBox.appendChild(playtest);
    const count = playtest.querySelector<HTMLElement>("[data-log-count]");
    const say = (text: string): void => { if (count) count.textContent = text; };
    say(`${playtestLog.count()} rooms recorded`);
    playtest.querySelector<HTMLButtonElement>("button[data-log-copy]")?.addEventListener("click", () => {
      const json = playtestLog.json();
      // `writeText` rejects without a secure context or focus, and a developer
      // who sees nothing happen has no way to tell that from an empty log.
      navigator.clipboard?.writeText(json)
        .then(() => { say(`copied ${playtestLog.count()} rooms`); })
        .catch(() => { say("clipboard refused — use download"); });
    });
    playtest.querySelector<HTMLButtonElement>("button[data-log-save]")?.addEventListener("click", () => {
      try {
        const url = URL.createObjectURL(new Blob([playtestLog.json()], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `playtest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
        a.click();
        URL.revokeObjectURL(url);
        say(`downloaded ${playtestLog.count()} rooms`);
      } catch { say("download failed"); }
    });
    playtest.querySelector<HTMLButtonElement>("button[data-log-clear]")?.addEventListener("click", () => {
      playtestLog.clear();
      say("0 rooms recorded");
    });

    const inv = cheats.querySelector<HTMLInputElement>("input[data-invincible]")!;
    inv.checked = this.actions.invincible();
    inv.addEventListener("change", () => this.actions.setInvincible(inv.checked));
    const gold = cheats.querySelector<HTMLInputElement>("input[data-infinite-gold]")!;
    gold.checked = this.actions.infiniteGold();
    gold.addEventListener("change", () => this.actions.setInfiniteGold(gold.checked));
    cheats.querySelector<HTMLButtonElement>("button[data-reset-hints]")
      ?.addEventListener("click", () => this.actions.resetFirstLaunch());
    cheats.querySelector<HTMLButtonElement>("button[data-skip-room]")
      ?.addEventListener("click", () => this.actions.skipRoom());
    cheats.querySelector<HTMLButtonElement>("button[data-to-audience]")
      ?.addEventListener("click", () => this.actions.toAudience());
    cheats.querySelector<HTMLButtonElement>("button[data-to-guardian]")
      ?.addEventListener("click", () => this.actions.toGuardian());
    for (const b of Array.from(cheats.querySelectorAll<HTMLButtonElement>("button[data-objective]")))
      b.addEventListener("click", () => this.actions.toObjective(b.dataset.objective as "hold" | "destroy"));
    cheats.querySelector<HTMLButtonElement>("button[data-to-final]")
      ?.addEventListener("click", () => this.actions.toFinal());
  }

  toggle(): void {
    this.open = !this.open;
    // Flex, not block: the readout scrolls because it is the column's flexible child.
    this.root.style.display = this.open ? "flex" : "none";
    this.button.style.right = this.open ? "352px" : "8px";
    try { localStorage.setItem(OPEN_KEY, this.open ? "1" : "0"); } catch { /* not available: the panel still works */ }
    if (this.open && this.last) this.render(this.last);
  }

  /** Straight to the BOSS tab, open: the `?lab=boss` start. */
  showBossLab(): void {
    this.setTab("boss");
    if (!this.open) this.toggle();
    this.bossLab.syncHold();
  }

  /** Whether the BOSS tab is on screen, so the scene builds its frame only then. */
  bossLabShown(): boolean {
    return this.open && this.tab === "boss";
  }

  /** Every frame the BOSS tab is on screen: the beat strip. */
  bossFrame(f: BossLabFrame | null): void {
    this.bossLab.frame(f);
  }

  /** Straight to the SPELLS tab, open: the `?lab=spells` start. */
  showSpellLab(): void {
    if (!this.spellLab) return;
    this.setTab("spells");
    if (!this.open) this.toggle();
  }

  /** Every frame while the SPELLS tab is on screen: what the lab changed. */
  spellFrame(): void {
    if (this.open && this.tab === "spells") this.spellLab?.frame();
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * Builds the tab on screen and nothing else.
   *
   * Every section of every tab used to be rebuilt each frame and then
   * diffed; four fifths of that work was for pages nobody was looking at.
   * The controls are DOM that is built once, so they are shown and hidden
   * rather than written.
   */
  render(snap: DebugSnapshot): void {
    this.last = snap;
    if (!this.open) return;
    this.spawnBox.style.display = this.tab === "enemies" ? "block" : "none";
    this.toolBox.style.display = this.tab === "tools" ? "block" : "none";
    this.bossLab.root.style.display = this.tab === "boss" ? "block" : "none";
    if (this.spellLab) this.spellLab.root.style.display = this.tab === "spells" ? "block" : "none";
    const parts = this.tab === "run" ? this.runParts(snap)
      : this.tab === "room" ? this.roomParts(snap)
      : this.tab === "director" ? this.directorParts(snap)
      : this.tab === "enemies" ? this.enemyParts(snap)
      : this.tab === "boss" || this.tab === "spells" ? []
      : this.toolParts();
    this.patch(groupByHeading(parts));
  }

  /** The run: how it was seeded, where it is, who is directing it, and what the player is. */
  private runParts(snap: DebugSnapshot): string[] {
    const r = snap.room;
    const parts: string[] = [];
    // Which arm actually answered, rather than which one was asked for: a
    // room can be requested from Jev and answered by the rule table.
    const jev = snap.director.filter((q) => q.source === "jev").length;
    const arm = snap.director.length === 0 ? "none (placed, not planned)"
      : jev === snap.director.length ? "jev"
      : jev === 0 ? "rule" : `jev on ${jev} of ${snap.director.length} requests`;
    parts.push(h2(`room ${r.index}  ${r.type}${r.elite ? "  ELITE" : ""}`));
    parts.push(kv([
      ["seed", `${snap.seed}  (?seed=… in the URL replays it)`],
      ["stage", r.stage], ["tension", r.tension], ["director", arm],
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
    parts.push(snap.spells.map((sl, i) => {
      const name = sl.name ? esc(sl.name) : dim("empty");
      const cost = sl.cost === null ? "" : `  ${fmt(sl.cost)} mana`;
      const cd = sl.cooldownMs > 0 ? `  cd ${Math.ceil(sl.cooldownMs)}ms` : "";
      const affixes = sl.affixes.length ? `<div style="color:#8792b5;padding-left:26px">${sl.affixes.map(esc).join(", ")}</div>` : "";
      const up = i > 0 ? `<button data-swap="${i - 1},${i}" style="${BTN}">↑</button>` : "";
      const down = i < snap.spells.length - 1 ? `<button data-swap="${i},${i + 1}" style="${BTN}">↓</button>` : "";
      return `<div style="margin:2px 0"><b style="color:#ffe9a8">${esc(sl.key)}</b> ${name}<span style="color:#8792b5">${cost}${cd}</span> ${up}${down}${affixes}</div>`;
    }).join(""));

    parts.push(h2("history"));
    parts.push(kv([
      ["style", snap.history.style ? `${snap.history.style}${snap.history.words ? ` — “${snap.history.words}”` : ""}` : dim("—")],
      ["rooms", snap.history.rooms.join(" › ") || dim("—")],
      ["tensions", snap.history.tensions.join(" › ") || dim("—")],
    ]));
    // Each room as it was built, doors and all: the run the briefing hands Jev.
    const built = snap.history.built ?? [];
    parts.push(`<div style="color:#5f86a8;margin:6px 0 2px">the run as built (in Jev's briefing)</div>`);
    parts.push(built.length === 0 ? dim("none yet") : built.map((d) =>
      `<div style="margin:2px 0;font-size:11px"><b style="color:#ffe9a8">#${d.room}</b> `
      + Object.entries(d.facts).map(([k, v]) => `<span style="color:#8792b5">${esc(k)}</span>=${esc(v)}`).join(" · ")
      + `</div>`).join(""));
    return parts;
  }

  /** The room as it was planned and as it came out. */
  private roomParts(snap: DebugSnapshot): string[] {
    const r = snap.room;
    const e = snap.encounter;
    const parts: string[] = [];

    parts.push(h2(`room ${r.index}  ${r.type}${r.elite ? "  ELITE" : ""}`));
    parts.push(kv([
      ["space", r.space], ["symmetry", r.symmetry], ["size", r.size], ["mood", r.mood],
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

    return parts;
  }

  /** The live bodies, and the switch that adds one. */
  private enemyParts(snap: DebugSnapshot): string[] {
    return [h2("live"), kv([
      ["enemies alive", String(snap.enemies.alive)],
      ["waves pending", String(snap.enemies.pending)],
      ...Object.entries(snap.enemies.byArchetype).map(([k, v]) => [`  ${k}`, String(v)] as [string, string]),
    ])];
  }

  /** Nothing of its own: the switches are DOM that is built once. */
  private toolParts(): string[] {
    return [];
  }

  /*
   * **Every Director parameter**: what each request was sent, and every
   * question it held with all its options — the answer drawn in gold, the
   * arm that answered beside it.
   */
    /*
     * **One collapsible section per request.**
     *
     * A room is planned in two requests and the second is asked of what the
     * first produced, so the sidebar is grouped the way the plan actually
     * happened rather than by subject — the subjects stay as sub-groups
     * inside. Each section carries what the call cost and, folded away, the
     * three payloads as they went and came back, each with a copy button:
     * the one thing a sidebar can do that a screenshot cannot is hand you
     * the exact JSON to paste into a bug report.
     */
  private directorParts(snap: DebugSnapshot): string[] {
    const parts: string[] = [];
    parts.push(h2(`director requests (${snap.director.length})`));
    if (snap.director.length === 0) parts.push(dim("no requests: this room was placed, not planned"));
    snap.director.forEach((req, i) => {
      const jev = req.source === "jev";
      const status = req.fallback
        ? `<b style="color:#ffb080">rule fallback · ${esc(req.error ?? req.fallback)}</b>`
        : `<b style="color:${jev ? "#8fdcff" : "#5a5f7a"}">${jev ? "jev" : "rule"}</b>`;
      const cost = [
        req.ms === undefined ? "" : `${req.ms} ms`,
        req.tokens ? `${req.tokens} in` : "",
        req.retries ? `retried x${req.retries}` : "",
      ].filter(Boolean).join(" · ");
      parts.push(h3(`request ${i + 1} · round ${req.round}: ${req.subjects}`));
      parts.push(`<div style="margin:-2px 0 4px">${status}`
        + (cost ? ` <span style="color:#5a5f7a">${esc(cost)}</span>` : "")
        + (req.askedOf ? `<div style="color:#5a5f7a">asked of: ${esc(req.askedOf)}</div>` : "")
        + `</div>`);

      const groups = groupRequest(req);
      for (const group of groups) {
        parts.push(`<div style="color:#5f86a8;margin:4px 0 1px">${esc(group.category)}</div>`);
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
            + (q.note ? ` <span style="color:#5a5f7a">(${esc(q.note)})</span>` : "");
          const asked = q.instructions
            ? `<div style="padding-left:10px;color:#5a5f7a;font-size:10px">${esc(q.instructions)}</div>` : "";
          return `<div style="margin:3px 0">${head}${asked}`
            + `<div style="padding-left:10px;font-size:11px">${opts || dim("no options")}</div></div>`;
        }).join(""));
      }
      // The briefing arm sends one text field: shown as the text Jev reads, line for line, not as an escaped JSON string.
      const brief = (req.raw.state as Record<string, unknown> | null)?.["briefing"];
      parts.push(typeof brief === "string"
        ? rawText(`req${i}-state`, "state as sent (briefing)", brief)
        : raw(`req${i}-state`, "state as sent (labels)", req.raw.state));
      parts.push(raw(`req${i}-questions`, "questions as sent", req.raw.questions));
      parts.push(raw(`req${i}-answers`, "answers as returned", req.raw.answers));
    });
    return parts;
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
      for (const btn of Array.from(s.el.querySelectorAll<HTMLButtonElement>("button[data-copy]"))) {
        btn.addEventListener("click", (ev) => {
          // Inside a `<summary>`, so the click would otherwise fold the very
          // thing it is copying.
          ev.preventDefault();
          ev.stopPropagation();
          const pre = s.el.querySelector<HTMLPreElement>(`pre[data-raw="${btn.dataset.copy}"]`);
          if (!pre) return;
          void navigator.clipboard?.writeText(pre.textContent ?? "").then(
            () => { btn.textContent = "copied"; setTimeout(() => { btn.textContent = "copy"; }, 900); },
            () => { btn.textContent = "failed"; setTimeout(() => { btn.textContent = "copy"; }, 900); },
          );
        });
      }
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
/**
 * A payload, folded away, with a button that copies it.
 *
 * Collapsed because it is three screens of JSON per request and nobody wants
 * it open by default; copyable because the one thing a sidebar can do that a
 * screenshot cannot is hand over the exact bytes. `<details>` keeps its own
 * open state across the panel's re-renders as long as the HTML is unchanged,
 * which `patch` already guarantees.
 */
function raw(id: string, label: string, value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return `<details style="margin:2px 0">`
    + `<summary style="cursor:pointer;color:#5a5f7a;font-size:11px">${esc(label)}`
    + ` <button data-copy="${esc(id)}" style="${BTN}">copy</button></summary>`
    + `<pre data-raw="${esc(id)}" style="margin:2px 0;padding:4px;background:#0d0b1f;border:1px solid #2a2750;`
    + `max-height:180px;overflow:auto;font-size:10px;white-space:pre-wrap;word-break:break-all">${esc(json)}</pre>`
    + `</details>`;
}
/** Like `raw`, for text that is already what was sent: a briefing, kept as its own lines. */
function rawText(id: string, label: string, text: string): string {
  return `<details style="margin:2px 0">`
    + `<summary style="cursor:pointer;color:#5a5f7a;font-size:11px">${esc(label)}`
    + ` <button data-copy="${esc(id)}" style="${BTN}">copy</button></summary>`
    + `<pre data-raw="${esc(id)}" style="margin:2px 0;padding:4px;background:#0d0b1f;border:1px solid #2a2750;`
    + `max-height:420px;overflow:auto;font-size:10px;white-space:pre-wrap;word-break:break-word">${esc(text)}</pre>`
    + `</details>`;
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
