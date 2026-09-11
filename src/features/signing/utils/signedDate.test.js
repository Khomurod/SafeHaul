import { describe, expect, it } from 'vitest';
import {
    SIGNING_DATE_KEY,
    SIGNING_DATE_PLACEHOLDER,
    formatSignedDate,
    resolveSignedDateValue,
    stampSignedDateFields,
} from './signedDate';
import { buildPrefillContext, resolveFieldForSend } from './prefillEngine';

// Two instants far enough apart that no formatting accident could confuse them:
// the day a document is prepared, and the day someone actually signs it.
const PREPARED_ON = new Date('2026-05-07T12:00:00Z');
const SIGNED_ON = new Date('2026-09-11T12:00:00Z');

describe('signedDate', () => {
    it('stamps a field bound to the signing date', () => {
        expect(
            resolveSignedDateValue({ bindingKey: SIGNING_DATE_KEY, defaultValue: '' }, SIGNED_ON),
        ).toBe('September 11, 2026');
    });

    it('stamps a document that was sent with the placeholder still in place', () => {
        expect(
            resolveSignedDateValue({ defaultValue: SIGNING_DATE_PLACEHOLDER }, SIGNED_ON),
        ).toBe('September 11, 2026');
    });

    it('replaces the creation date already baked into an in-flight document', () => {
        // Documents sent before this fix carry the send date with no token left
        // to find. The binding is the only thing that still says what the value
        // MEANS, which is why it is a second arm and not a fallback.
        const field = {
            bindingKey: SIGNING_DATE_KEY,
            defaultValue: formatSignedDate(PREPARED_ON),
        };
        expect(field.defaultValue).toBe('May 7, 2026');
        expect(resolveSignedDateValue(field, SIGNED_ON)).toBe('September 11, 2026');
    });

    it('keeps the surrounding words when the token sits inside a sentence', () => {
        expect(
            resolveSignedDateValue(
                { defaultValue: 'Signed on {{current_date}} at the terminal' },
                SIGNED_ON,
            ),
        ).toBe('Signed on September 11, 2026 at the terminal');
    });

    it('tolerates the spacing and casing an author may type', () => {
        expect(
            resolveSignedDateValue({ defaultValue: '{{  CURRENT_DATE  }}' }, SIGNED_ON),
        ).toBe('September 11, 2026');
    });

    it('leaves every other date alone', () => {
        // The requirement this test exists for: a date of birth, a hire date, a
        // licence expiry and an unbound date the signer fills in are ordinary
        // data and must survive signing untouched.
        const untouched = [
            { bindingKey: 'dob', defaultValue: 'January 2, 1980' },
            { bindingKey: '', defaultValue: 'Hire date: March 1, 2026' },
            { bindingKey: 'cdl_expiration', defaultValue: 'August 30, 2029' },
            { type: 'date', bindingKey: '', defaultValue: '' },
            { defaultValue: '{{date}}' },
        ];
        untouched.forEach((field) => {
            expect(resolveSignedDateValue(field, SIGNED_ON)).toBeNull();
        });
    });

    it('is null for a malformed or absent field rather than throwing', () => {
        expect(resolveSignedDateValue(undefined, SIGNED_ON)).toBeNull();
        expect(resolveSignedDateValue({}, SIGNED_ON)).toBeNull();
    });

    it('renders in UTC so the screen and the sealed PDF cannot disagree', () => {
        // A signer west of UTC late in the evening is exactly when a locally
        // formatted screen and a server-formatted PDF drift a day apart.
        expect(formatSignedDate(new Date('2026-09-11T23:30:00Z'))).toBe('September 11, 2026');
        expect(formatSignedDate(new Date('2026-09-12T00:30:00Z'))).toBe('September 12, 2026');
    });

    it('stamps only the signing-date fields in a list, by identity', () => {
        const dob = { id: 'dob', bindingKey: 'dob', defaultValue: 'January 2, 1980' };
        const fields = [
            { id: 'sig', type: 'signature', defaultValue: '' },
            { id: 'signed_on', bindingKey: SIGNING_DATE_KEY, defaultValue: SIGNING_DATE_PLACEHOLDER },
            dob,
        ];

        const stamped = stampSignedDateFields(fields, SIGNED_ON);

        expect(stamped[1].defaultValue).toBe('September 11, 2026');
        // Untouched fields are returned as the very same objects, so nothing
        // downstream can be re-rendered or re-serialized by accident.
        expect(stamped[0]).toBe(fields[0]);
        expect(stamped[2]).toBe(dob);
    });
});

describe('the send path defers the signing date', () => {
    const context = () => buildPrefillContext({
        recipientName: 'Artificial Person',
        recipientEmail: 'nobody@example.invalid',
        companyName: 'Artificial Freight Co',
        now: PREPARED_ON,
    });

    const dateSigned = {
        id: 'date_signed',
        type: 'date',
        label: 'Date Signed',
        required: true,
        prefillPolicy: 'locked',
        bindingKey: SIGNING_DATE_KEY,
        defaultValue: SIGNING_DATE_PLACEHOLDER,
    };

    it('sends the placeholder rather than the day the document was prepared', () => {
        const { field } = resolveFieldForSend(dateSigned, context());
        expect(field.defaultValue).toBe(SIGNING_DATE_PLACEHOLDER);
        expect(field.defaultValue).not.toContain('May');
    });

    it('still sends every other prefill resolved', () => {
        const { field } = resolveFieldForSend(
            { id: 'name', type: 'text', bindingKey: 'full_name', defaultValue: '{{full_name}}' },
            context(),
        );
        expect(field.defaultValue).toBe('Artificial Person');
    });

    it('does not report a locked required Date Signed field as missing prefill data', () => {
        // The placeholder is a deferred value, not an absent one. Treating it as
        // absent would refuse to send every document carrying a Date Signed field.
        const { field, meta } = resolveFieldForSend(dateSigned, context());
        expect(meta.shouldBlockMissingLockedRequired).toBe(false);
        expect(meta.hasResolvedValue).toBe(true);
        expect(field.readOnly).toBe(true);
    });

    it('defers the token even inside longer text, leaving the rest resolved', () => {
        const { field } = resolveFieldForSend(
            {
                id: 'attestation',
                type: 'text',
                defaultValue: '{{full_name}} signed on {{current_date}}',
            },
            context(),
        );
        expect(field.defaultValue).toBe('Artificial Person signed on {{current_date}}');
    });

    it('resolves it anyway when the caller opts out, which is what previews do', () => {
        const { field } = resolveFieldForSend(dateSigned, context(), { deferSigningDate: false });
        expect(field.defaultValue).toBe('May 7, 2026');
    });

    it('keeps a date the sender typed into the send modal out of the stored value', () => {
        // An editable Date Signed field can be given a value at send time. It is
        // still overwritten when the signer submits — "always the actual signing
        // date" leaves no room for a sender-chosen one — so the stamp must win
        // over the override here too.
        const editable = { ...dateSigned, prefillPolicy: 'editable' };
        const { field } = resolveFieldForSend(editable, context(), {
            overridesByFieldId: { date_signed: 'June 1, 2026' },
        });
        expect(field.defaultValue).toBe('June 1, 2026');
        expect(resolveSignedDateValue(field, SIGNED_ON)).toBe('September 11, 2026');
    });
});
