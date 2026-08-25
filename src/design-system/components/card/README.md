# Card and MetricCard

`Card` owns shared surface, border, radius, elevation, and padding.
`MetricCard` displays a generic label/value/icon and optionally behaves as a
native button. Features select the semantic tone and own navigation or action
callbacks.

## One surface geometry

`Card` reads its radius, border, shadow and padding from the surface-geometry
roles in `tokens/semantic.css` rather than choosing values here:

| Role | Used for |
|---|---|
| `--ds-card-radius` | Corner radius of any card-like surface |
| `--ds-card-border` / `--ds-card-shadow` | Its edge and elevation |
| `--ds-card-padding` | `padding="md"`, the default |
| `--ds-card-padding-compact` | `padding="sm"` |
| `--ds-card-padding-spacious` | `padding="lg"` |

The roles exist so that a feature-owned panel which genuinely cannot be a `Card`
still matches one. Reference the role — or the `p-ds-card` / `rounded-ds-card`
Tailwind utilities that bridge it — instead of copying four values and getting
one of them wrong. Cards that each picked their own `p-4` / `p-6` /
`rounded-lg` were visibly different sizes beside one another on the same screen.

`MetricCard`'s icon chip uses `--ds-metric-icon-size`, **not** the control
height. It is an illustration inside a card, not something you press, and it
silently grew when the control scale's `md` step moved from 40px to 44px.
