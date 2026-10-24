// Campaign log fixture rows, kept apart from the screens that show them only in
// E2E test mode (`?e2eCampaign=mock`, gated on `VITE_E2E_TEST_MODE`, which a
// production build never sets).

/*
 * Artificial fixtures for the deterministic E2E review of a finished campaign's
 * per-recipient tables (populated state, scroll under the sticky header,
 * statuses, filtering). Never real recipient contact data — fictional 555-01xx
 * numbers only.
 */
const E2E_SEED_NOW = { toDate: () => new Date() };

export const E2E_SEED_LOGS = Array.from({ length: 12 }, (_, i) => ({
    id: `e2e_log_${i}`,
    recipientName: `E2E Recipient ${i + 1}`,
    recipientIdentity: `555-01${String(i).padStart(2, '0')}`,
    status: i % 3 === 0 ? 'delivered' : 'failed',
    error: i % 3 === 1 ? 'Carrier rejected the message.' : undefined,
    // What RingCentral reported: delivered, still waiting, or not checked yet ("Sent").
    delivery: { 0: { state: 'delivered' }, 3: { state: 'pending' } }[i],
    timestamp: i === 11 ? undefined : E2E_SEED_NOW,
}));
