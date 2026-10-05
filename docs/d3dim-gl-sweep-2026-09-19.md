# D3DIM: WebGL executor vs the WAT software rasterizer, 2026-09-19

First corpus-wide comparison of `lib/d3dim-gpu.js` against the software D3DIM
path, run with `tools/d3dim-mode-sweep.js` on the Mac (`caffeinate -d -u`,
headless GL in Node — no browser). Sixteen DX2-7 apps, three runs each plus a
control:

| arm | flags | what it is |
|---|---|---|
| `sw` | none | what the app shows today |
| `glsw` | `--headless-gl` | a GL context exists, WAT still rasterizes |
| `glgpu` | `--headless-gl --d3dim-gpu` | the executor draws |
| control | none | `sw` again, for the null band |

**The executor's verdict is `glsw` vs `glgpu`.** That split is not pedantry: on
dx_twist the GL run differs from software by **71.9% of pixels while the
executor reported `draws=0`**, so every one of those pixels belongs to asking
for a GL context and none to the executor. A two-arm sweep charges it to the
wrong arm and reports a rendering catastrophe that does not exist.

## Results

| app | verdict | executor diff | GL-context diff | null band | GL draws | fallbacks |
|---|---|---|---|---|---|---|
| dx_boids | IDENTICAL | 0% | 0% | 0% | 211 | 650 |
| dx_flip3dtl | IDENTICAL | 0% | 0% | 0% | 666 | 0 |
| mw3 | IDENTICAL | 0% | 0% | 0% | 26 | 0 |
| gta2_demo | **DIFFERENT** | **0.7223%** | 0% | 0% | 72373 | 0 |

(The gta2 row reads 0.2744% on a build after the vertex-rounding fix below; the
0.7223% is what the first sweep measured and what the chase started from.)
| dx_twist | NODRAW-DIFF | 71.9118% | 71.9111% | 0.0322% | 0 | 0 |
| dx_tunnel | NODRAW-DIFF | 0.0163% | 0.0153% | 0.0098% | 0 | 0 |
| dx_globe, dx_viewer, mcm, jazz2_demo, heroes3_demo, darkstone_demo, spider, pocket_tanks, captain_claw_demo, aoe2 | NODRAW | 0% | 0% (spider 5.78%, = its own null band) | 0% | 0 | 0 |

Budgets: 800 batches/25s for the DX samples and MCM, 6000/45s for the games,
4000/35s for the rest.

## What it says

**Where the executor ran, it agrees.** Three apps drew through it and came back
pixel-identical, including MechWarrior 3, and no app crashed only on the GL arm.

**GTA2 is the one real disagreement** — 72,373 draws, zero fallbacks, 0.72% of
pixels, against a null band of 0%, with the changed box at `300,255 133x218`:
the main menu's PLAY/OPTIONS/QUIT text. It is the only app in the corpus that
puts a five-figure draw count through the executor, so it is also the only one
whose agreement is worth much. **It was our software rasterizer that was
wrong** — see below.

## The GTA2 row, chased (same day)

The disagreement is a rasterization-convention difference, and the executor was
the one following D3D.

`$d3dim_coord_i` converted each pre-transformed vertex to an integer pixel with
`i32.trunc_sat_f32_s`, so a vertex at x=300.6 landed on pixel 300 — every
fractional vertex biased half a pixel up and to the left. GL keeps the float
position and covers a pixel when the edge passes its *centre*, which is what
D3D specifies.

Measured, in this order:

1. Snapping the executor's vertices with `Math.trunc` before upload — a probe,
   not a change — took the diff from **2219 to 639 pixels**. So ~71% of it was
   the snapping and the rest is elsewhere.
2. Rounding instead of truncating in `$d3dim_coord_i` took the *software* arm
   from **0.7223% to 0.2744%** against the unchanged executor.
3. Gate: every other app in the corpus that draws D3DIM triangles — dx_boids,
   dx_flip3dtl, MechWarrior 3, MechCommander — is **pixel-identical** either
   way. They put their vertices on integers, where the two agree.

What is left (0.27%) is `$viewport_draw_textured_span` interpolating u/v at
pixel *corners* — it walks `(x - x0) / (x1 - x0)` over integer endpoints — plus
a one-step 565 rounding difference worth ~52 pixels (the diff only falls from
2219 to 2167 as tolerance goes 0 → 8, so quantization was never the story).
Moving the span to pixel centres is a separate change with its own sweep.

`test/test-d3dim-indexed-texture.js` moved three probes for this: they read
pixel 0 of a strip whose left edge comes from a far-plane-clipped fractional
vertex, and only truncation's bias ever covered it. The probes now read the
strip's interior, and one new assertion holds column 0 clear, so a regression
to truncation fails there.

**Eleven of sixteen apps never drew a triangle.** A headless startup slice
reaches a 2D menu, not gameplay; most of these need input to get into a 3D
scene. `NODRAW` is reported as its own verdict rather than folded into
IDENTICAL for exactly that reason: it is absence of coverage, not evidence of
agreement. Extending this sweep means giving each app a deterministic route to
its first 3D frame (the `test-mw3-gameplay.js` pattern), not a longer budget.

**`--headless-gl` alone changes what dx_twist shows.** 71.9% of pixels, against
a 0.03% null band, with no executor involved. That is a finding about the
headless GL path, filed here because this sweep is where it turned up.

## Running it

```
node tools/d3dim-mode-sweep.js --all --control --md=/tmp/sweep.md
node tools/d3dim-mode-sweep.js --apps=gta2_demo --batches=6000 --seconds=45 --control
```

Captures land in `build/d3dim-mode-sweep/<app>-{sw,glsw,glgpu,sw2}.png`, so any
row can be re-diffed by hand with `tools/png-diff.js --out=`.

## Extended, 2026-09-20

[docs/d3d-backend-coverage.md](d3d-backend-coverage.md) drove four of these
apps to actual gameplay on both backends and found three things this table
cannot show:

- `mcm` NODRAW was a modal ("test your video memory"), not an absence of 3D.
  With `200:dlg-cmd:1` it races on both backends.
- `mw3` IDENTICAL/0% was a menu. At gameplay the two arms differ by 4.07% of
  pixels at tolerance 32 against a 0.026% null band, with the terrain green on
  software and brown on the executor.
- `dx_boids` and `dx_flip3dtl` IDENTICAL/0% are two **blank** frames agreeing:
  the composited screen is one distinct colour (boids) or black plus a text
  overlay (flip3dtl) while the executor reports tens of thousands of draws. A
  diff-only method cannot tell that apart from agreement; check the frame's
  distinct-colour count (`tools/png-inspect.js stats`) before reading a verdict.
- `dx_globe`/`dx_viewer` NODRAW is a modal `D3DRMERR_BADFILE` on `sphere3.x` /
  `camera.x` — the `.x` loader asset gap, not a renderer question.
