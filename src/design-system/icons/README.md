# Icons

**This directory is a placeholder.** It exports nothing today: there is no `Icon`
component and no glyph set, and icons are imported directly from `lucide-react`
at 178 call sites across the product. Anything that says this directory "exports
the approved icon contract" is describing the intention below, not the code.

What the contract will define when it is built: approved sizes, stroke
treatment, accessible-name rules (a decorative glyph is `aria-hidden`; a
meaningful one carries a name), and business-neutral exports so call sites stop
naming a third-party package directly.

Branded artwork — the SafeHaul mark and the loader — remains an explicit
exception and must not be approximated with generic icons.
