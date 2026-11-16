// A company's own questions: which answer is a question's, and whether a
// required one has been answered. The custom-questions page asks before it moves
// on, and the final pre-flight asks again, since a resumed draft, or a question
// the company made required after the driver passed the page, never ran it.

/** The key a question's answer is stored under: its id, else its key, else its place. */
export const customQuestionKey = (field, index) => field.id || field.key || `custom-question-${index}`;

/** The answer as stored: in `customAnswers`, else flat under the same key (older drafts). */
export function customAnswerOf(formData, field, index) {
    const key = customQuestionKey(field, index);
    const answers = formData?.customAnswers;
    if (answers && answers[key] !== undefined) return answers[key];
    return formData?.[key];
}

const isBlankText = (value) => typeof value === 'string' && value.trim() === '';

/** No answer: nothing, only spaces, or no ticked box with any wording. */
export function isEmptyCustomAnswer(field, value) {
    if (field.type === 'checkboxes') {
        return !Array.isArray(value) || value.every((choice) => choice == null || isBlankText(choice));
    }
    return value === undefined || value === null || value === '' || isBlankText(value);
}

/** Every required question with no answer, with its place, in the order they are asked. */
function unansweredRequired(questions, formData) {
    const list = Array.isArray(questions) ? questions : [];
    return list.flatMap((field, index) => (
        field?.required && isEmptyCustomAnswer(field, customAnswerOf(formData, field, index)) ? [{ field, index }] : []
    ));
}

/** The key of every required question with no answer, in the order they are asked. */
export const unansweredRequiredQuestionKeys = (questions, formData) => unansweredRequired(questions, formData)
    .map(({ field, index }) => customQuestionKey(field, index));

/** The first required question with no answer, or `null`. */
export const firstUnansweredRequiredQuestion = (questions, formData) => (
    unansweredRequired(questions, formData)[0]?.field ?? null
);

/**
 * The sentence the final pre-flight refuses a missing answer with, as a toast on
 * whatever page Submit was pressed. The questions page says
 * `unansweredQuestionMessage` under the question itself.
 */
export const requiredQuestionMessage = (field) => `Please answer required question: ${field.label || 'Additional question'}`;

/** What the page says under a required question it refuses for having no answer. */
export function unansweredQuestionMessage(field) {
    if (field?.type === 'fileUpload') return 'Please upload a file.';
    if (field?.type === 'checkboxes') return 'Please choose at least one.';
    return 'Please answer this question.';
}
