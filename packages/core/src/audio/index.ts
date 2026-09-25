/**
 * Audio, as a pure library.
 *
 * The synthesis kit, the effect catalogue and the score all live in core for
 * one reason: the browser and the offline pipeline must run *the same code*.
 * The harness writes `assets/sfx/*.wav` from this catalogue and measures what
 * it wrote; the client plays those files and renders the music from this
 * score, note by note, at runtime. Nothing here touches an `AudioContext`, a
 * file system or `Math.random`.
 */
export * from "./dsp.ts";
export * from "./sfx.ts";
export * from "./spell-sfx.ts";
export * from "./music.ts";
export * from "./mix.ts";
