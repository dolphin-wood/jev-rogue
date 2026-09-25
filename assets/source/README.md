# Raster art sources

Rebuild the atlas with `pnpm assets:art`. All inputs are local; no generation
service is needed to reproduce the delivery.

- `originals/characters.png`, `originals/props-boss.png`: approved originals, unchanged.
- `smooth/player.png`: staff continuity corrected across front/back/left views.
- `smooth/orbiter.png`: four-tentacle front and back views.
- `smooth/orbiter-side.png`: separately corrected four-tentacle side views.
- `smooth/telegraphs.png`: shooter, tank and summoner attack poses; orbiter row superseded.
- `smooth/boss.png`: three damage phases, normal and telegraph.
- `smooth/terrain.png`: floor, wall and spike/crumble tiles.
- `smooth/turret-chest.png`: turret normal/telegraph and chest closed/open.
- `smooth/icons-bullets.png`: door symbols, UI and projectiles.
- `smooth/characters.png` and reference crops: intermediate iterations, not final frame sources.

All new art and corrections used built-in ImageGen. Exact prompts are retained
in `prompts.json` and `icons-prompt.txt`.

The importer normalizes native alpha (painted interiors were around 253),
removes faint external matte using alpha rather than RGB colour-keying, and
uses premultiplied-alpha area resampling. It never quantizes RGB colours.
Minor idle animation uses raster translations, part motion and highlight
pulses; attack poses have separate artwork. The protected-magenta rule maps
shop stock to amber and the UI heart to red.

See `docs/art-audit.json` for the validation record.

Raw generator drafts (`*-draft.png`) are kept out of the repository. They are
the inputs of the one-off `normalize-*` scripts under `packages/harness/src/cli/`,
which turned them into the normalised sheets checked in here; rebuilding the
atlas needs only those sheets.
