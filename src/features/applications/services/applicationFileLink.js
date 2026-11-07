/**
 * A short-lived link to a file a driver uploaded with their application.
 *
 * Signed server-side by `getSignedApplicationFileUrl`, which accepts only a
 * driver-upload path of a company the caller may access. A signed URL is a
 * capability, so it is never persisted — the same reasoning `useGuestFileUpload`
 * gives for storing only the `storagePath`. The dossier reuses one in memory for
 * ten minutes, in this tab and sign-in (`reusableApplicationFileUrl`), and signs a
 * record's files in one call (`reusableApplicationFileUrls`); a press always
 * signs afresh (`signedApplicationFileUrl`).
 */
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@lib/firebase';
import { isPevFilePath } from './pevFilePath';
import { isSealedDocumentPath } from './sealedDocumentPath';

/**
 * @param {string} storagePath e.g. `companies/{id}/applications/guest_uploads/…`
 * @returns {Promise<string>} a URL that opens the file
 */
export async function signedApplicationFileUrl(storagePath) {
    // A verification's request PDF and its result live in the PEV folders, which `getSignedPevUrl` signs;
    // a sealed e-document filed in the DQ file, in `secure_documents/`, which `getSignedDocumentUrl` signs.
    // Every name stays literal: `scripts/check-callable-contract.mjs` finds callables by them.
    let resign;
    if (isPevFilePath(storagePath)) resign = httpsCallable(functions, 'getSignedPevUrl');
    else if (isSealedDocumentPath(storagePath)) resign = httpsCallable(functions, 'getSignedDocumentUrl');
    else resign = httpsCallable(functions, 'getSignedApplicationFileUrl');
    const { data } = await resign({ storagePath });
    if (!data?.url) throw new Error('No link was returned for this file.');
    return data.url;
}

/** Links live an hour (`functions/shared/signReadUrl.js`); reusing one for ten
 *  minutes leaves every link shown at least fifty. */
export const FILE_LINK_REUSE_MS = 10 * 60 * 1000;

/** `storagePath` -> the signing in flight or done; a failed one is removed. Memory only. */
const reusable = new Map();
/** The `auth.currentUser` the held links were signed for: a new object at each sign-in. */
let reusableFor = null;

/** Drops every held link when `auth.currentUser` has changed (another sign-in or a sign-out). */
function forgetLinksOfAnotherSignIn() {
    if (auth.currentUser !== reusableFor) {
        reusable.clear();
        reusableFor = auth.currentUser;
    }
}

/** A link signed within ten minutes, or undefined. */
function heldLink(storagePath) {
    const held = reusable.get(storagePath);
    return held && Date.now() - held.at < FILE_LINK_REUSE_MS ? held.link : undefined;
}

/** Holds a signing for reuse; a failed one is removed. */
function hold(storagePath, link) {
    const entry = { link, at: Date.now() };
    reusable.set(storagePath, entry);
    link.catch(() => { if (reusable.get(storagePath) === entry) reusable.delete(storagePath); });
    return link;
}

/**
 * The dossier's link for a file: signed once, then reused for ten minutes in
 * this tab and sign-in. When `auth.currentUser` has changed since (another
 * sign-in or a sign-out), every held link is dropped before anything is reused.
 *
 * @param {string} storagePath
 * @returns {Promise<string>}
 */
export function reusableApplicationFileUrl(storagePath) {
    forgetLinksOfAnotherSignIn();
    return heldLink(storagePath) ?? hold(storagePath, signedApplicationFileUrl(storagePath));
}

/** The most files one `getSignedApplicationFileUrls` call takes (`functions/getSignedApplicationFileUrl.js`). */
export const MAX_FILES_PER_SIGNING = 8;

/** One file's link out of a `getSignedApplicationFileUrls` answer, or the reason it was refused. */
function linkFrom(data, storagePath) {
    const answer = data?.results?.[storagePath];
    if (answer?.url) return answer.url;
    if (answer?.error) {
        throw Object.assign(new Error(answer.error.message || 'This file could not be opened.'), {
            code: `functions/${answer.error.code}`,
        });
    }
    throw new Error('No link was returned for this file.');
}

/**
 * The dossier's links for a record's files, by path, each held and reused as
 * `reusableApplicationFileUrl` holds one. A link already held is reused; the
 * other driver uploads are signed together, up to eight in one
 * `getSignedApplicationFileUrls` call, which signs each as
 * `getSignedApplicationFileUrl` would. A file the server refuses fails alone;
 * when the call itself fails, each file is signed on its own instead. A PEV or
 * sealed-document path goes to its own signer, one at a time.
 *
 * @param {string[]} storagePaths
 * @returns {Record<string, Promise<string>>}
 */
export function reusableApplicationFileUrls(storagePaths) {
    forgetLinksOfAnotherSignIn();
    const links = {};
    const toSign = [];
    for (const storagePath of new Set(storagePaths)) {
        const held = heldLink(storagePath);
        if (held) links[storagePath] = held;
        else if (isPevFilePath(storagePath) || isSealedDocumentPath(storagePath)) {
            links[storagePath] = reusableApplicationFileUrl(storagePath);
        } else toSign.push(storagePath);
    }
    for (let start = 0; start < toSign.length; start += MAX_FILES_PER_SIGNING) {
        const group = toSign.slice(start, start + MAX_FILES_PER_SIGNING);
        // Every name stays literal: `scripts/check-callable-contract.mjs` finds callables by them.
        const signing = httpsCallable(functions, 'getSignedApplicationFileUrls')({ storagePaths: group });
        for (const storagePath of group) {
            links[storagePath] = hold(storagePath, signing.then(
                ({ data }) => linkFrom(data, storagePath),
                () => signedApplicationFileUrl(storagePath),
            ));
        }
    }
    return links;
}

/** For tests: forget every link. */
export function forgetApplicationFileLinks() {
    reusable.clear();
    reusableFor = null;
}
