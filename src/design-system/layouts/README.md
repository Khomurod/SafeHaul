# Layouts

Layouts define page, content, panel, stack, and responsive region geometry.
They receive rendered content and do not own navigation permissions, feature
flags, routes, or business state.

`workspace/` owns application-shell geometry and accessible off-canvas
navigation behavior. `page/` owns content width, heading, section, stack,
inline, and responsive-grid geometry.

`Stack` and `Inline` take `gap` `sm` (8px), `md` (16px, the default), `lg`
(24px, between groups inside a section) and `xl` (32px, between whole sections
of a page, as the C2 settings pages space them).
