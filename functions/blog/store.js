/**
 * Blog post storage.
 *
 * Collection: `blog_posts`, keyed by `${publicationDate}_${themeId}`.
 *
 * The document id *is* the idempotency mechanism. A create uses Firestore's
 * `create()`, which fails if the document already exists, so a scheduler retry,
 * a duplicated Pub/Sub delivery and a catch-up run all lose the race rather
 * than producing a second article for the same date and theme. There is no
 * check-then-write window to lose.
 *
 * Deletion is a tombstone: `status` becomes `deleted` and `deletedAt` is
 * stamped, but the row survives. Public reads filter on `status === 'published'`
 * so the post disappears from the site immediately, while duplicate prevention
 * can still see that the topic was already covered — otherwise deleting a post
 * would invite the generator to rewrite the same story the same day.
 */

const { admin, db } = require('../firebaseAdmin');
const { slotKey, THEME_IDS } = require('./pipeline/themes');

const COLLECTION = 'blog_posts';

const STATUS = Object.freeze({
    PUBLISHED: 'published',
    DELETED: 'deleted',
});

/** How far back duplicate prevention looks. */
const DUPLICATE_WINDOW_DAYS = 60;

function collection() {
    return db.collection(COLLECTION);
}

/**
 * Creates a post, refusing to overwrite an existing slot.
 *
 * @returns {Promise<{ created: boolean, id: string }>} `created: false` when the
 *   slot was already filled, which is a normal retry outcome and not an error.
 */
async function createPost(post) {
    const id = slotKey(post.publicationDate, post.theme);
    const ref = collection().doc(id);

    try {
        await ref.create({
            ...post,
            id,
            status: STATUS.PUBLISHED,
            publishedAt: admin.firestore.FieldValue.serverTimestamp(),
            modifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedAt: null,
        });
        return { created: true, id };
    } catch (error) {
        // ALREADY_EXISTS. Another run filled this slot first; that is the
        // duplicate-safety guarantee working, not a failure.
        if (error?.code === 6 || /ALREADY_EXISTS/i.test(error?.message || '')) {
            return { created: false, id };
        }
        throw error;
    }
}

/** Whether a slot already holds a post, deleted or not. */
async function slotIsFilled(publicationDate, themeId) {
    const snapshot = await collection().doc(slotKey(publicationDate, themeId)).get();
    return snapshot.exists;
}

/** Which of a date's three slots still need an article. */
async function unfilledSlots(dueSlotList) {
    const results = [];
    for (const slot of dueSlotList) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await slotIsFilled(slot.publicationDate, slot.themeId))) results.push(slot);
    }
    return results;
}

function toPublicPost(doc) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        title: data.title,
        slug: data.slug,
        excerpt: data.excerpt,
        theme: data.theme,
        contentBlocks: data.contentBlocks || [],
        image: data.image || null,
        sources: data.sources || [],
        seo: data.seo || {},
        publicationDate: data.publicationDate,
        publishedAt: data.publishedAt?.toDate?.()?.toISOString() || null,
        modifiedAt: data.modifiedAt?.toDate?.()?.toISOString() || null,
    };
}

/**
 * Published posts, newest first. Every public read path goes through this, so
 * the `status` filter cannot be forgotten in one place and applied in another.
 */
async function listPublished({ limit = 20, offset = 0 } = {}) {
    const capped = Math.max(1, Math.min(Number(limit) || 20, 100));
    const snapshot = await collection()
        .where('status', '==', STATUS.PUBLISHED)
        .orderBy('publicationDate', 'desc')
        .limit(capped + Math.max(0, offset))
        .get();

    return snapshot.docs.slice(offset).map(toPublicPost);
}

/**
 * One published post by slug.
 *
 * @returns {Promise<object|null>} null for an unknown, unpublished or deleted
 *   slug — a deleted post must be indistinguishable from one that never existed.
 */
async function findPublishedBySlug(slug) {
    const snapshot = await collection()
        .where('slug', '==', slug)
        .where('status', '==', STATUS.PUBLISHED)
        .limit(1)
        .get();

    return snapshot.empty ? null : toPublicPost(snapshot.docs[0]);
}

/** Every post including tombstones, for the Super Admin list. */
async function listForAdmin({ limit = 100 } = {}) {
    const capped = Math.max(1, Math.min(Number(limit) || 100, 200));
    const snapshot = await collection()
        .orderBy('publicationDate', 'desc')
        .limit(capped)
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
            id: doc.id,
            title: data.title,
            slug: data.slug,
            theme: data.theme,
            status: data.status,
            publicationDate: data.publicationDate,
            publishedAt: data.publishedAt?.toDate?.()?.toISOString() || null,
        };
    });
}

/**
 * Tombstones a post.
 *
 * @returns {Promise<{ deleted: boolean, title: string|null }>}
 */
async function softDeletePost(id) {
    const ref = collection().doc(String(id));
    const snapshot = await ref.get();
    if (!snapshot.exists) return { deleted: false, title: null };

    const data = snapshot.data() || {};
    if (data.status === STATUS.DELETED) return { deleted: false, title: data.title || null };

    await ref.update({
        status: STATUS.DELETED,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        modifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { deleted: true, title: data.title || null };
}

/**
 * Recent posts for duplicate prevention.
 *
 * Includes tombstoned posts on purpose: a deleted post still means "we covered
 * this", so the generator does not immediately rewrite it.
 */
async function recentForDeduplication({ days = DUPLICATE_WINDOW_DAYS, now = Date.now() } = {}) {
    const cutoff = new Date(now - (days * 24 * 60 * 60 * 1000));
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const snapshot = await collection()
        .where('publicationDate', '>=', cutoffDate)
        .orderBy('publicationDate', 'desc')
        .limit(400)
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
            id: doc.id,
            title: data.title || '',
            normalizedTitle: data.normalizedTitle || '',
            theme: data.theme,
            sourceFingerprint: data.sourceFingerprint || '',
            sourceUrls: (data.sources || []).map((source) => source.url).filter(Boolean),
            topicTokens: data.topicTokens || [],
            publicationDate: data.publicationDate,
        };
    });
}

/** Slugs of published posts, for the sitemap and feed. */
async function listPublishedSlugs({ limit = 500 } = {}) {
    const snapshot = await collection()
        .where('status', '==', STATUS.PUBLISHED)
        .orderBy('publicationDate', 'desc')
        .limit(Math.min(Number(limit) || 500, 1000))
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
            slug: data.slug,
            publicationDate: data.publicationDate,
            modifiedAt: data.modifiedAt?.toDate?.()?.toISOString() || null,
        };
    });
}

module.exports = {
    COLLECTION,
    STATUS,
    DUPLICATE_WINDOW_DAYS,
    THEME_IDS,
    createPost,
    slotIsFilled,
    unfilledSlots,
    listPublished,
    findPublishedBySlug,
    listForAdmin,
    softDeletePost,
    recentForDeduplication,
    listPublishedSlugs,
    toPublicPost,
};
