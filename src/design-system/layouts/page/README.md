# Page layout

These primitives own business-neutral content width, page heading structure,
section boundaries, spacing, inline groups, and responsive grids. Features own
the rendered text, controls, and composition decisions.

`PageHeader` takes `count` and `countLabel` on a list page: the number of
records beside the `<h1>`, outside it, so the heading keeps the page's name. The
screen shows the number; a screen reader reads it with its word ("8
applications"), and hears it change, because the count is a `status` region.
Leave `count` out while the number is unknown.
