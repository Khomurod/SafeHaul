import React from 'react';
import { Card, FieldDisplay } from '@/design-system/components';

/**
 * FMCSA info banner + applicant details. Presentation migrated; the displayed
 * fields and regulatory copy are unchanged.
 */
export function ApplicantDetailsCard({ verificationData }) {
    const reportedDates = `${verificationData?.employmentStartDate} to ${verificationData?.employmentEndDate}`;
    const deadline = verificationData?.expiresAt
        ? new Date(verificationData.expiresAt).toLocaleDateString()
        : 'N/A';

    return (
        <Card padding="lg" aria-label="Applicant details">
            <div className="mb-ds-6 rounded-ds-md border-l-4 border-ds-status-info-border bg-ds-status-info-bg p-ds-4">
                <p className="text-ds-sm leading-relaxed text-ds-status-info-fg">
                    Under <strong>FMCSA 49 CFR Part 391.23</strong>, prospective employers of commercial motor vehicle
                    drivers are required to investigate the driver&apos;s employment record for the preceding 3 years.
                    Your cooperation in providing this information is <strong>required by federal regulation</strong>.
                    Previous employers must respond within <strong>30 days</strong> of receiving this request.
                </p>
            </div>

            <h2 className="mb-3 border-b border-ds-border-subtle pb-2 text-ds-heading-sm font-bold text-ds-content">
                Applicant Details
            </h2>
            <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2">
                <FieldDisplay label="Applicant Name">{verificationData?.applicantName}</FieldDisplay>
                <FieldDisplay label="Reported Dates">{reportedDates}</FieldDisplay>
                <FieldDisplay label="Requesting Company">{verificationData?.companyName}</FieldDisplay>
                <FieldDisplay label="Response Deadline">{deadline}</FieldDisplay>
            </div>
        </Card>
    );
}

export default ApplicantDetailsCard;
