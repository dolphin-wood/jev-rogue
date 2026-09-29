/**
 * **The mouse pointer, out of the way while the game is played.**
 *
 * Nothing in a fight reads the mouse — the aim is the facing (doc 013) — so
 * an arrow parked over the room is only something in the way of it, and in
 * every recording. The menus still take clicks, so the pointer is hidden, not
 * disabled: a key press hides it at once, and so does two seconds of the
 * mouse lying still; the mouse moving brings it back at once. It is never
 * hidden while a button is held (a hold to reroll, a drag), and every screen
 * follows the one rule, since a player who reaches for the mouse moves it.
 */

/** How long the mouse lies still before the pointer goes. */
export const CURSOR_IDLE_MS = 2000;

/** The rule, apart from the page: fed the events and the clock, it says whether the pointer shows. */
export class CursorHider {
  private shown = true;
  private held = false;
  private movedAt = 0;

  constructor(private readonly idleMs = CURSOR_IDLE_MS) {}

  /** The mouse moved: the pointer shows, and the idle clock starts again. */
  move(now: number): void {
    this.shown = true;
    this.movedAt = now;
  }

  /** A key went down: the player is playing, so the pointer goes — unless a button is held. */
  key(): void {
    if (!this.held) this.shown = false;
  }

  /** A button went down or up. Held, the pointer stays; let go, the idle clock starts from now. */
  press(down: boolean, now: number): void {
    this.held = down;
    this.shown = true;
    this.movedAt = now;
  }

  /** Whether the pointer shows at `now`, after the idle wait has been checked. */
  visible(now: number): boolean {
    if (this.shown && !this.held && now - this.movedAt >= this.idleMs) this.shown = false;
    return this.shown;
  }
}

/**
 * Wires the rule to the page: a class on the root element, and a style that
 * hides the pointer everywhere under it — the canvas, the letterbox round it,
 * and anything the game lays over it.
 */
export function autoHideCursor(root: HTMLElement = document.documentElement): void {
  const style = document.createElement("style");
  style.textContent = ".cursor-hidden, .cursor-hidden * { cursor: none !important; }";
  document.head.append(style);
  const hider = new CursorHider();
  const apply = (): void => { root.classList.toggle("cursor-hidden", !hider.visible(performance.now())); };
  window.addEventListener("mousemove", () => { hider.move(performance.now()); apply(); }, { passive: true });
  window.addEventListener("keydown", () => { hider.key(); apply(); });
  window.addEventListener("pointerdown", () => { hider.press(true, performance.now()); apply(); });
  window.addEventListener("pointerup", () => { hider.press(false, performance.now()); apply(); });
  window.setInterval(apply, 250);
  hider.move(performance.now());
  apply();
}
