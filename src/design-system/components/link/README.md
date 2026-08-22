# Link, ButtonLink and IconButtonLink

Navigation. A link navigates; a button acts.

That distinction is not cosmetic. It decides the announced role, whether Enter
or Space activates the control, and whether the browser offers "open in a new
tab" and "copy link address". **Do not style a `<button>` as a link to get the
look, and do not give an `<a>` an `onClick` and no `href` to get a button** —
assistive technology announces the lie in both directions.

| Component | Shape | Use for |
|---|---|---|
| `Link` | Inline, underlined | A link inside a sentence or beside body text |
| `ButtonLink` | The `Button` shape | A navigation presented as a primary or secondary action |
| `IconButtonLink` | The `IconButton` shape | An icon-only navigation. `label` required |

## `external` is why these exist

Before them, eleven styled `<a>` elements had accumulated with four different
underline treatments, three different focus treatments, one raw
`text-blue-600` — and, in **every** external case, no announcement that the link
opens a new tab. That is a WCAG 3.2.5 failure, and it is genuinely
disorienting: a screen-reader or magnifier user does not notice the context
switch and simply loses the page.

`external` sets `target="_blank"`, sets the `rel="noopener noreferrer"` that
closes the reverse-tabnabbing hole, and appends a visually-hidden
"(opens in a new tab)". On `IconButtonLink` the hint folds into `aria-label`
instead, because an icon-only link has no visible text to append to.

Do not hand-write `target="_blank"`. Pass `external`.

## Appearance

`Link` is **underlined at all times**. Removing the underline and relying on
colour alone fails WCAG 1.4.1 anywhere the link sits inside body text — "it is
blue" is not a distinction every reader can make. `tone="quiet"` inherits the
surrounding colour for a link inside already-coloured text (a status message, a
tinted callout) and keeps the underline, which is then what distinguishes it.

`ButtonLink` reuses `Button.css` outright, so it takes the same control height,
padding, icon size and focus ring from the shared control scale. A "Download"
link beside a "Delete" button is exactly the same size and shape as it, which is
the point.

## No `disabled`, no `loading`

An anchor cannot be either. `disabled` on an `<a>` does nothing, and a
"disabled" link that still navigates is worse than no link. A navigation that is
unavailable should not be rendered as a link — render the reason instead.

## What features still own

The destination, the words, and whether the link is shown at all. A feature must
not restyle these, and must not reintroduce a local `<a className="...">` — that
is what this replaces.
