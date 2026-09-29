/**
 * **The fight's keys, as the player binds them.**
 *
 * Every verb of the fight and the room — moving, the sword, the dash, the
 * spin, the three spell keys, the assist's cast key, using, dismantling,
 * rerolling and the character screen — is an `Action` with one key, and
 * the player may put any action on any key from the controls page. The
 * defaults are the layout the game was built round (doc 013): the left
 * hand on W A S D, the right on J K L with the spells over them.
 *
 * **The menus' own keys stay put** (`RESERVED_CODES`): Enter confirms, Esc
 * backs out, the arrows move a menu's cursor. They are how a player gets
 * back out of a binding gone wrong, so no binding may take them.
 *
 * A binding is a key code and the label the key printed when it was bound
 * (`KeyboardEvent.key`), not a label looked up from the code: one physical
 * key reports one code and prints different characters on a US and a JIS
 * board, and the cap on screen has to say what is printed on the player's.
 *
 * Pure data: the scene makes the Phaser keys from it (`PlayScene.applyBinds`),
 * and the keycap markup reads the labels through `[@action]` tokens.
 */

/** A verb the player can put on a key of their choosing. */
export type Action =
  | "up" | "down" | "left" | "right"
  | "attack" | "dash" | "spin"
  | "spell1" | "spell2" | "spell3" | "autoCast"
  | "interact" | "dismantle" | "reroll" | "character";

/** Every action, in the order the controls page lists them. */
export const ACTIONS: readonly Action[] = [
  "up", "down", "left", "right",
  "attack", "dash", "spin",
  "spell1", "spell2", "spell3", "autoCast",
  "interact", "dismantle", "reroll", "character",
];

/** One key: the code the browser reports, and what the cap reads. */
export interface Binding {
  readonly code: number;
  readonly label: string;
}

/** The layout the game ships with (doc 013). */
export const DEFAULT_BINDINGS: Readonly<Record<Action, Binding>> = {
  up: { code: 87, label: "W" },
  down: { code: 83, label: "S" },
  left: { code: 65, label: "A" },
  right: { code: 68, label: "D" },
  attack: { code: 74, label: "J" },
  dash: { code: 75, label: "K" },
  spin: { code: 76, label: "L" },
  spell1: { code: 85, label: "U" },
  spell2: { code: 73, label: "I" },
  spell3: { code: 79, label: "O" },
  autoCast: { code: 32, label: "Space" },
  interact: { code: 69, label: "E" },
  dismantle: { code: 88, label: "X" },
  reroll: { code: 82, label: "R" },
  character: { code: 9, label: "Tab" },
};

/**
 * Keys no action may take: Enter, Esc and the arrows, which every menu
 * reads, plus the backtick (the debug panel) and the system keys a browser
 * or the OS keeps for itself (Meta, the context-menu key).
 */
export const RESERVED_CODES: ReadonlySet<number> = new Set([13, 27, 37, 38, 39, 40, 192, 91, 92, 93, 224]);

/** Whether `name` is an action, for the markup's `[@action]` tokens. */
export function isAction(name: string): name is Action {
  return (ACTIONS as readonly string[]).includes(name);
}

/**
 * What a cap reads for a key the player pressed: the character it printed,
 * upper-cased, or a short name for the keys that print none.
 */
export function labelOfKey(ev: { readonly key: string; readonly code?: string }): string {
  const named: Record<string, string> = {
    " ": "Space", Shift: "Shift", Control: "Ctrl", Alt: "Alt", Tab: "Tab", CapsLock: "Caps",
    Backspace: "Bksp", Delete: "Del", Insert: "Ins", Home: "Home", End: "End",
    PageUp: "PgUp", PageDown: "PgDn",
  };
  const base = named[ev.key] ?? (ev.key.length === 1 ? ev.key.toUpperCase() : ev.key);
  // The numpad's keys print the same digits as the row's: say which.
  return ev.code?.startsWith("Numpad") && ev.key.length === 1 ? `Num${base}` : base;
}

/** The bindings in play: loaded from what was saved, changed one key at a time, saved back. */
export class Keybinds {
  private readonly map = new Map<Action, Binding>();

  /** From a saved `serialize()`; anything missing, malformed, reserved or doubled falls back to its default. */
  constructor(saved: string | null = null) {
    let parsed: Partial<Record<Action, Binding>> = {};
    try { parsed = saved ? JSON.parse(saved) as Partial<Record<Action, Binding>> : {}; } catch { /* the defaults */ }
    // The saved keys first, each once.
    const taken = new Set<number>();
    const left: Action[] = [];
    for (const a of ACTIONS) {
      const b = parsed[a];
      if (b && typeof b.code === "number" && typeof b.label === "string" && b.label.length > 0
        && !RESERVED_CODES.has(b.code) && !taken.has(b.code)) {
        this.map.set(a, { code: b.code, label: b.label });
        taken.add(b.code);
      } else left.push(a);
    }
    /*
     * Then the rest, on their defaults where those are free, else on the
     * first default no one holds. There are as many defaults as actions, so
     * one is always free.
     */
    for (const a of left) {
      const own = DEFAULT_BINDINGS[a];
      const key = !taken.has(own.code) ? own : ACTIONS.map((x) => DEFAULT_BINDINGS[x]).find((d) => !taken.has(d.code)) ?? own;
      this.map.set(a, key);
      taken.add(key.code);
    }
  }

  get(a: Action): Binding {
    return this.map.get(a) ?? DEFAULT_BINDINGS[a];
  }

  label(a: Action): string {
    return this.get(a).label;
  }

  /** The action on `code`, if any. */
  actionOn(code: number): Action | null {
    for (const [a, b] of this.map) if (b.code === code) return a;
    return null;
  }

  /**
   * Puts `a` on `key`. A reserved key is refused (`ok: false`). A key
   * another action held is **swapped**: that action takes `a`'s old key,
   * so no key is ever on two actions and no action is ever left with none.
   */
  set(a: Action, key: Binding): { ok: boolean; swapped: Action | null } {
    if (RESERVED_CODES.has(key.code)) return { ok: false, swapped: null };
    const other = this.actionOn(key.code);
    if (other === a) { this.map.set(a, key); return { ok: true, swapped: null }; }
    if (other) this.map.set(other, this.get(a));
    this.map.set(a, key);
    return { ok: true, swapped: other };
  }

  /** Every action back on its default. */
  reset(): void {
    for (const a of ACTIONS) this.map.set(a, DEFAULT_BINDINGS[a]);
  }

  /** Whether every action is on its default. */
  isDefault(): boolean {
    return ACTIONS.every((a) => this.get(a).code === DEFAULT_BINDINGS[a].code);
  }

  serialize(): string {
    return JSON.stringify(Object.fromEntries(ACTIONS.map((a) => [a, this.get(a)])));
  }
}
