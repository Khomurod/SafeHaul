/**
 * Offers each new Testing release to the owner in the alert chat, with a
 * button to put it on app.safehaul.io.
 *
 * Every ten minutes `offerProductionRelease` asks Release Management what
 * Testing serves. When that is a release the promotion engine would accept
 * (`eligible`) and Production does not serve it yet, the chat gets one message
 * for it: what changed since Production, the pre-release checklist, and two
 * buttons, "Выпустить на app.safehaul.io" and "Не сейчас". The presses are
 * handled by `./releaseButtons.js`. One message per release: a newer one takes
 * the older message's buttons away. While a release the owner started runs,
 * each run follows it instead and says how it ended (`./releaseFollow.js`).
 *
 * Nothing is offered until a chat is connected and the person who connected it
 * (`approverId`) is known, and none while the release credential is missing.
 * The offer is kept in `system_jobs/releaseOffer` (server-only).
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');

const { db } = require('../firebaseAdmin');
const { readReleaseStatus } = require('../releaseManagement/eligibility');
const { SECRET_NAMES, createReleaseApi, isCredentialConfigured } = require('../releaseManagement/github');
const settings = require('./alertSettings');
const telegram = require('./telegram');
const { followRelease } = require('./releaseFollow');

const OFFER_PATH = Object.freeze(['system_jobs', 'releaseOffer']);
const PRODUCTION_HOST = 'app.safehaul.io';
const CHECKLIST_URL = 'https://github.com/Khomurod/SafeHaul/blob/main/docs/RELEASE_CHECKLIST.md';
const MAX_CHANGES = 8;
const SHA = /^[0-9a-f]{40}$/;

const OFFER_ROWS = (sha) => [
    [{ text: `Выпустить на ${PRODUCTION_HOST}`, data: `rel:ask:${sha}` }],
    [{ text: 'Не сейчас', data: `rel:no:${sha}` }],
];

const CONFIRM_ROWS = (sha) => [
    [{ text: 'Да, выпустить', data: `rel:yes:${sha}` }],
    [{ text: 'Отмена', data: `rel:back:${sha}` }],
];

function offerRef() {
    return db.collection(OFFER_PATH[0]).doc(OFFER_PATH[1]);
}

async function readOffer() {
    const snapshot = await offerRef().get();
    return snapshot.exists ? snapshot.data() || null : null;
}

const shortSha = (sha) => String(sha || '').slice(0, 7);

/**
 * The pull requests merged into Testing since Production, oldest first, as
 * "#517 Title". A merge commit's message is "Merge pull request #N from …",
 * a blank line, then the pull request's title.
 */
async function changesSince(api, fromSha, toSha) {
    if (!SHA.test(String(fromSha || '')) || !SHA.test(String(toSha || ''))) return [];
    const comparison = await api(`/compare/${fromSha}...${toSha}`);
    const changes = [];
    for (const commit of Array.isArray(comparison?.commits) ? comparison.commits : []) {
        const match = /^Merge pull request #(\d+)[^\n]*\n\n([^\n]+)/.exec(String(commit?.commit?.message || ''));
        if (match) changes.push(`#${match[1]} ${match[2].trim().slice(0, 120)}`);
    }
    return changes;
}

function offerText(sha, changes) {
    const listed = changes.slice(-MAX_CHANGES).map((change) => `• ${change}`);
    if (changes.length > MAX_CHANGES) listed.unshift(`• …и ещё ${changes.length - MAX_CHANGES} раньше`);
    return [
        `SafeHaul: на тестовом сайте новая проверенная версия (${shortSha(sha)}).`,
        ...(listed.length ? ['', 'Что изменилось:', ...listed] : []),
        '',
        `Выпустить её на ${PRODUCTION_HOST}?`,
        `Перед выпуском — чек-лист: ${CHECKLIST_URL}`,
        'Меняется только сайт: сервер у тестового и рабочего сайтов общий. Откат — в панели Super Admin → Releases.',
    ].join('\n');
}

/**
 * Sends the offer for the release Testing serves, once, if there is one to make.
 *
 * @returns {Promise<{ offered?: string, skipped?: string, followed?: string }>}
 */
async function offerLatestRelease({ api }) {
    const { telegram: connection = {} } = await settings.readSettings();
    if (connection.chatId === undefined || connection.chatId === null || !connection.approverId) {
        return { skipped: 'no-approver' };
    }
    const token = await settings.readBotToken();
    if (!token) return { skipped: 'no-token' };

    const offer = await readOffer();
    // A release in flight finishes, and is reported, before the next is offered.
    if (offer?.status === 'releasing') {
        const outcome = await followRelease({ token, offer, offerRef: offerRef() });
        if (outcome === 'waiting') return { skipped: 'releasing' };
        return { followed: outcome };
    }

    const state = await readReleaseStatus({ api });
    const sha = state.testing?.eligible ? state.testing.sha : null;
    if (!SHA.test(String(sha || '')) || sha === state.production?.sha) return { skipped: 'nothing-new' };
    if (offer?.sha === sha) return { skipped: 'offered' };

    const changes = await changesSince(api, state.production?.sha, sha).catch(() => []);
    const text = offerText(sha, changes);

    if (offer?.status === 'offered' && offer.messageId) {
        // The older offer's buttons go: only the newest release is offered.
        await telegram.editMessage(token, offer.chatId, offer.messageId,
            `${offer.text}\n\nУстарело: на тестовом сайте уже есть версия новее.`, null).catch(() => {});
    }
    const messageId = await telegram.sendButtons(token, connection.chatId, text, OFFER_ROWS(sha));
    await offerRef().set({
        sha,
        chatId: connection.chatId,
        messageId,
        text,
        status: 'offered',
        offeredAt: new Date().toISOString(),
    });
    return { offered: sha };
}

exports.offerProductionRelease = onSchedule({
    schedule: '*/10 * * * *',
    timeZone: 'America/Chicago',
    secrets: SECRET_NAMES,
    memory: '256MiB',
    retryCount: 0,
}, async () => {
    if (!isCredentialConfigured()) return;
    try {
        await offerLatestRelease({ api: createReleaseApi() });
    } catch (error) {
        // The name and code only: a GitHub or Telegram error names nothing secret,
        // but a log needs none of it.
        console.error(`[ops/releaseOffer] ${error?.name || 'Error'}${error?.code ? ` code=${error.code}` : ''}`);
    }
});

Object.assign(exports, {
    OFFER_PATH,
    PRODUCTION_HOST,
    CHECKLIST_URL,
    OFFER_ROWS,
    CONFIRM_ROWS,
    offerRef,
    readOffer,
    changesSince,
    offerText,
    offerLatestRelease,
});
