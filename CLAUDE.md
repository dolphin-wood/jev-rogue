# jev-rogue

## Looking at the game

**Do not start a dev server of your own** (`pnpm dev`, `vite`, a preview
server). One debug server runs per machine, started by a person, and every
session shares it:

```bash
pnpm dbg serve   # the user runs this once, in their own terminal
```

If `pnpm dbg state` reports no server, ask the user to start it; do not work
around it. The server runs Vite and a headless browser, so it draws whether
or not anyone is watching and it sees every edit.

Drive it with `pnpm dbg` (`packages/harness/src/cli/dbg.ts`):

```bash
pnpm dbg open "lab=fight&foes=tank,tank:armored,warden"
pnpm dbg eval "__lab.freeze(); __lab.place(0, 200, 300); __lab.set(0, { poise: 12 })"
pnpm dbg eval "await lab.advance(1)"
pnpm dbg shot --around 0 --scale 3 --out local/dbg/tank.png
pnpm dbg logs --errors
```

Then read the PNG. Shots go under `local/` (git-ignored).

- **Scenes by URL.** `?lab=fight` starts a run with no menus: `style=`,
  `room=`, and `foes=` (a comma list of bodies, elite affixes after colons)
  in place of the room's own. Also `?lab=boss`, `?lab=spells`,
  `?lab=audience`, `?seed=`, `?floor=`.
- **Posing a scene.** `window.__lab` (`PlayScene.labApi`): `ready`,
  `freeze`, `advance(steps)`, `frames(n)`, `invincible`, `bodies`, `player`,
  `place`, `set`, `movePlayer`, `toScreen`, and `world()` for anything else.
  Freeze before posing, or the bodies walk off the pose before the shot.
