import { describe, expect, it } from 'vitest';
import { campaignStatusPresentation } from './campaignConstants';

/**
 * K2: the campaign cards and the campaign report read a status through this one
 * map, so a status cannot look healthy on one and failed on the other.
 */
describe('campaignStatusPresentation', () => {
    it.each([
        ['active', 'Active', 'success'],
        ['draft', 'Draft', 'neutral'],
        ['completed', 'Completed', 'info'],
        ['scheduled', 'Scheduled', 'warning'],
        ['queued', 'Queued', 'accent'],
        ['paused', 'Paused', 'warning'],
        ['cancelled', 'Cancelled', 'neutral'],
        ['failed', 'Failed', 'danger'],
    ])('shows %s as "%s" in the %s tone', (status, label, tone) => {
        expect(campaignStatusPresentation(status)).toEqual({ tone, label });
    });

    it('reads a failed campaign as a failure', () => {
        expect(campaignStatusPresentation('failed').tone).toBe('danger');
    });

    it('reads an unknown or missing status as neutral, never as a state it is not', () => {
        expect(campaignStatusPresentation('mystery')).toEqual({ tone: 'neutral', label: 'Mystery' });
        expect(campaignStatusPresentation(undefined)).toEqual({ tone: 'neutral', label: 'Unknown' });
        expect(campaignStatusPresentation('')).toEqual({ tone: 'neutral', label: 'Unknown' });
        // An inherited key is not a status.
        expect(campaignStatusPresentation('toString').tone).toBe('neutral');
    });
});
