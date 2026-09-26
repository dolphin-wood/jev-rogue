import Phaser from "phaser";
import { circleSteps, maxZoom } from "./graphics-arcs.ts";

type Obj = Phaser.GameObjects.GameObject;

/** How many frames a shelf's high-water mark is watched before the spares above it are let go. */
const TRIM_FRAMES = 600;

/** One kind of pooled object: what is on the shelf, and how many of it this frame has taken. */
class Shelf<T extends Obj> {
  readonly items: T[] = [];
  used = 0;
  /** The most this window has taken, so a quiet stretch can hand back what a busy one grew. */
  peak = 0;

  constructor(private readonly make: () => T, private readonly drop: (item: T) => void) {}

  take(): T {
    let item = this.items[this.used];
    // Something destroyed a pooled object behind the layer's back: replace it rather than reuse a corpse.
    if (!item || !item.scene) {
      if (item) this.drop(item);
      item = this.make();
      this.items[this.used] = item;
    }
    this.used++;
    return item;
  }

  /** Called at the start of a frame: everything is free again. */
  release(): void {
    if (this.used > this.peak) this.peak = this.used;
    this.used = 0;
  }

  /** Destroys the spares the last window never needed, keeping a little headroom. */
  trim(): void {
    const keep = Math.ceil(this.peak * 1.25) + 8;
    if (this.items.length > keep) for (const item of this.items.splice(keep)) { this.drop(item); item.destroy(); }
    this.peak = 0;
  }
}

/**
 * **The objects one frame draws, kept and reused.**
 *
 * The scene redraws its bodies, bullets, pops and HUD every frame, and it used
 * to do that by destroying every object the last frame made and making them
 * all again: fifty to several hundred game objects a frame, built, sorted and
 * thrown away. That was the heaviest allocation in the game and what fed the
 * collector the pauses that showed up as an occasional hitch.
 *
 * This keeps the familiar shape — the scene still asks for an image and sets
 * it up with the usual chain, and everything asked for is gone next frame —
 * but the objects come off a shelf. Each one is reset on the way out to what
 * the matching `scene.add.*` call would have made, so a chain that sets only
 * the depth is not left carrying the last frame's tint, crop or blend.
 *
 * Anything else given to `add` (a star, another module's helper) is not
 * pooled: it is destroyed at the next `clear`, as the old group did.
 */
export class FrameLayer {
  private readonly drawn: Obj[] = [];
  private readonly inFrame = new Set<Obj>();
  /** Every object the shelves own, drawn or not, so the display list can be rebuilt without them. */
  private readonly pooled = new Set<Obj>();
  private readonly images: Shelf<Phaser.GameObjects.Image>;
  private readonly rects: Shelf<Phaser.GameObjects.Rectangle>;
  private readonly circles: Shelf<Phaser.GameObjects.Arc>;
  private readonly ellipses: Shelf<Phaser.GameObjects.Ellipse>;
  private readonly graphicses: Shelf<Phaser.GameObjects.Graphics>;
  private frames = 0;

  constructor(private readonly scene: Phaser.Scene) {
    const own = <T extends Obj>(go: T): T => { this.pooled.add(go); return go; };
    const drop = (go: Obj): void => { this.pooled.delete(go); };
    this.images = new Shelf(() => own(scene.add.image(0, 0, "__DEFAULT")), drop);
    this.rects = new Shelf(() => own(scene.add.rectangle()), drop);
    this.circles = new Shelf(() => own(scene.add.circle()), drop);
    this.ellipses = new Shelf(() => own(scene.add.ellipse()), drop);
    this.graphicses = new Shelf(() => own(scene.add.graphics()), drop);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.order, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.order, this));
  }

  /** As `scene.add.image`, drawn this frame only. */
  image(x: number, y: number, texture: string, frame?: string | number): Phaser.GameObjects.Image {
    const im = this.images.take();
    if (im.isCropped) im.setCrop();
    im.clearMask();
    im.setFlip(false, false);
    // The frame's own pivot where it has one, as the constructor does.
    im.setTexture(texture, frame).setOriginFromFrame();
    im.setPosition(x, y).setScale(1).setRotation(0).setAlpha(1).clearTint();
    return this.add(this.common(im));
  }

  /** As `scene.add.rectangle`, drawn this frame only. */
  rectangle(x: number, y: number, width = 128, height = 128, fillColor?: number, fillAlpha?: number): Phaser.GameObjects.Rectangle {
    const r = this.rects.take();
    if (r.width !== width || r.height !== height) r.setSize(width, height);
    return this.add(this.shape(r, x, y, fillColor, fillAlpha));
  }

  /** As `scene.add.circle`, drawn this frame only. */
  circle(x: number, y: number, radius = 128, fillColor?: number, fillAlpha?: number): Phaser.GameObjects.Arc {
    const c = this.circles.take();
    /*
     * An outline as fine as it is seen, not Phaser's hundred points, and
     * rebuilt only when the size changes: the path is triangulated on every
     * `setRadius`, and a pooled circle is usually the same one as last frame.
     */
    const arc = c as unknown as { _iterations: number };
    const step = 1 / circleSteps(radius * maxZoom(this.scene));
    if (c.radius !== radius || arc._iterations !== step) {
      arc._iterations = step;
      c.setRadius(radius);
    }
    return this.add(this.shape(c, x, y, fillColor, fillAlpha));
  }

  /** As `scene.add.ellipse`, drawn this frame only. */
  ellipse(x: number, y: number, width = 128, height = 128, fillColor?: number, fillAlpha?: number): Phaser.GameObjects.Ellipse {
    const e = this.ellipses.take();
    const oval = e as unknown as { _smoothness: number };
    const smooth = circleSteps((Math.max(width, height) / 2) * maxZoom(this.scene));
    if (e.width !== width || e.height !== height || oval._smoothness !== smooth) {
      oval._smoothness = smooth;
      e.setSize(width, height);
    }
    return this.add(this.shape(e, x, y, fillColor, fillAlpha));
  }

  /** As `scene.add.graphics`, drawn this frame only. */
  graphics(): Phaser.GameObjects.Graphics {
    const g = this.graphicses.take();
    g.clear().clearMask();
    g.setPosition(0, 0).setScale(1).setRotation(0).setAlpha(1);
    return this.add(this.common(g));
  }

  /** Puts an object in this frame. A pooled one is already in; anything else is destroyed at the next `clear`. */
  add<T extends Obj>(go: T): T {
    if (!this.inFrame.has(go)) {
      this.inFrame.add(go);
      this.drawn.push(go);
    }
    return go;
  }

  /** This frame's objects, in the order they were asked for. */
  getChildren(): readonly Obj[] {
    return this.drawn;
  }

  getLength(): number {
    return this.drawn.length;
  }

  /** Ends the last frame: its pooled objects go back on the shelves, anything else is destroyed. */
  clear(): void {
    for (const go of this.drawn) {
      if (this.pooled.has(go)) (go as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
      else go.destroy();
    }
    this.drawn.length = 0;
    this.inFrame.clear();
    for (const shelf of this.shelves()) shelf.release();
    if (++this.frames % TRIM_FRAMES === 0) for (const shelf of this.shelves()) shelf.trim();
  }

  /**
   * Puts the frame's objects on the display list in the order they were drawn.
   *
   * The list sorts by depth and keeps its order among equals, and the old
   * group got draw order for free because every object was new and appended
   * last. A reused object keeps whatever slot it first had, so two things at
   * one depth could swap. Once a frame, after the scene's update: everything
   * that is not the layer's stays where it was, the frame's objects go on the
   * end in the order they were asked for, and the spares are left off the
   * list entirely so they cost the sort and the renderer nothing.
   */
  private order(): void {
    const list = this.scene.children.list as Obj[];
    let w = 0;
    for (const go of list) if (!this.pooled.has(go) && !this.inFrame.has(go)) list[w++] = go;
    list.length = w;
    for (const go of this.drawn) if (go.scene) list.push(go);
    this.scene.children.queueDepthSort();
  }

  private shape<T extends Phaser.GameObjects.Shape>(s: T, x: number, y: number, fillColor?: number, fillAlpha?: number): T {
    s.setFillStyle(fillColor, fillAlpha).setStrokeStyle();
    s.setOrigin(0.5).setPosition(x, y).setScale(1).setRotation(0).setAlpha(1).clearMask();
    return this.common(s);
  }

  /** What every pooled object is reset to, whatever its kind. */
  private common<T extends Obj>(go: T): T {
    const o = go as unknown as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.Depth
      & Phaser.GameObjects.Components.BlendMode & Phaser.GameObjects.Components.ScrollFactor;
    o.setVisible(true);
    o.setDepth(0);
    o.setBlendMode(Phaser.BlendModes.NORMAL);
    o.setScrollFactor(1);
    go.setActive(true);
    return go;
  }

  private shelves(): Shelf<Obj>[] {
    return [this.images, this.rects, this.circles, this.ellipses, this.graphicses] as unknown as Shelf<Obj>[];
  }
}
