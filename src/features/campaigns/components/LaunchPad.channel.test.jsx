// LaunchPad and the channel the audience was counted for: the count leaves out
// whoever a campaign of the same channel already reached, so a count made for
// SMS is not the audience of an email campaign. All fixtures are artificial.
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./LaunchPad.support')).libFirebaseMock());
vi.mock('firebase/functions', async () => (await import('./LaunchPad.support')).firebaseFunctionsMock());
vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./LaunchPad.support')).toastProviderMock());
vi.mock('@lib/runtime/e2eMode', async () => (await import('./LaunchPad.support')).e2eModeMock());

import { LaunchPad } from './LaunchPad';
import { makeRenderPad, resetMigratedHarness, validCampaign } from './LaunchPad.support';

const renderPad = makeRenderPad(LaunchPad);
const launchButton = () => screen.getByRole('button', { name: /Launch Immediately/ });

describe('LaunchPad — the channel the audience was counted for', () => {
    beforeEach(resetMigratedHarness);

    it('says how many the count left out as already messaged by this channel', () => {
        renderPad({ campaign: { ...validCampaign, countedFor: { method: 'sms', alreadyMessaged: 3 } } });

        expect(screen.getByText(/3 already messaged by SMS are left out/)).toBeInTheDocument();
        expect(launchButton()).toBeEnabled();
    });

    it('holds the launch when the channel changed after the audience was counted', () => {
        renderPad({
            campaign: {
                ...validCampaign,
                messageConfig: { ...validCampaign.messageConfig, method: 'email', subject: 'Hi' },
                countedFor: { method: 'sms', alreadyMessaged: 0 },
            },
        });

        expect(screen.getByText('The audience was counted for SMS. Open Audience to count it for Email.')).toBeInTheDocument();
        expect(launchButton()).toBeDisabled();
    });

    it('says nothing of it when nobody was left out, or for a draft counted before', () => {
        renderPad({ campaign: { ...validCampaign, countedFor: { method: 'sms', alreadyMessaged: 0 } } });
        expect(screen.queryByText(/already messaged/)).not.toBeInTheDocument();
        expect(launchButton()).toBeEnabled();
    });
});
