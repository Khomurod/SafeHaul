/**
 * The answer options of a company question that an applicant can be shown.
 *
 * An option is a string, or `{ value, label }`. One with no text is no answer at
 * all: a radio or checkbox needs a label (the design system refuses one without),
 * and the server's application definition already drops blanks
 * (`normalizeCustomQuestion` in `functions/shared/applicationDefinition.js`).
 * The questions editor leaves one behind when an option's text is cleared.
 */
const optionText = (option) => String(
    option !== null && typeof option === 'object' ? option.label ?? option.value ?? '' : option ?? '',
).trim();

/** The options with text, in their order. */
export function shownOptions(options) {
    return (Array.isArray(options) ? options : []).filter((option) => optionText(option) !== '');
}

/** The company's questions as they are saved: every option without text dropped. */
export function withoutBlankOptions(questions) {
    return (Array.isArray(questions) ? questions : []).map((question) => (
        Array.isArray(question?.options) ? { ...question, options: shownOptions(question.options) } : question
    ));
}
