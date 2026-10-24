// The Sent Documents fixture rows, kept apart from `DocumentsManager.jsx`, which
// shows them only in E2E test mode.

/*
 * Fixture rows for the `?e2eEdoc=mock&e2eEdocSent=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets. Without them the
 * harness has no signing requests, so the table could be measured and pictured
 * only empty.
 *
 * One row for each thing a row can say: awaiting a signature, signed, a failed
 * email, voided, a failed seal; each delivery method (email, SMS, both, a copied
 * link); and the long title and long name that test the columns. Every person,
 * address and number is made up, on reserved example domains and 555 numbers.
 *
 * Each time is an age measured back from `now`: the pixel lane fixes the clock
 * (`e2e/visual/settle.cjs`), so its pictures never move.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The workspace's signing requests as the live listener would read them at `now`. */
export function mockSigningRequests(now = Date.now()) {
    const sentAgo = (days) => ({ seconds: Math.floor((now - days * DAY) / 1000), nanoseconds: 0 });
    return [
        {
            id: 'e2e-req-offer',
            title: 'Employment Offer Letter — Class A Company Driver, Regional Dry Van',
            recipientName: 'Dana Whitfield',
            recipientEmail: 'dana.whitfield@example.test',
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            status: 'sent',
            createdAt: sentAgo(1),
        },
        {
            id: 'e2e-req-w9',
            title: 'W-9 Request',
            recipientName: 'Marcus Iyer',
            recipientPhone: '(555) 010-4417',
            sendEmail: false,
            sendSms: true,
            deliveryMethod: 'sms',
            status: 'signed',
            storagePath: 'signed_documents/e2e/w9.pdf',
            createdAt: sentAgo(3),
        },
        {
            id: 'e2e-req-policy',
            title: 'Drug and Alcohol Policy Acknowledgement',
            recipientName: 'Priya Raman',
            recipientEmail: 'priya.raman@example.test',
            recipientPhone: '(555) 010-8890',
            sendEmail: true,
            sendSms: true,
            deliveryMethod: 'both',
            status: 'sent',
            emailStatus: 'failed',
            emailError: 'Mailbox unavailable',
            createdAt: sentAgo(4),
        },
        {
            id: 'e2e-req-deposit',
            title: 'Direct Deposit Authorization',
            recipientName: 'Tomas Okafor',
            recipientEmail: 'tomas.okafor@example.test',
            sendEmail: false,
            sendSms: false,
            deliveryMethod: 'copy',
            status: 'voided',
            createdAt: sentAgo(8),
        },
        {
            id: 'e2e-req-lease',
            title: 'Lease Agreement',
            recipientName: 'Ana Lucia Ferreira-Montgomery',
            recipientEmail: 'ana.ferreira-montgomery@example.test',
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            status: 'error_sealing',
            errorLog: 'The signed pages could not be sealed.',
            createdAt: sentAgo(12),
        },
        {
            id: 'e2e-req-handbook',
            title: 'Safety Handbook Receipt',
            recipientName: 'Lee Chan',
            recipientEmail: 'lee.chan@example.test',
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            status: 'signed',
            storagePath: 'signed_documents/e2e/handbook.pdf',
            createdAt: sentAgo(20),
        },
    ];
}
