# Layouts

Layouts define page, content, panel, stack, and responsive region geometry.
They receive rendered content and do not own navigation permissions, feature
flags, routes, or business state.

`workspace/` owns application-shell geometry and accessible off-canvas
navigation behavior. `page/` owns content width, heading, section, stack,
inline, and responsive-grid geometry.
