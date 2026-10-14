/**
 * The owner panel's CSV exports: one way to write a cell and one way to save the
 * file, so every export opens the same in a spreadsheet.
 */

/**
 * Escapes one CSV cell.
 *
 * **The leading apostrophe is not decoration.** A spreadsheet treats a cell
 * beginning `=`, `+`, `-` or `@` as a formula, so `=HYPERLINK(...)` typed into a
 * company or lead name runs when an operator opens the export. Prefixing those
 * with `'` makes the cell text. Quote-doubling handles the ordinary case of a
 * comma or quote in a field.
 */
export function csvCell(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
}

/** Rows of cells as CSV text: every cell escaped, CRLF between rows (RFC 4180). */
export function toCsvText(rows) {
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Saves CSV text as a file.
 *
 * A BOM, so Excel reads the file as UTF-8 rather than the local codepage: without
 * it an accented name arrives mangled. A Blob, not a `data:` URL: `encodeURI`
 * leaves `#` as it is, so a `data:` URL ended at the first `#` in a name, and the
 * rest of the file was dropped as the URL's fragment.
 */
export function downloadCsv(filename, text) {
    const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
