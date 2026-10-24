# Page layout

These primitives own business-neutral content width, page heading structure,
section boundaries, spacing, inline groups, and responsive grids. Features own
the rendered text, controls, and composition decisions.

`PageHeader` takes `count` and `countLabel` on a list page: the number of
records beside the `<h1>`, outside it, so the heading keeps the page's name. The
screen shows the number; a screen reader reads it with its word ("8
applications"), and hears it change, because the count is a `status` region.
Leave `count` out while the number is unknown; with `countLabel` given, the
region stays in place, empty, so the number that arrives is announced.

The heading and description keep at least 30rem beside `actions`. With less
room, as on a tablet, the actions move under the description rather than
squeezing it; below 768px they always do, at full width. A page does not need
its own wrapping class for this.
