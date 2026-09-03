# missile-puncher

Punch missiles. The smallest playable test of one question: *is it
satisfying to move into position and punch an incoming cruise missile back
the way it came?*

Play it live: **https://katmore.github.io/missile-puncher/**

This repo is the runtime source only — a filtered export kept in sync by
hand from a private development repo, so history here starts fresh and
occasionally jumps.

## Run

```bash
npm install
npm run dev
```

## Controls

Start screen: GUY and GAL stand on random sides; the cursor defaults to
whoever is on the **left**. ← → picks a side, punch begins.

| Key | Action |
|---|---|
| ← → (or A / D) | Move and face |
| Z / Space / J | Punch |
| `` ` `` | Toggle debug overlay |
| R | Restart the attempt loop (tally is kept) |

On touch devices (phones/tablets), controls are automatic: drag anywhere to
move, tap to punch.

## Build

```bash
npm run build   # dist/, multi-file
npm run demo    # dist/index.html, single self-contained file
```

## Layout

- `src/engine/` — fixed-timestep loop, integer/fractional-scaled backbuffer, input, WebAudio synth, AABB.
- `src/game/` — `puncher`, `missile`, `effects` (hit-stop / shake / flash / shockwave), and `game` (collisions + attempt loop).
- `src/render/` — sprite sheets, compositor, static desert background, HUD / start screen, debug overlay.
- `tools/gen-sprites.mjs` — regenerates the placeholder PNG sheets in `src/assets/`.
