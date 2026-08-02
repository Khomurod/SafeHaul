/**
 * Super Admin → Blog Posts callables.
 *
 * Deliberately minimal. The blog publishes automatically, so there is no
 * approval queue, no editor and no draft state to manage: the only thing an
 * operator needs is to see what was published and remove anything that should
 * not have been. Two callables, and one of them is a list.
 *
 * Reuses the environment vault's guards and audit trail, so deletion requires
 * the exact super-admin role and recent authentication, is rate limited, and is
 * recorded without the article body.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const { guardPrivileged, assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const store = require('./store');
const mediaCredentials = require('./media/credentials');
const { PROVIDERS: MEDIA_PROVIDERS, PROVIDERS_BY_ID } = require('./media/imageProviders');
const { publishDueSlots } = require('./scheduler');

function safeFailure(error, label) {
    if (error instanceof HttpsError) throw error;
    console.error(`[blog/${label}] ${error?.message || 'unknown error'}`);
    throw new HttpsError('internal', 'The request could not be completed.');
}

exports.listBlogPosts = onCall({ cors: true }, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: 'Blog posts' });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: 'Blog posts' });

    try {
        const posts = await store.listForAdmin({ limit: 150 });
        return {
            // Title and delete action are the whole screen. A publication date
            // is included because two articles can share a title theme and the
            // date is what tells them apart.
            posts: posts.map((post) => ({
                id: post.id,
                title: post.title,
                publicationDate: post.publicationDate,
                status: post.status,
            })),
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        return safeFailure(error, 'listBlogPosts');
    }
});

exports.deleteBlogPost = onCall({ cors: true }, async (request) => {
    const postId = String(request.data?.postId || '');

    await guardPrivileged(request, 'mutate', ACTIONS.DELETE, { entryId: postId, integration: 'Blog posts' });

    try {
        // Ids are `YYYY-MM-DD_theme`. Validating the shape keeps an arbitrary
        // path out of a document reference.
        if (!/^\d{4}-\d{2}-\d{2}_[a-z-]{3,40}$/.test(postId)) {
            throw new HttpsError('invalid-argument', 'That is not a valid post id.');
        }

        const result = await store.softDeletePost(postId);
        if (!result.deleted && !result.title) {
            throw new HttpsError('not-found', 'That post no longer exists.');
        }

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.SUCCESS,
            metadata: {
                entryId: postId,
                integration: 'Blog posts',
                // The title identifies which article was removed. The body,
                // sources and generation record are not recorded here.
                key: result.title ? result.title.slice(0, 200) : postId,
            },
        });

        return { postId, deleted: true };
    } catch (error) {
        return safeFailure(error, 'deleteBlogPost');
    }
});

// ---------------------------------------------------------------------------
// Research & Media credentials, shown inside AI Integrations
// ---------------------------------------------------------------------------

exports.listMediaProviders = onCall({ cors: true }, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: 'Blog media' });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: 'Blog media' });

    try {
        const configured = await mediaCredentials.readAllMediaCredentials();
        return {
            providers: MEDIA_PROVIDERS.map((provider) => ({
                id: provider.id,
                displayName: provider.displayName,
                priority: provider.priority,
                licenceName: provider.licenceName,
                licenceUrl: provider.licenceUrl,
                allowsHosting: provider.allowsHosting,
                attributionRequired: provider.attributionRequired,
                // Openverse serves anonymous requests, so it is usable with no
                // credential at all. Saying so avoids an operator hunting for a
                // key that does not exist.
                requiresCredential: provider.id !== 'openverse',
                credentialFields: provider.secretFields.map((field) => ({
                    name: field.name,
                    label: field.label,
                    description: field.description,
                    configured: Boolean(configured.get(provider.id)?.[field.name]),
                    maskedValue: '********',
                })),
                configured: configured.has(provider.id) || provider.id === 'openverse',
            })),
        };
    } catch (error) {
        return safeFailure(error, 'listMediaProviders');
    }
});

exports.saveMediaCredential = onCall({ cors: true }, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const fieldName = String(request.data?.field || '');
    const value = request.data?.value;

    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { providerId, field: fieldName });

    try {
        const provider = PROVIDERS_BY_ID.get(providerId);
        if (!provider) throw new HttpsError('not-found', 'Unknown media provider.');
        if (!provider.secretFields.some((field) => field.name === fieldName)) {
            throw new HttpsError('not-found', 'Unknown credential field.');
        }
        if (typeof value !== 'string' || !value.trim()) {
            throw new HttpsError('invalid-argument', 'A credential value is required.');
        }
        if (value.length > 4096) {
            throw new HttpsError('invalid-argument', 'That value is too long to be a credential.');
        }

        const saved = await mediaCredentials.writeMediaSecret(provider.id, fieldName, value.trim());

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: {
                providerId: provider.id,
                field: fieldName,
                key: saved.secretId,
                integration: `${provider.displayName} (media)`,
                sensitivity: 'sensitive',
                valueLength: saved.valueLength,
            },
        });

        return { providerId: provider.id, field: fieldName, saved: true };
    } catch (error) {
        return safeFailure(error, 'saveMediaCredential');
    }
});

exports.deleteMediaCredential = onCall({ cors: true }, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const fieldName = String(request.data?.field || '');

    await guardPrivileged(request, 'mutate', ACTIONS.DELETE, { providerId, field: fieldName });

    try {
        const provider = PROVIDERS_BY_ID.get(providerId);
        if (!provider) throw new HttpsError('not-found', 'Unknown media provider.');
        if (!provider.secretFields.some((field) => field.name === fieldName)) {
            throw new HttpsError('not-found', 'Unknown credential field.');
        }

        const result = await mediaCredentials.destroyMediaSecret(provider.id, fieldName);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.SUCCESS,
            metadata: {
                providerId: provider.id,
                field: fieldName,
                key: result.secretId,
                integration: `${provider.displayName} (media)`,
                entryCount: result.destroyed,
            },
        });

        return { providerId: provider.id, field: fieldName, deleted: true };
    } catch (error) {
        return safeFailure(error, 'deleteMediaCredential');
    }
});

/**
 * Runs the publication pass on demand.
 *
 * The same idempotent code path the schedule uses, so this cannot double-publish
 * a slot. Useful when an operator wants to fill a slot missed during a provider
 * outage without waiting for the next hour.
 */
exports.runBlogPublicationNow = onCall({
    cors: true,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: ['GROQ_API_KEY'],
}, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { integration: 'Blog publication' });

    try {
        const summary = await publishDueSlots();

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: {
                integration: 'Blog publication',
                setting: 'manual-run',
                entryCount: summary.published,
            },
        });

        return {
            dueCount: summary.dueCount,
            attempted: summary.attempted,
            published: summary.published,
            // Outcomes and slot keys only — no article content.
            results: summary.results.map((entry) => ({
                slot: entry.slot.key,
                theme: entry.slot.themeId,
                outcome: entry.outcome,
                detail: entry.detail || null,
            })),
        };
    } catch (error) {
        return safeFailure(error, 'runBlogPublicationNow');
    }
});
