/**
 * The longest free-text answer the server accepts: `submitVerificationResponse`
 * (`functions/employmentVerification/responses.js`) refuses violation details,
 * accident details and additional comments over this many characters.
 */
export const TEXT_ANSWER_MAX_LENGTH = 2000;
