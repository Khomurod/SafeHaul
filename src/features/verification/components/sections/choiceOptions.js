/**
 * The answers the portal's choice questions offer, and the value each one sends.
 *
 * The response is the previous employer's signed record, and the server and the
 * PDF read these values as they are: Yes/No as booleans, return-to-duty as
 * 'yes' / 'no' / 'in_progress'. A radio's DOM `value` is only ever their string
 * form; what is saved is `value` itself, passed straight to `updateField`.
 *
 * A required question's radios carry `aria-required` but never the native
 * `required`: the form runs its own validation and shows "Required" under the
 * question, and the browser's own check would stop the submission first.
 */
export const YES_NO_OPTIONS = Object.freeze([
    { value: true, label: 'Yes' },
    { value: false, label: 'No' },
]);

export const NO_RECORD_OPTIONS = Object.freeze([
    { value: true, label: 'Yes' },
    { value: false, label: 'No / No Record Found' },
]);

export const RETURN_TO_DUTY_OPTIONS = Object.freeze([
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
    { value: 'in_progress', label: 'In Progress' },
]);
