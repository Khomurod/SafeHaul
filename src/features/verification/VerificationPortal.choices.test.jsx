/**
 * The portal's choice questions, as a previous employer answers them.
 *
 * The response is a signed legal record, so what each choice sends is pinned
 * here: Yes/No reach the server as booleans, the return-to-duty answer as
 * 'yes' / 'no' / 'in_progress', an unanswered optional question as null, and
 * the response carries exactly the keys it always has. Also pinned: an
 * unanswered required question says "Required" under itself and stops the
 * submission (the browser's own validation never takes over), and every
 * question can be answered from the keyboard without leaving its group.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial data only — no real tokens, drivers, or employers.
const VALID = {
    status: 'pending',
    requestNumber: '9f8e7d6c',
    applicantName: 'Artificial Applicant',
    companyName: 'Artificial Requesting Carrier',
    employmentStartDate: '2020-02-02',
    employmentEndDate: '2023-03-03',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

const callables = vi.hoisted(() => ({
    getVerificationRequest: vi.fn(async () => ({ data: VALID })),
    submitVerificationResponse: vi.fn(async () => ({ data: { ok: true } })),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => callables[name],
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/services/requestNewLink', () => ({ requestNewLink: vi.fn() }));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: false,
    getE2EQueryParam: () => '',
}));
vi.mock('@shared/components/signature/SignaturePad', () => ({
    SignaturePad: ({ onSignatureChange }) => (
        <button type="button" onClick={() => onSignatureChange('data:image/png;base64,artificial-sig')}>
            Mock sign
        </button>
    ),
}));

import { VerificationPortal } from './VerificationPortal';

const EMPLOYED = /Was this individual employed by your company\?/;
const REHIRE = /Eligible for Rehire/;
const FMCSRS = /Federal Motor Carrier Safety Regulations/;
const DOT = /DOT drug & alcohol testing/;
const VIOLATIONS = /DOT drug or alcohol violations/;
const RETURN_TO_DUTY = /return-to-duty process/;
const ACCIDENTS = /DOT-recordable accidents/;
const OTHER_ACCIDENTS = /not DOT-recordable/;

/** Every key the response has always carried; the server and the PDF read these. */
const RESPONSE_KEYS = [
    'accidentDetails', 'additionalComments', 'completedReturnToDuty', 'confirmedEndDate',
    'confirmedStartDate', 'eligibleForRehire', 'followUpTestingPlan', 'hadAccidents',
    'hadDrugAlcoholViolations', 'hadNonRecordableAccidents', 'nonRecordableAccidentDetails',
    'positionHeld', 'reasonForLeaving', 'rehireExplanation', 'respondentEmail', 'respondentName',
    'respondentPhone', 'respondentTitle', 'signatureData', 'signatureMethod', 'subjectToDotTesting',
    'subjectToFmcsrs', 'violationDetails', 'wasEmployed',
];

const group = (name) => screen.getByRole('group', { name });
const option = (groupName, label) => within(group(groupName)).getByRole('radio', { name: label });

async function renderLoadedForm() {
    render(
        <MemoryRouter initialEntries={['/verify/token-xyz']}>
            <Routes>
                <Route path="/verify/:token" element={<VerificationPortal />} />
            </Routes>
        </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: /Previous Employment Verification/i });
}

/** Click each choice in order, filling the text a choice makes required. */
function answer(steps) {
    for (const [groupName, label] of steps) {
        fireEvent.click(option(groupName, label));
        if (groupName === EMPLOYED && label === 'Yes') {
            fireEvent.change(screen.getByLabelText(/Confirmed Start Date/), { target: { value: '2021-01-01' } });
            fireEvent.change(screen.getByLabelText(/Confirmed End Date/), { target: { value: '2024-01-01' } });
            fireEvent.change(screen.getByRole('textbox', { name: /Position \/ Title Held/ }), { target: { value: 'Artificial Driver' } });
            fireEvent.change(screen.getByRole('combobox', { name: /Reason for Leaving/ }), { target: { value: 'Laid Off' } });
        }
        if (groupName === VIOLATIONS && label === 'Yes') {
            fireEvent.change(screen.getByRole('textbox', { name: /Violation Details/ }), { target: { value: 'Artificial violation.' } });
        }
    }
}

function signAndSubmit() {
    fireEvent.change(screen.getByRole('textbox', { name: /Your Full Name/i }), { target: { value: 'Artificial Respondent' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Your Title \/ Position/i }), { target: { value: 'HR Manager' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Phone Number/i }), { target: { value: '555-000-1111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mock sign' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
}

async function submittedResponse() {
    await waitFor(() => expect(screen.getByText('Verification Submitted Successfully')).toBeInTheDocument());
    expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1);
    return callables.submitVerificationResponse.mock.calls[0][0].response;
}

const UNANSWERED = {
    wasEmployed: null,
    eligibleForRehire: null,
    subjectToFmcsrs: null,
    subjectToDotTesting: null,
    hadDrugAlcoholViolations: null,
    completedReturnToDuty: '',
    hadAccidents: null,
    hadNonRecordableAccidents: null,
};

const CASES = [
    [
        'no employment record',
        [[EMPLOYED, 'No / No Record Found']],
        { wasEmployed: false },
    ],
    [
        'every answer Yes, return to duty "Yes"',
        [[EMPLOYED, 'Yes'], [REHIRE, 'Yes'], [FMCSRS, 'Yes'], [DOT, 'Yes'], [VIOLATIONS, 'Yes'],
            [RETURN_TO_DUTY, 'Yes'], [ACCIDENTS, 'Yes'], [OTHER_ACCIDENTS, 'Yes']],
        {
            wasEmployed: true, eligibleForRehire: true, subjectToFmcsrs: true, subjectToDotTesting: true,
            hadDrugAlcoholViolations: true, completedReturnToDuty: 'yes', hadAccidents: true, hadNonRecordableAccidents: true,
        },
    ],
    [
        'return to duty "No"',
        [[EMPLOYED, 'Yes'], [FMCSRS, 'Yes'], [DOT, 'Yes'], [VIOLATIONS, 'Yes'], [RETURN_TO_DUTY, 'No'], [ACCIDENTS, 'No']],
        {
            wasEmployed: true, subjectToFmcsrs: true, subjectToDotTesting: true,
            hadDrugAlcoholViolations: true, completedReturnToDuty: 'no', hadAccidents: false,
        },
    ],
    [
        'return to duty "In Progress"',
        [[EMPLOYED, 'Yes'], [FMCSRS, 'Yes'], [DOT, 'Yes'], [VIOLATIONS, 'Yes'], [RETURN_TO_DUTY, 'In Progress'], [ACCIDENTS, 'No']],
        {
            wasEmployed: true, subjectToFmcsrs: true, subjectToDotTesting: true,
            hadDrugAlcoholViolations: true, completedReturnToDuty: 'in_progress', hadAccidents: false,
        },
    ],
    [
        'every answer No',
        [[EMPLOYED, 'Yes'], [REHIRE, 'No'], [FMCSRS, 'No'], [DOT, 'No'], [ACCIDENTS, 'No'], [OTHER_ACCIDENTS, 'No']],
        {
            wasEmployed: true, eligibleForRehire: false, subjectToFmcsrs: false, subjectToDotTesting: false,
            hadAccidents: false, hadNonRecordableAccidents: false,
        },
    ],
    [
        'DOT testing without a violation',
        [[EMPLOYED, 'Yes'], [FMCSRS, 'No'], [DOT, 'Yes'], [VIOLATIONS, 'No'], [ACCIDENTS, 'Yes']],
        {
            wasEmployed: true, subjectToFmcsrs: false, subjectToDotTesting: true,
            hadDrugAlcoholViolations: false, hadAccidents: true,
        },
    ],
];

describe('VerificationPortal choice questions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    });

    describe('what each choice sends', () => {
        it.each(CASES)('%s', async (_name, steps, answers) => {
            await renderLoadedForm();
            answer(steps);
            signAndSubmit();

            const response = await submittedResponse();
            expect(Object.keys(response).sort()).toEqual(RESPONSE_KEYS);
            const sent = Object.fromEntries(Object.keys(UNANSWERED).map((key) => [key, response[key]]));
            expect(sent).toStrictEqual({ ...UNANSWERED, ...answers });
        });
    });

    describe('required questions', () => {
        it('marks only the required questions, without the browser validation that would pre-empt the form', async () => {
            await renderLoadedForm();
            answer([[EMPLOYED, 'Yes'], [DOT, 'Yes'], [VIOLATIONS, 'Yes']]);

            for (const name of [EMPLOYED, FMCSRS, DOT, VIOLATIONS, ACCIDENTS]) {
                expect(group(name)).toHaveAccessibleName(/required$/);
                for (const radio of within(group(name)).getAllByRole('radio')) {
                    expect(radio).toHaveAttribute('aria-required', 'true');
                    expect(radio).not.toHaveAttribute('required');
                }
            }
            for (const name of [REHIRE, RETURN_TO_DUTY, OTHER_ACCIDENTS]) {
                expect(group(name)).not.toHaveAccessibleName(/required/);
                for (const radio of within(group(name)).getAllByRole('radio')) {
                    expect(radio).not.toHaveAttribute('aria-required');
                    expect(radio).not.toHaveAttribute('required');
                }
            }
        });

        it('says "Required" under each unanswered required question and does not submit', async () => {
            await renderLoadedForm();
            fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
            await waitFor(() => expect(within(group(EMPLOYED)).getByText('Required')).toBeInTheDocument());

            answer([[EMPLOYED, 'Yes']]);
            expect(within(group(EMPLOYED)).queryByText('Required')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
            await waitFor(() => expect(within(group(FMCSRS)).getByText('Required')).toBeInTheDocument());
            expect(within(group(DOT)).getByText('Required')).toBeInTheDocument();
            expect(within(group(ACCIDENTS)).getByText('Required')).toBeInTheDocument();
            expect(within(group(REHIRE)).queryByText('Required')).not.toBeInTheDocument();
            expect(within(group(OTHER_ACCIDENTS)).queryByText('Required')).not.toBeInTheDocument();

            answer([[DOT, 'Yes']]);
            expect(within(group(DOT)).queryByText('Required')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
            await waitFor(() => expect(within(group(VIOLATIONS)).getByText('Required')).toBeInTheDocument());

            answer([[VIOLATIONS, 'Yes']]);
            expect(within(group(RETURN_TO_DUTY)).queryByText('Required')).not.toBeInTheDocument();
            expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
        });
    });

    describe('keyboard', () => {
        it('answers with Space and moves between options with the arrow keys, inside one question', async () => {
            const user = userEvent.setup();
            await renderLoadedForm();

            act(() => option(EMPLOYED, 'Yes').focus());
            await user.keyboard(' ');
            await waitFor(() => expect(group(FMCSRS)).toBeInTheDocument());
            expect(option(EMPLOYED, 'Yes')).toBeChecked();

            act(() => option(DOT, 'Yes').focus());
            await user.keyboard('{ArrowRight}');
            await waitFor(() => expect(option(DOT, 'No')).toBeChecked());
            expect(option(DOT, 'No')).toHaveFocus();
            // The arrow stayed in its question: the neighbours are unanswered.
            expect(within(group(FMCSRS)).getAllByRole('radio').some((radio) => radio.checked)).toBe(false);
            expect(within(group(ACCIDENTS)).getAllByRole('radio').some((radio) => radio.checked)).toBe(false);

            await user.keyboard('{ArrowRight}');
            await waitFor(() => expect(group(VIOLATIONS)).toBeInTheDocument());
            expect(option(DOT, 'Yes')).toBeChecked();
            expect(option(DOT, 'Yes')).toHaveFocus();

            act(() => option(EMPLOYED, 'Yes').focus());
            await user.keyboard('{ArrowLeft}');
            await waitFor(() => expect(screen.queryByRole('group', { name: FMCSRS })).not.toBeInTheDocument());
            expect(option(EMPLOYED, 'No / No Record Found')).toBeChecked();

            signAndSubmit();
            const response = await submittedResponse();
            expect(response.wasEmployed).toBe(false);
        });
    });
});
