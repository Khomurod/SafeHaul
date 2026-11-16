// Campaigns dashboard fixtures, served only in E2E test mode (`?e2eCampaign=mock`,
// gated on `VITE_E2E_TEST_MODE`, which a production build never sets). All names
// and numbers are artificial.

const MANY_COUNT = 60;
const HOUR = 60 * 60 * 1000;

const at = (millis) => ({
    toDate: () => new Date(millis),
    toMillis: () => millis,
});

/** The one seeded draft and finished session that the browser suites click. */
function seedLists() {
    const e2eNow = {
        toDate: () => new Date(),
        toMillis: () => Date.now(),
    };
    return {
        drafts: [
            {
                id: 'camp_e2e_seed',
                name: 'E2E Seed Campaign',
                status: 'draft',
                updatedAt: e2eNow,
                matchCount: 6,
                messageConfig: { method: 'sms', message: 'E2E seeded outreach message.' },
            },
        ],
        sessions: [
            {
                id: 'session_e2e_seed',
                name: 'E2E Completed Session',
                status: 'completed',
                progress: { processedCount: 12, totalCount: 12 },
                config: { method: 'sms', message: 'Completed seed campaign' },
                messageConfig: { method: 'sms', message: 'Completed seed campaign' },
                createdAt: e2eNow,
                updatedAt: e2eNow,
                matchCount: 12,
            },
        ],
    };
}

/** `&e2eCampaignList=many`: 60 drafts and 60 finished sessions, newest first, an hour apart. */
function manyLists() {
    const now = Date.now();
    const number = (i) => String(i + 1).padStart(2, '0');
    return {
        drafts: Array.from({ length: MANY_COUNT }, (_, i) => ({
            id: `camp_e2e_many_${number(i)}`,
            name: `Sample Draft ${number(i)}`,
            status: 'draft',
            updatedAt: at(now - i * HOUR),
            matchCount: 5,
            messageConfig: { method: 'sms', message: 'Sample outreach message.' },
        })),
        sessions: Array.from({ length: MANY_COUNT }, (_, i) => ({
            id: `session_e2e_many_${number(i)}`,
            name: `Sample Campaign ${number(i)}`,
            status: 'completed',
            progress: { processedCount: 10, totalCount: 10 },
            config: { method: 'sms', message: 'Sample finished campaign.' },
            messageConfig: { method: 'sms', message: 'Sample finished campaign.' },
            createdAt: at(now - i * HOUR),
            updatedAt: at(now - i * HOUR),
            matchCount: 10,
        })),
    };
}

/**
 * `&e2eCampaignList=stopped`: the seeded draft and one campaign that failed
 * part-way, as a provider refusal at a batch's start leaves it: 250 of 406 tried.
 */
function stoppedLists() {
    const e2eNow = {
        toDate: () => new Date(),
        toMillis: () => Date.now(),
    };
    return {
        drafts: seedLists().drafts,
        sessions: [
            {
                id: 'session_e2e_stopped',
                name: 'E2E Stopped Session',
                status: 'failed',
                error: 'SMS adapter initialization failed: Request rate exceeded',
                progress: { processedCount: 250, totalCount: 406, successCount: 19, failedCount: 231, currentPointer: 250 },
                config: { method: 'sms', message: 'Stopped seed campaign' },
                messageConfig: { method: 'sms', message: 'Stopped seed campaign' },
                createdAt: e2eNow,
                updatedAt: e2eNow,
                matchCount: 406,
            },
        ],
    };
}

/** The fixture lists for `mode` ('mock', 'many' or 'stopped'). */
export function e2eCampaignLists(mode) {
    if (mode === 'many') return manyLists();
    if (mode === 'stopped') return stoppedLists();
    return seedLists();
}
