# Progress

`ProgressBar` is the determinate progress primitive: it owns the track, the fill,
the tone and the ARIA `progressbar` semantics.

```jsx
<ProgressBar labelledBy="step-title" value={4} max={9} tone="info" valueText="Step 4 of 9: …" />
```

Contracts:

- A name is mandatory — pass `label` for an `aria-label`, or `labelledBy` when a
  visible heading already names the thing being measured (the public
  application's wizard points at its `#step-title` heading).
- `value` is clamped to `[0, max]` for both the rendered fill and
  `aria-valuenow`, so a caller cannot produce a bar that overflows its track or
  an out-of-range value.
- `max` is not required to be 100. The public application passes the step count
  directly, which keeps `aria-valuenow` meaningful ("4 of 9") instead of a
  percentage a screen-reader user has to convert.
- `valueText` sets `aria-valuetext` when a percentage is not the useful reading.
- `tone` (`info` | `success` | `warning` | `danger`) is presentation only.
  **Tone is never the only signal**: callers must supply text elsewhere that says
  what state the progress is in. Features own the domain → tone mapping.
- The fill transition is disabled under `prefers-reduced-motion: reduce`.

Indeterminate progress, buffered progress and circular meters are not
implemented. Do not add a local variant — record the gap in the roadmap first.
