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

/** The first required question with no answer, or `null`. */
export function firstUnansweredRequiredQuestion(questions, formData) {
    const list = Array.isArray(questions) ? questions : [];
    for (let index = 0; index < list.length; index++) {
        const field = list[index];
        if (field?.required && isEmptyCustomAnswer(field, customAnswerOf(formData, field, index))) {
            return field;
        }
    }
    return null;
}

/** The sentence a missing answer is refused with, on the page and before submitting. */
export const requiredQuestionMessage = (field) => `Please answer required question: ${field.label || 'Additional question'}`;
