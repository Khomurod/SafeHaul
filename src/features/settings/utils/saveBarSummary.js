/**
 * What a settings page's save bar says changed, in the words of the catalog's
 * `Patterns/Save bar` example: "1 change · Full Name",
 * "2 changes · SMTP Host, Signature".
 *
 * @param {string[]} labels the names of the fields that differ from what is saved, in page order
 * @returns {string}
 */
export function saveBarSummary(labels) {
    if (labels.length === 0) return 'Unsaved changes';
    return `${labels.length} ${labels.length === 1 ? 'change' : 'changes'} · ${labels.join(', ')}`;
}
