/**
 * Whether moving a record to a Contact Attempt stage texts the driver, in the
 * server's terms (`functions/atsContactSms.js`): a change into the stage, the
 * company's template for it, an application's "Yes" to texts, a usable phone.
 * All names and numbers below are artificial.
 */
import { describe, expect, it } from 'vitest';
import {
    contactAttemptTextFor,
    savedTextNote,
    stageOptionLabel,
    stagesWithTemplate,
} from './contactAttemptText';

const ALL = stagesWithTemplate({
    templateContactAttempt1: 'Hi {driver name}, this is {user name}.',
    templateContactAttempt2: 'Still interested?',
    templateContactAttempt3: 'Last try.',
});
const application = (overrides = {}) => ({ phone: '(555) 010-2030', 'sms-consent': 'yes', ...overrides });
const outlook = (stage, overrides = {}) => contactAttemptTextFor(stage, {
    currentStatus: 'New',
    templates: ALL,
    record: application(),
    isLead: false,
    ...overrides,
});

describe('stagesWithTemplate', () => {
    it('reads each stage from its own field, and a blank one as none', () => {
        expect(stagesWithTemplate({ templateContactAttempt1: 'Hi', templateContactAttempt2: '   ' })).toEqual({
            'Contact Attempt 1': true,
            'Contact Attempt 2': false,
            'Contact Attempt 3': false,
        });
        expect(stagesWithTemplate(undefined)).toEqual({
            'Contact Attempt 1': false,
            'Contact Attempt 2': false,
            'Contact Attempt 3': false,
        });
    });
});

describe('contactAttemptTextFor', () => {
    it('texts when the company has the template and the driver can be texted', () => {
        expect(outlook('Contact Attempt 1')).toBe('texts');
        expect(outlook('Contact Attempt 3', { currentStatus: 'Contact Attempt 2' })).toBe('texts');
    });

    it('texts a lead without asking about consent: leads were never asked', () => {
        expect(outlook('Contact Attempt 1', { isLead: true, record: { phone: '5550102030' } })).toBe('texts');
    });

    it('reads the normalized phone first, as the server does', () => {
        expect(outlook('Contact Attempt 1', { record: application({ phone: '', phoneNormalized: '+15550102030' }) })).toBe('texts');
    });

    it.each([
        ['a stage that is not a Contact Attempt', 'Interested', {}],
        ['the stage the record is already in', 'Contact Attempt 1', { currentStatus: 'Contact Attempt 1' }],
        ['a stage with no template', 'Contact Attempt 2', { templates: { ...ALL, 'Contact Attempt 2': false } }],
        ['an application without a "Yes"', 'Contact Attempt 1', { record: application({ 'sms-consent': 'no' }) }],
        ['an application that did not answer', 'Contact Attempt 1', { record: application({ 'sms-consent': undefined }) }],
        ['no phone', 'Contact Attempt 1', { record: application({ phone: '' }) }],
        ['a number too short to text', 'Contact Attempt 1', { record: application({ phone: '555-0102' }) }],
    ])('sends nothing for %s', (_what, stage, overrides) => {
        expect(outlook(stage, overrides)).toBeNull();
    });

    it('may text while the templates or the record are not known', () => {
        expect(outlook('Contact Attempt 1', { templates: null })).toBe('may');
        expect(outlook('Contact Attempt 1', { record: null })).toBe('may');
        // Not a Contact Attempt stage: no text, known or not.
        expect(outlook('Hired', { templates: null })).toBeNull();
    });
});

describe('the words', () => {
    it('warns in the picker option', () => {
        expect(stageOptionLabel('Contact Attempt 1', 'texts')).toBe('Contact Attempt 1 — texts the driver');
        expect(stageOptionLabel('Contact Attempt 1', 'may')).toBe('Contact Attempt 1 — may text the driver');
        expect(stageOptionLabel('Contact Attempt 1', null)).toBe('Contact Attempt 1');
    });

    it('confirms the text after the save', () => {
        expect(savedTextNote('texts')).toBe('A text to the driver is queued.');
        expect(savedTextNote('may')).toBe('The driver may be texted.');
        expect(savedTextNote(null)).toBe('');
    });
});
