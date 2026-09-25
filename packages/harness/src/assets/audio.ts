/**
 * Writing the sound set to disk.
 *
 * The sounds themselves are in `@jr/core/audio`, not here, because the
 * browser has to run the same synthesis the pipeline does — see that module
 * for why. All this file does is turn the catalogue into files and hash the
 * result, so the shipped set can be asserted byte-identical to its source.
 *
 * Sounds are synthesised rather than sourced, for the same reason the sprite
 * sheet is generated: the source of truth is a function, the output is
 * byte-reproducible, and a change is a diff in a parameter rather than a
 * binary nobody can review.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SFX_DEFS, SFX_NAMES, renderSfx, sfxManifest, toWavBytes } from "@jr/core";

export { SAMPLE_RATE, SFX_DEFS, SFX_NAMES, renderSfx } from "@jr/core";

/** The name of every file the generator writes, sorted. */
export function audioManifest(): string[] {
  return sfxManifest();
}

/**
 * Writes every variant of every effect under `dir/sfx`, removing any wav that
 * the catalogue no longer names — a renamed effect that left its old file
 * behind would ship as dead weight and pass every check.
 *
 * Returns a digest of the whole set, so the pipeline test can assert the
 * output is reproducible rather than merely present.
 */
export function generateAudio(dir: string): { files: number; digest: string } {
  const out = join(dir, "sfx");
  mkdirSync(out, { recursive: true });

  const wanted = new Set(audioManifest().map((n) => `${n}.wav`));
  for (const existing of readdirSync(out)) {
    if (existing.endsWith(".wav") && !wanted.has(existing)) rmSync(join(out, existing));
  }

  const hash = createHash("sha256");
  let files = 0;
  for (const name of SFX_NAMES) {
    for (let v = 0; v < SFX_DEFS[name]!.variants; v++) {
      const wav = Buffer.from(toWavBytes(renderSfx(name, v)));
      writeFileSync(join(out, `${name}_${v}.wav`), wav);
      hash.update(`${name}_${v}`).update(wav);
      files++;
    }
  }
  return { files, digest: hash.digest("hex").slice(0, 16) };
}
