// The preserved record, on screen.
//
// The defect this replaces: a banner announcing "preserved original submission"
// above a view rendering the live, editable application document. A recruiter
// answering an FMCSA or FCRA question from that screen had no way to know the
// wording could have changed since.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { PreservedApplicationView } from './PreservedApplicationView';

afterEach(cleanup);

const RECORD = {
    isPreserved: true,
    isReconstructed: false,
    submittedAt: '2026-07-14T15:22:41.000Z',
    company: { companyName: 'Northwind Freight Systems' },
    sections: [
        {
            id: 'personal',
            title: 'Personal Information',
            answers: [
                { key: 'firstName', label: 'First Name', value: 'Marcus', isMissing: false, sensitive: false, repeating: false, rows: [] },
                { key: 'ssn', label: 'Social Security Number', value: '412-88-7391', isMissing: false, sensitive: true, repeating: false, rows: [] },
                { key: 'suffix', label: 'Suffix', value: 'Not provided', isMissing: true, sensitive: false, repeating: false, rows: [] },
            ],
        },
        {
            id: 'employment',
            title: 'Employment History',
            answers: [
                {
                    key: 'employers',
                    label: 'Previous Employers',
                    value: 'Not provided',
                    isMissing: false,
                    sensitive: false,
                    repeating: true,
                    rows: [
                        [
                            { label: 'Employer', displayValue: 'Lone Star Logistics' },
                            { label: 'Reason for Leaving', displayValue: 'Seeking a dedicated lane.' },
                        ],
                    ],
                },
                { key: 'unemployment', label: 'Employment Gaps', value: '', isMissing: true, sensitive: false, repeating: true, rows: [] },
            ],
        },
    ],
    customAnswers: [
        { key: 'q1', label: 'Willing to run a dedicated lane?', labelUnavailable: false, unmatched: false, value: 'Yes', isMissing: false },
        { key: 'q2', label: 'Question wording not recorded', labelUnavailable: true, unmatched: true, value: 'An orphaned answer', isMissing: false },
    ],
    agreements: [
        { key: 'a1', title: 'BACKGROUND CHECK DISCLOSURE', version: 'v1', status: 'accepted', summary: 'Accepted and signed by the applicant', acceptedAt: '2026-07-14T15:22:41.000Z', hasSignature: true, signatureType: 'drawn', legacyWording: false },
        { key: 'a2', title: 'FMCSA PSP DISCLOSURE', version: 'v1', status: 'declined', summary: 'The applicant did not accept this agreement', acceptedAt: null, hasSignature: false, signatureType: null, legacyWording: false },
        { key: 'a3', title: 'ELECTRONIC SIGNATURE', version: 'legacy-1', status: 'unrecorded', summary: 'No acceptance was recorded for this agreement', acceptedAt: null, hasSignature: false, signatureType: null, legacyWording: true },
    ],
    coverage: {
        isComplete: false, coveredMonths: 35, requiredMonths: 36, missingMonths: 1,
        gaps: [{ fromMonth: '2026-07', toMonth: '2026-07', months: 1 }],
        summary: 'Accounts for 35 of 36 months; 1 unaccounted for.',
    },
};

describe('PreservedApplicationView', () => {
    it('renders every section of the record', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText('Personal Information')).toBeInTheDocument();
        expect(screen.getByText('Employment History')).toBeInTheDocument();
        expect(screen.getByText('Marcus')).toBeInTheDocument();
    });

    it('masks a sensitive answer even though the record holds it in full', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText('***-**-7391')).toBeInTheDocument();
        expect(screen.queryByText('412-88-7391')).toBeNull();
    });

    it('lays out a repeating group as labelled cells', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText('Employer')).toBeInTheDocument();
        expect(screen.getByText('Lone Star Logistics')).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/\[object Object\]/);
    });

    it('says an empty repeating group is empty', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText('None recorded.')).toBeInTheDocument();
    });

    it('gives each agreement its OWN status, never one shared signature', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText('Accepted and signed by the applicant')).toBeInTheDocument();
        expect(screen.getByText('The applicant did not accept this agreement')).toBeInTheDocument();
        expect(screen.getByText('No acceptance was recorded for this agreement')).toBeInTheDocument();
        expect(screen.getAllByText(/Signed electronically/).length).toBe(1);
    });

    it('marks wording that was in force at the time rather than implying it is current', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText(/Wording in force at the time/)).toBeInTheDocument();
    });

    it('states three-year coverage and its gaps', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText(/Accounts for 35 of 36 months/)).toBeInTheDocument();
        expect(screen.getByText(/2026-07 to 2026-07/)).toBeInTheDocument();
    });

    it('describes an unrecorded question instead of printing its id, and keeps the answer', () => {
        render(<PreservedApplicationView record={RECORD} />);
        expect(screen.getByText('Question wording not recorded')).toBeInTheDocument();
        expect(screen.getByText('An orphaned answer')).toBeInTheDocument();
        expect(screen.getByText(/no longer matches a question/)).toBeInTheDocument();
    });

    it('shows nothing at all rather than substituting live data when nothing was preserved', () => {
        render(<PreservedApplicationView record={{
            isPreserved: false,
            notice: 'No preserved submission record exists for this application.',
            sections: [], customAnswers: [], agreements: [], coverage: null,
        }} />);
        expect(screen.getByText(/Nothing was preserved for this submission/)).toBeInTheDocument();
        expect(screen.queryByText('Marcus')).toBeNull();
    });

    it('handles a null record without rendering a broken page', () => {
        render(<PreservedApplicationView record={null} />);
        expect(screen.getByText(/Nothing was preserved for this submission/)).toBeInTheDocument();
    });

    it('omits a section the record does not carry rather than showing an empty heading', () => {
        render(<PreservedApplicationView record={{ ...RECORD, customAnswers: [], agreements: [], coverage: null }} />);
        expect(screen.queryByText('Supplemental Questions')).toBeNull();
        expect(screen.queryByText('Legal Agreements')).toBeNull();
        expect(screen.queryByText('Employment History Coverage')).toBeNull();
    });
});
