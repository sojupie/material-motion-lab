# Motion references

The reference list covers MD3 easing and motion schemes. Definitions live in
`internal/analysis/reference.go`; the page, HTTP API and CLI use that list.

Values were checked on 2026-10-26 against these primary sources:

- [MDC-Android motion definitions](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md): emphasized path and easing curves.
- [Compose MotionTokens, v0_103](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/MotionTokens.kt): standard, emphasized approximation, legacy and linear Béziers.
- [Compose ExpressiveMotionTokens, v0_14_0](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt): expressive spring parameters.
- [Compose StandardMotionTokens, v0_14_0](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/StandardMotionTokens.kt): standard spring parameters.

Emphasized has a two-segment path in MDC-Android and a single Bézier approximation
in Compose. Both are listed with their implementation names.

## Easing

Standard, emphasized and legacy each have accelerate and decelerate variants.
Linear is also available. The duration is independent of the easing; enter it in
milliseconds or fit it to a recording. Custom Béziers accept four control-point
coordinates. X coordinates must be within 0–1; Y coordinates may overshoot.

## Springs

Each scheme has fast, default and slow spatial and effects springs. The effects
parameters are identical across schemes. The complete parameters appear when a
spring is selected. Editing a parameter switches the selection to Custom spring.

The solver evaluates a unit-mass damped harmonic oscillator in seconds. It handles
underdamped, critically damped and overdamped motion, including zero damping and
nonzero initial velocity. Velocity is normalized travel per second: 1 means one
start-to-end distance per second in the direction of travel. Negative values move
away from the endpoint initially.

Springs retain overshoot and their physical timing. They are not truncated to 1,
rescaled to an easing duration, or duration-fitted. Reference points are spaced at 4 ms or finer across the measured interval,
with at least 120 segments. Long recordings are capped at 15,000 segments. This is a trajectory comparison, not a simulation of a platform's
visibility threshold or final-value snapping.

## Comparing recordings

The tracking range supplies the reference start time, start position and endpoint.
Each recording is normalized separately; choose an endpoint frame after settling
when measuring spring motion. Progress mode maps that measured displacement to
0–100%. Keep both recordings visible to compare an MD3 recording with an
implementation, and mark sync points to align corresponding events.

Custom references can be saved to JSON and loaded again. The file contains a
schema version, reference parameters and easing duration. Loading a spring or
Bézier makes it custom, so edited values cannot inherit an official preset label.
Imported references are validated by the same Go code used for measurement.

## API and CLI

`GET /api/references` lists preset IDs, parameters and source links.
`POST /api/references/validate` validates a reference object.
`POST /api/projects/{id}/measure` accepts `reference` alongside `axis`, `start`,
`end`, `duration` and `fit`. The existing four-number `curve` field still works.
Measurement output includes the evaluated reference, expected points and errors.

```sh
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve expressive-fast-spatial
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve emphasized --duration 500
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve spring --stiffness 380 --damping 0.8 --velocity 1.2
./scripts/run.sh measure PROJECT_ID --start 30 --end 90 --curve bezier --bezier 0.2,0,0,1 --duration 300
```
