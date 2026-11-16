import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApplicantDetailsCard } from './ApplicantDetailsCard';

describe('ApplicantDetailsCard', () => {
    it('shows the response deadline in the app\'s one date style (K3)', () => {
        render(<ApplicantDetailsCard verificationData={{ applicantName: 'Pat Example', expiresAt: '2026-03-07T12:00:00.000Z' }} />);
        expect(screen.getByText('Mar 7, 2026')).toBeInTheDocument();
        expect(screen.queryByText('3/7/2026')).not.toBeInTheDocument();
    });

    it('says N/A when the request carries no deadline', () => {
        render(<ApplicantDetailsCard verificationData={{ applicantName: 'Pat Example' }} />);
        expect(screen.getByText('N/A')).toBeInTheDocument();
    });
});
