/**
 * A free-text value made safe to sit inside a DOM id.
 *
 * The HTML spec forbids ASCII whitespace in an `id`, and anything that builds a
 * CSS selector from one — axe-core when it names the element in a finding, a
 * test's `querySelector('#…')` — reads `#a b` as two selectors. `EXPERIENCE_OPTIONS`
 * carries values such as "0-6 months", and three components interpolated them
 * straight into ids. happy-dom 20.4+ refuses the selector axe builds from such an
 * id and axe never returns, which is how the defect surfaced on 2026-09-06 when
 * the dependency update landed; the ids were invalid HTML all along.
 *
 * Keeps `[A-Za-z0-9_-]` and collapses every other run of characters into one
 * `-`, so "0-6 months" becomes "0-6-months" while "yes" stays "yes" — the E2E
 * specs click `label[for="consent-mvr-yes"]`, so an already-safe value must not
 * change.
 *
 * Not injective: "a b" and "a-b" map to the same segment. Option values within
 * one group are distinct words here, and a collision would be a duplicate id
 * the group's own tests would catch — do not lean on this for arbitrary user text.
 *
 * @param {string|number} value
 * @returns {string}
 */
export function domIdSegment(value) {
    return String(value).replace(/[^A-Za-z0-9_-]+/g, '-');
}
