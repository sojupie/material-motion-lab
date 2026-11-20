# Motion references

Reference curve definitions live in `internal/motion/` (re-exported by
`internal/analysis/reference.go`) and are bundled into the static browser build
as well as used by the native CLI.

Checked on 2026-10-26 against upstream Material sources:

- [MDC-Android Motion](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md) — two-segment emphasized path and easing curves.
- [Compose `MotionTokens` (v0_103)](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/MotionTokens.kt) — standard, emphasized single-Bézier approximation, legacy, and linear Béziers.
- [Compose `ExpressiveMotionTokens` (v0_14_0)](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt) — expressive springs.
- [Compose `StandardMotionTokens` (v0_14_0)](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/StandardMotionTokens.kt) — standard springs.

## Easing curves

Standard, emphasized (both MDC-Android path and Compose approximation), and
legacy each include accelerate and decelerate variants, plus linear. Duration
is independent of the easing—enter it in milliseconds or auto-fit it to a
recording. Custom Béziers take four control-point coordinates (`x` in `0–1`,
`y` may overshoot).

## Springs

Standard and expressive schemes each define fast, default, and slow spatial and
effects springs (effects parameters are identical across schemes). Editing any
parameter switches the selection to a custom spring.

The solver integrates a unit-mass damped harmonic oscillator in seconds
(underdamped, critically damped, overdamped, zero damping, and nonzero initial
velocity in normalized travel per second). Springs preserve physical timing and
overshoot—they are never truncated to `1` or duration-fitted. Reference points
are sampled every ≤ 4 ms (at least 120 segments, capped at 15,000).

## Comparing recordings

Each tracking range supplies the reference's start time, start position, and
endpoint (for springs, pick an endpoint frame after settling). Progress mode
normalizes measured displacement to `0–100%`. Custom references can be saved to
and loaded from JSON; loaded curves always become custom so edited values never
carry an official preset label.

## CLI measurement

The browser evaluates references and duration fits in its processing worker.
With the optional native CLI:

```sh
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve expressive-fast-spatial
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve emphasized --duration 500
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve spring --stiffness 380 --damping 0.8 --velocity 1.2
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve bezier --bezier 0.2,0,0,1 --duration 300
```
