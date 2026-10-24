/**
 * The table-layout measurement, shared by the catalog check
 * (`scripts/check-table-layout.mjs`) and the application screens
 * (`e2e/table-layout.spec.cjs`), so both hold tables to one rule.
 *
 * It is handed to `page.evaluate`, which sends its source to the page: it must
 * stay one self-contained function that closes over nothing.
 */

/**
 * Runs inside the page. Returns the violations found in this render, plus how
 * many populated tables were actually measured — the caller treats "measured
 * nothing anywhere" as a failure rather than a clean result.
 *
 * Kept as a single serialisable function so the measurement lives in one place
 * and is the same at both viewports.
 */
function measureTables() {
    const findings = [];
    let tableCount = 0;

    /*
     * Both approved table contracts are measured.
     *
     * `DataTable` owns its own scroll region, so the dead-gutter invariant is
     * about that element. `ds-native-table` — the contract every approved
     * native table applies — deliberately has no scroll container:
     * a native table is chosen when the feature owns the row's interaction, and
     * the feature owns its overflow too. So its own element is the subject, and
     * only the cell-containment invariant applies to it.
     *
     * Without the second selector no native table is measured ANYWHERE: only
     * the catalog's `DataTable` stories would be.
     */
    const subjects = [
        ...Array.from(document.querySelectorAll('.ds-data-table'), (root) => ({
            region: root.querySelector('.ds-data-table__scroll-region'),
            checkGutter: true,
        })),
        ...Array.from(document.querySelectorAll('table.ds-native-table'), (table) => ({
            region: table,
            checkGutter: false,
        })),
    ];

    for (const { region, checkGutter } of subjects) {
        if (!region) continue;
        // An async/empty state renders the shell with no cells. Counting only
        // regions that actually contain a row keeps the "did we measure
        // anything" assertion meaningful.
        if (region.querySelector('td, th')) tableCount += 1;

        // Invariant 2 — space reserved at the edge that the table cannot paint.
        if (checkGutter) {
            const reserved = region.offsetWidth - region.clientWidth;
            const scrollsVertically = region.scrollHeight > region.clientHeight + 1;
            if (reserved > 1 && !scrollsVertically) {
                findings.push({
                    kind: 'dead-gutter',
                    detail: `${reserved}px reserved at the edge of a region that does not scroll vertically`,
                });
            }
        }

        // Invariant 1 — every cell contains its content.
        for (const cell of region.querySelectorAll('td, th')) {
            if (cell.getAttribute('data-truncate') === 'true') continue;
            const over = cell.scrollWidth - cell.clientWidth;
            if (over <= 1) continue;
            findings.push({
                kind: 'cell-overflow',
                width: cell.getAttribute('data-width') || 'auto',
                over,
                box: cell.clientWidth,
                needs: cell.scrollWidth,
                text: (cell.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 56),
                detail: `content needs ${cell.scrollWidth}px in a ${cell.clientWidth}px column`,
            });
        }
    }
    return { findings, tableCount };
}

module.exports = { measureTables };
