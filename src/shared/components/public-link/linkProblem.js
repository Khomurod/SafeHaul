import { serverMessageOf } from '@shared/utils/callableErrors';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/**
 * Why a link sent to someone outside the company did not open — a signer, a past
 * employer, a driver reviewing a change, an applicant continuing — as one of the
 * few reasons that person can act on. `LinkProblemScreen` says each one the same
 * way on every public page.
 *
 *  - `expired`     the link ran out: ask for a new one.
 *  - `replaced`    a newer link was sent: open the newest message.
 *  - `used`        what it was for is done: nothing more to do.
 *  - `not-found`   the link is wrong, cut short, or what it named is gone.
 *  - `unopenable`  one of the above, and the server deliberately does not say
 *                  which (a wrong token and a used one answer alike).
 *  - `unavailable` the link could not be checked at all (connection, too many
 *                  tries, a server failure): the only one worth trying again.
 */
export const LINK_PROBLEM = Object.freeze({
    EXPIRED: 'expired',
    REPLACED: 'replaced',
    USED: 'used',
    NOT_FOUND: 'not-found',
    UNOPENABLE: 'unopenable',
    UNAVAILABLE: 'unavailable',
});

/** Trying again can only help when the link could not be checked. */
export const isRetryableLinkProblem = (reason) => reason === LINK_PROBLEM.UNAVAILABLE;

/**
 * `plainErrorMessage`'s closing advice for a failure it cannot name. The screen
 * closes with who to contact if it keeps happening (the sender, by name when
 * known), so the detail drops this one rather than saying it twice.
 */
const CONTACT_SUPPORT = /\s*If it keeps happening, contact support\.$/;

const REPLACED_WORDS = /\breplaced\b|\bnewer\b/i;
const EXPIRED_WORDS = /\bexpired\b/i;
const USED_WORDS = /\balready (?:been )?(?:complete|completed|submitted|signed|used)\b/i;

/**
 * A public callable's refusal, as `{ reason, detail }`.
 *
 * The server's own sentence decides between reasons that share a code — a review
 * link answers expired, replaced and complete all as `failed-precondition`, and a
 * verification link answers wrong and replaced both as `not-found` — so the words
 * it chose for the person are read before the code. If a sentence changes, the
 * code still lands it on a sensible reason. `detail` is set only when the link
 * could not be checked; every other reason has its own words on the screen.
 *
 * @param {unknown} error what the callable rejected with
 * @param {string} [failed] one sentence naming what could not be done, for
 *   `plainErrorMessage` when the link could not be checked
 * @returns {{ reason: string, detail?: string }}
 */
export function linkProblemFromError(error, failed = 'This link could not be checked.') {
    const rawCode = String(/** @type {any} */ (error)?.code ?? '');
    const callable = rawCode.startsWith('functions/');
    const code = callable ? rawCode.slice('functions/'.length) : '';
    // Only a refusal the server wrote for the person; an internal one passes on other text.
    const said = callable && code !== 'internal' && code !== 'unknown' ? serverMessageOf(error) : null;

    if (said && REPLACED_WORDS.test(said)) return { reason: LINK_PROBLEM.REPLACED };
    if (said && EXPIRED_WORDS.test(said)) return { reason: LINK_PROBLEM.EXPIRED };
    if (said && USED_WORDS.test(said)) return { reason: LINK_PROBLEM.USED };

    switch (code) {
        case 'not-found':
        case 'invalid-argument':
            return { reason: LINK_PROBLEM.NOT_FOUND };
        case 'permission-denied':
        case 'failed-precondition':
            return { reason: LINK_PROBLEM.UNOPENABLE };
        // With the server's words it ran out; without them the browser stopped waiting.
        case 'deadline-exceeded':
            if (said) return { reason: LINK_PROBLEM.EXPIRED };
            break;
        default:
            break;
    }
    return {
        reason: LINK_PROBLEM.UNAVAILABLE,
        detail: plainErrorMessage(error, failed, { viaLink: true }).replace(CONTACT_SUPPORT, ''),
    };
}
