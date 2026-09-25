# Fonts

Both faces are pixel fonts at a native 12 px, bundled rather than fetched from
a CDN: the game keeps working offline and nothing about the player reaches a
third party. They are loaded from `packages/game/index.html` with
`unicode-range`, so a browser downloads only the file whose glyphs a screen
actually draws.

| File | Covers | Size | Licence |
| --- | --- | --- | --- |
| `ark-pixel-12px-monospaced-latin.subset.woff2` | Latin, punctuation, arrows and geometric marks | 13 KB | OFL-1.1 (`OFL-ark-pixel.txt`) |
| `fusion-pixel-12px-monospaced-zh_hans.ttf.woff2` | Simplified Chinese | 894 KB | OFL-1.1 (`OFL.txt`, `LICENSES/`) |
| `fusion-pixel-12px-monospaced-ja.ttf.woff2` | Kana | 903 KB | OFL-1.1 (`OFL.txt`, `LICENSES/`) |

The Latin face is **subset** from Ark Pixel's `latin` build, which ships at
744 KB because it carries the shared CJK punctuation as well. An English
player would otherwise download three quarters of a megabyte to read "New
Game", so it is cut to the codepoints the UI can draw — see
`docs/fonts.md` for the range list and how to regenerate it.

Fusion Pixel takes its Latin from Ark Pixel, so the two match by design: a
line of mixed Chinese and English is one typeface, not two.
