import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Client for the Super Admin Blog Posts callables.
 *
 * Two operations, because the blog publishes automatically and there is nothing
 * to approve, schedule or edit. Re-authentication handling is shared with the
 * environment vault for the same reason as `./aiIntegrations.js`.
 */

export {
    ReauthCancelledError,
    isReauthCancelled,
    isReauthRequired,
    reauthenticateWithPassword,
} from './environmentVault';

export function describeBlogError(error, fallback = 'That operation could not be completed.') {
    if (!error) return fallback;
    switch (error.code) {
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/permission-denied':
            return 'Super Admin access is required for this action.';
        case 'functions/resource-exhausted':
            return 'Too many requests. Wait a moment and try again.';
        case 'functions/not-found':
            return 'That article no longer exists. Refresh the list.';
        case 'functions/invalid-argument':
        case 'functions/failed-precondition':
            return error.message?.replace(/^.*?:\s*/, '') || fallback;
        default:
            return fallback;
    }
}

export async function listBlogPosts() {
    const call = httpsCallable(functions, 'listBlogPosts');
    const result = await call({});
    return result.data;
}

export async function deleteBlogPost(postId) {
    const call = httpsCallable(functions, 'deleteBlogPost');
    const result = await call({ postId });
    return result.data;
}

/**
 * Runs the publication pass immediately.
 *
 * The same idempotent path the hourly schedule uses, so it cannot double-publish
 * a slot. Useful for filling a slot missed during a provider outage.
 */
export async function runBlogPublicationNow() {
    const call = httpsCallable(functions, 'runBlogPublicationNow');
    const result = await call({});
    return result.data;
}
