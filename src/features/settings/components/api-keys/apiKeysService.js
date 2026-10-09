import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * The three callables behind Settings → API Keys (`functions/companyApi/keyCallables.js`).
 * Company Admins only, re-checked on the server for the company named here.
 */

/** The permissions a Company Admin may add to a key; reading applications comes with every key. */
export const OPTIONAL_SCOPES = Object.freeze(['documents:read', 'ssn:read']);

export async function listApiKeys(companyId) {
    const { data } = await httpsCallable(functions, 'listCompanyApiKeys')({ companyId });
    return {
        keys: Array.isArray(data?.keys) ? data.keys : [],
        maxActiveKeys: Number.isInteger(data?.maxActiveKeys) ? data.maxActiveKeys : 5,
    };
}

/** Returns the new key, `key` included: the only time it leaves the server. */
export async function createApiKey({ companyId, name, scopes }) {
    const { data } = await httpsCallable(functions, 'createCompanyApiKey')({ companyId, name, scopes });
    return data;
}

export async function revokeApiKey({ companyId, keyId }) {
    const { data } = await httpsCallable(functions, 'revokeCompanyApiKey')({ companyId, keyId });
    return data;
}

const PLAIN = {
    'functions/permission-denied': 'Only a Company Admin can manage API keys.',
    'functions/unauthenticated': 'Your sign-in has ended. Sign in again and retry.',
    'functions/unavailable': 'We could not reach SafeHaul. Check your connection and try again.',
    'functions/deadline-exceeded': 'That took too long. Try again.',
    'functions/internal': 'Something went wrong on our side. Try again in a minute.',
};

/**
 * What to tell an admin when a call fails. The server writes its own refusals
 * (the key limit, a bad name, too many keys made just now) for this screen, so
 * those are shown as they are; anything else gets a plain sentence.
 */
export function apiKeyErrorMessage(error, fallback) {
    const code = error?.code || '';
    if (['functions/invalid-argument', 'functions/failed-precondition', 'functions/resource-exhausted', 'functions/not-found']
        .includes(code) && error?.message) {
        return error.message;
    }
    return PLAIN[code] || fallback;
}
