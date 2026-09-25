/**
 * How far the boot download has got, by bytes rather than by files.
 *
 * Phaser's own `progress` counts files: `sprites.png` is one file in about
 * two hundred but three quarters of the bytes, so that bar ran to 99% in the
 * first second and then sat still for as long as the sheet took. Each file
 * here counts for its size instead, as its response reports it. A file whose
 * size is not known yet — still queued, or served without a length — counts
 * as a typical small file (the median of the sizes seen so far), which is
 * what the queue's tail mostly is.
 *
 * The figure never goes backwards: learning that a file is bigger than
 * assumed slows the bar down rather than pulling it back.
 */
export class LoadProgress {
  private readonly files = new Map<string, { loaded: number; total: number; done: boolean }>();
  private shown = 0;

  /** A file in the queue, before any of it has arrived. */
  add(key: string): void {
    if (!this.files.has(key)) this.files.set(key, { loaded: 0, total: 0, done: false });
  }

  /** A progress report for one file; `total` is 0 while the size is unknown. */
  update(key: string, loaded: number, total: number): void {
    const f = this.files.get(key) ?? { loaded: 0, total: 0, done: false };
    f.loaded = Math.max(f.loaded, loaded);
    f.total = Math.max(f.total, total);
    this.files.set(key, f);
  }

  /** The file has arrived, whole or failed; either way nothing more is coming. */
  finish(key: string): void {
    const f = this.files.get(key) ?? { loaded: 0, total: 0, done: false };
    f.done = true;
    // Served without a length, the bytes that came are its size.
    if (f.total <= 0) f.total = f.loaded;
    this.files.set(key, f);
  }

  /** 0..1, monotonic. */
  value(): number {
    if (this.files.size === 0) return this.shown;
    const known = [...this.files.values()].map((f) => f.total).filter((t) => t > 0).sort((a, b) => a - b);
    const typical = known.length > 0 ? known[Math.floor(known.length / 2)]! : 1;
    let have = 0;
    let want = 0;
    for (const f of this.files.values()) {
      const size = f.total > 0 ? f.total : typical;
      want += size;
      have += f.done ? size : Math.min(size, f.loaded);
    }
    this.shown = Math.max(this.shown, want > 0 ? have / want : 0);
    return this.shown;
  }
}
