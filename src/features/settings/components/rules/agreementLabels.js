/**
 * How the Agreements list names an agreement and the version in force
 * (`AgreementsPanel`).
 */

/** Abbreviations a listed title keeps in capitals. */
const ABBREVIATIONS = new Set(['MVR', 'FMCSA', 'PSP', 'DOT', 'CDL']);

/**
 * A title as the list reads it: the registry keeps a legal heading in capitals
 * (the application prints it so), and the list writes it in sentence case, as
 * C2 does: "FMCSA PSP disclosure and authorization". A title not in capitals is
 * left as written.
 */
export function listTitleOf(title) {
    if (typeof title !== 'string' || title !== title.toUpperCase()) return title;
    const words = title.toLowerCase().split(' ').map((word) => {
        const bare = word.replace(/[^a-z]/g, '').toUpperCase();
        return ABBREVIATIONS.has(bare) ? word.toUpperCase() : word;
    });
    const sentence = words.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The version in force, as the list names it: "Version 1", or the company's own wording. */
export function versionLabelOf(agreement) {
    if (agreement.currentVersion) return 'Company wording';
    const number = /^v(\d+)$/.exec(agreement.platformVersion || '');
    return number ? `Version ${number[1]}` : `Version ${agreement.platformVersion}`;
}
