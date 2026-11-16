import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { serverMessageOf } from '@shared/utils/callableErrors';

/**
 * The three callables behind Settings → Text messages → Opted-out numbers
 * (`functions/smsOptOuts.js`), and the one-number check the driver dossier
 * makes. Any team member lists, checks and adds; only a Company Admin removes,
 * re-checked on the server for the company named here.
 */

export async function listSmsOptOuts(companyId) {
    const { data } = await httpsCallable(functions, 'listSmsOptOuts')({ companyId });
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return {
        entries,
        total: Number.isInteger(data?.total) ? data.total : entries.length,
        hasMore: data?.hasMore === true,
    };
}

/** Whether one number is on the company's list, read from its own entry: `true` or `false`. */
export async function checkSmsOptOut({ companyId, phone }) {
    const { data } = await httpsCallable(functions, 'checkSmsOptOut')({ companyId, phone });
    return data?.listed === true;
}

/** Answers `{ added, entry }`: `added` is false for a number already listed, which keeps its first entry. */
export async function addSmsOptOut({ companyId, phone, reason }) {
    const { data } = await httpsCallable(functions, 'addSmsOptOut')({ companyId, phone, reason });
    return data;
}

export async function removeSmsOptOut({ companyId, phone }) {
    const { data } = await httpsCallable(functions, 'removeSmsOptOut')({ companyId, phone });
    return data;
}

const PLAIN = {
    'functions/permission-denied': 'You do not have access to this company’s settings. Ask a Company Admin.',
    'functions/unauthenticated': 'Your sign-in has ended. Sign in again and retry.',
    'functions/unavailable': 'We could not reach SafeHaul. Check your connection and try again.',
    'functions/deadline-exceeded': 'That took too long. Try again.',
    'functions/internal': 'Something went wrong on our side. Try again in a minute.',
};

/**
 * What to tell the team when a call fails. The server words a number it cannot
 * read for this screen, so that is shown as it is; anything else gets a plain
 * sentence. `denied` words a refusal for an action only some may take (removal).
 */
export function optOutErrorMessage(error, fallback, denied) {
    const said = error?.code === 'functions/invalid-argument' ? serverMessageOf(error) : null;
    if (said) return said;
    if (error?.code === 'functions/permission-denied' && denied) return denied;
    return PLAIN[error?.code] || fallback;
}
