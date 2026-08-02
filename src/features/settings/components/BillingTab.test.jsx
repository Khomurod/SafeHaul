import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

import { BillingTab } from './BillingTab';

describe('Company Settings Billing informational card', () => {
    it('renders the billing heading and subscription subtitle', () => {
        render(<BillingTab currentCompanyProfile={{ planType: 'paid' }} />);

        expect(
            screen.getByRole('heading', { level: 2, name: 'Billing & Plan' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Manage your subscription.')).toBeInTheDocument();
    });

    it('labels the plan value and shows the Pro plan for paid companies', () => {
        render(<BillingTab currentCompanyProfile={{ planType: 'paid' }} />);

        const region = screen.getByRole('region', { name: 'Billing & Plan' });
        expect(within(region).getByText('Current Plan')).toBeInTheDocument();
        expect(within(region).getByText('Pro Plan')).toBeInTheDocument();
        expect(within(region).queryByText('Free Plan')).not.toBeInTheDocument();
    });

    it('shows the Free plan when the company is not on a paid plan', () => {
        render(<BillingTab currentCompanyProfile={{ planType: 'free' }} />);

        expect(screen.getByText('Free Plan')).toBeInTheDocument();
        expect(screen.queryByText('Pro Plan')).not.toBeInTheDocument();
    });

    it('falls back to the Free plan when the plan type is missing', () => {
        render(<BillingTab currentCompanyProfile={{}} />);

        expect(screen.getByText('Free Plan')).toBeInTheDocument();
    });

    it('tolerates a missing company profile without a paid claim', () => {
        render(<BillingTab currentCompanyProfile={null} />);

        expect(screen.getByText('Free Plan')).toBeInTheDocument();
    });

    it('preserves the contact-support guidance message', () => {
        render(<BillingTab currentCompanyProfile={{ planType: 'paid' }} />);

        expect(
            screen.getByText('To upgrade or cancel, please contact support.'),
        ).toBeInTheDocument();
    });

    it('has no structural accessibility violations', async () => {
        const { container } = render(
            <BillingTab currentCompanyProfile={{ planType: 'paid' }} />,
        );

        expect((await axe(container)).violations).toEqual([]);
    });
});
