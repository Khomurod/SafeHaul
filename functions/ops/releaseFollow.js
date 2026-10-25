/**
 * After the owner's Telegram press starts a release (`./releaseButtons.js`),
 * says in the same chat how it ended.
 *
 * Each run of `offerProductionRelease` follows the release in flight: the
 * promotion run on GitHub, reconciled the way Super Admin → Releases does
 * (`refreshPromotion`), and then what app.safehaul.io itself serves
 * (`/release.json`, as the release workflow and the daily health check read
 * it). Only when the live site names the released commit does the chat hear
 * "Готово"; a run that failed, or a site still serving something else, is
 * said plainly, with where to look. Either way the offer closes, so the next
 * release can be offered.
 */

const { db } = require('../firebaseAdmin');
const { listPromotionRuns } = require('../releaseManagement/github');
const { PROMOTIONS_COLLECTION, refreshPromotion, serialisePromotion } = require('../releaseManagement/promotionStore');
const telegram = require('./telegram');

const PRODUCTION_ORIGIN = 'https://app.safehaul.io';
const LIVE_TIMEOUT_MS = 10000;
/** A press that never got as far as a dispatch is given up on after this long. */
const STALL_MS = 15 * 60 * 1000;
/** The release workflow verifies the live site itself; past this, something is wrong. */
const RUN_LIMIT_MS = 60 * 60 * 1000;

const shortSha = (sha) => String(sha || '').slice(0, 7);

/** The commit app.safehaul.io serves now, or null when it cannot be read. */
async function readLiveSha({ fetchImpl = fetch } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
    try {
        const response = await fetchImpl(`${PRODUCTION_ORIGIN}/release.json?at=${Date.now()}`, {
            headers: { 'Cache-Control': 'no-cache' },
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const body = await response.json();
        return typeof body?.sha === 'string' ? body.sha : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function readPromotion(requestId) {
    return serialisePromotion(await db.collection(PROMOTIONS_COLLECTION).doc(requestId).get());
}

/**
 * Follows the offer's release one step. Returns what it said, or that it is
 * still waiting.
 *
 * @param {{ token: string, offer: object, offerRef: object, now?: number, fetchImpl?: Function }} options
 * @returns {Promise<'waiting'|'done'|'failed'>}
 */
async function followRelease({ token, offer, offerRef, now = Date.now(), fetchImpl }) {
    const startedAt = Date.parse(offer.confirmedAt) || now;
    const close = async (status, text) => {
        await telegram.sendMessage(token, offer.chatId, text);
        await offerRef.set({ status, finishedAt: new Date(now).toISOString() }, { merge: true });
        return status;
    };

    if (!offer.requestId) {
        if (now - startedAt < STALL_MS) return 'waiting';
        return close('failed', `SafeHaul: выпуск версии ${shortSha(offer.sha)} не запустился. `
            + 'Рабочий сайт не изменился. Выпустить можно в панели Super Admin → Releases.');
    }

    const promotion = await refreshPromotion(await readPromotion(offer.requestId), await listPromotionRuns());
    if (promotion?.status !== 'completed') {
        if (now - startedAt < RUN_LIMIT_MS) return 'waiting';
        return close('failed', `SafeHaul: выпуск версии ${shortSha(offer.sha)} идёт больше часа. `
            + 'Проверьте Super Admin → Releases.');
    }
    if (promotion.conclusion !== 'success') {
        return close('failed', `SafeHaul: выпуск версии ${shortSha(offer.sha)} не удался. Рабочий сайт остался прежним.`
            + `${promotion.runUrl ? `\nПодробности: ${promotion.runUrl}` : ''}`);
    }

    const live = await readLiveSha({ fetchImpl });
    if (live === offer.sha) {
        return close('done', `SafeHaul: готово. ${PRODUCTION_ORIGIN.replace('https://', '')} теперь такой же, `
            + `как тестовый сайт (версия ${shortSha(offer.sha)}).`);
    }
    return close('failed', `SafeHaul: выпуск версии ${shortSha(offer.sha)} завершился, но ${PRODUCTION_ORIGIN.replace('https://', '')} `
        + `${live ? `показывает версию ${shortSha(live)}` : 'не отвечает'}. Проверьте сайт и Super Admin → Releases.`);
}

module.exports = { PRODUCTION_ORIGIN, STALL_MS, RUN_LIMIT_MS, readLiveSha, followRelease };
