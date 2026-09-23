# jev-rogue

A top-down bullet-hell room roguelike whose Director is [Jev](https://docs.typesafe.ai/), TypeSafe AI's choice-only decision model.

**Decisions are Jev's, generation is the algorithm's.** Every procedural generator a roguelike normally has is kept. What Jev replaces is the parameter-decision layer that weight tables and hand-written rules used to own, sitting between a constraint layer and a generate-and-verify layer, both of which stay in code. Jev never writes text, never computes a number, never places a tile. It picks semantic parameters among options code has already proved legal, fair and in budget, and code samples from the distribution it returns.

The design is specified in [`docs/planning/`](docs/planning/); start at [001](docs/planning/001-vision-and-scope.md) and [002](docs/planning/002-jev-integration-principles.md).

## Verify

The repository is built to prove itself. Nothing below needs a network, an API key or a browser.

```sh
pnpm install
pnpm verify          # typecheck, then every test, then the asset spec
```

Individually:

| Command | Checks |
|---|---|
| `pnpm typecheck` | TypeScript strict across every package |
| `pnpm test` | 390 unit and property tests |
| `pnpm assets:check` | the sprite delivery against `docs/asset-spec.md`, and writes `assets/palette.json` |
| `pnpm content:check` | the doc 010 content rules over every library, plus the build-time staff and affix resolutions |
| `pnpm harness` | headless balance: room generation, encounter assembly, staff spread and charter compliance |
| `pnpm assets:art` | packs the approved raster source art at 2× world resolution and validates the delivery |
| `pnpm assets:art` | rebuilds the sprite sheet from `assets/source/`, then checks it |
| `pnpm assets:placeholder` | regenerates the procedural placeholder sheet |
| `pnpm build` | production bundle |
| `pnpm dev` | runs the game locally |

The asset checker is itself covered by tests that assert it accepts a valid sheet and rejects one deliberately broken example of every rule, so a green run means the checker works, not only that the art passed.

The harness reports numbers rather than only a verdict, because a preset rate or a relax rate is something a designer acts on:

```
rooms:      480 generations, 0.00% relaxed, 0 authored fallbacks, 0 invalid
encounters: 6912 assemblies, 0 out of band, 0 concurrency breaches
staffs:     24 profiles, reference dps 9.4 to 22.7, spread 2.42x
charter:    200 adversarial runs, worst showcase ratio 40.0%, 0 breaches
```

## Layout

```
docs/planning/    numbered design decisions; the specification
docs/asset-spec.md  sprite contract and the per-asset drawing prompts
assets/           sprites.png, sprites.json; palette.json is generated
packages/core     simulation, generators, summarizers, samplers; no DOM, no Phaser
packages/director Director interface, Jev evaluator, rule and random controls, traces
packages/harness  asset checker, content rules, balance harness, CLIs
packages/game     Phaser client: rendering and input only, owns no game state
server/worker.ts  stateless proxy that holds the API key
```

`core`, `director` and `harness` never import Phaser or a DOM API, which is what lets the balance harness and the staff simulator run the same code the game runs rather than an approximation of it.

## Running against Jev

The game logic runs entirely in the browser. One stateless proxy exists outside it for two reasons: `TYPESAFE_API_KEY` must not ship in client code, and TypeSafe rejects browser origins by CORS, so a page cannot call the API directly whatever key it holds.

```sh
echo 'TYPESAFE_API_KEY=...' >> .env.local
pnpm dev
```

In development Vite proxies `/api/decide` and adds the key. Hosted, the game is a static bundle and the proxy is a Cloudflare Worker (`server/worker.ts`); see [009](docs/planning/009-technical-architecture.md).

Building with `DIRECTOR_DEFAULT=random` or `rule` produces a fully static site that never calls Jev, which is also how the blind test's control arms run.

## Art

`pnpm assets:art` packs the approved raster artwork from `assets/source/` using the reproducible pipeline in `packages/harness/src/assets/art.ts`. Source PNGs, drawing prompts and the original reference sheets are retained. The pipeline normalizes native alpha, crops and centres sprites, resamples with premultiplied-alpha area filtering, and derives subtle idle animation frames. It never quantizes colours or substitutes geometric artwork.

The 436-frame melee delivery is `assets/sprites.png` plus `assets/sprites.json`. It matches `assets/source/style-reference.png` at twice world resolution (64px characters, 96px heavy enemies, 256px bosses). The player's long straight sword is a separate magic weapon that hovers in front of the body, so the visible steel can follow the live reach and rotation without deforming the character. The rusher has a separate hooked monster claw and cannot be mistaken for the player's sword. Hit reactions, deaths and the companion walk use drawn poses rather than shifted or compressed idle frames. The off-hand flame is a separate four-frame overlay, lightning uses three bottom-anchored 64x128 frames, and ground fire uses four drawn silhouettes. Room mood uses cached HSL transforms; enemy bullets stay entirely in the protected magenta band. `pnpm assets:placeholder` remains available for diagnostic stand-ins.
