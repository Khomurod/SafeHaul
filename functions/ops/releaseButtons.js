/**
 * The release offer's buttons (`./releaseOffer.js`), pressed in Telegram.
 *
 * "Выпустить" asks again ("Да, выпустить" / "Отмена"); only "Да, выпустить"
 * releases, through the same engine and checks as Super Admin → Releases
 * (`runPromotion`): the release Testing serves, still eligible, and still the
 * one this message offered. A press counts only from the alert chat and only
 * from `approverId`, the person who pressed Start on the console's one-time
 * link; a super admin with recent sign-in handed that link out, so it stands in
 * for the console's own sign-in check. Anyone else's press changes nothing. A
 * button on an older offer says a newer release exists and loses its buttons.
 */

const { db } = require('../firebaseAdmin');
const { ACTIONS } = require('../environmentVault/audit');
const { runPromotion } = require('../releaseManagement/promote');
const settings = require('./alertSettings');
const telegram = require('./telegram');
const offers = require('./releaseOffer');

const DATA = /^rel:(ask|yes|no|back):([0-9a-f]{40})$/;

/** A refused promotion, in the owner's words; the engine's own text stays in English for the console. */
function refusalText(error) {
    if (error?.code === 'aborted') return 'Уже идёт другой выпуск. Дождитесь его окончания и нажмите ещё раз.';
    if (error?.code === 'failed-precondition') {
        return 'Версия на тестовом сайте изменилась или ещё не прошла все проверки. Дождитесь нового сообщения.';
    }
    return 'Сервис выпуска сейчас недоступен. Попробуйте ещё раз через несколько минут или выпустите в панели Super Admin → Releases.';
}

/** A second press of the same button asks for the message it already shows. */
function unlessUnchanged(error) {
    if (error?.code !== 'not_modified') throw error;
}

/**
 * Moves the offer from one status to another, only if it is still in the first
 * and still for `sha`: two presses, or Telegram sending one press twice,
 * cannot both start a release.
 */
async function moveOffer(sha, from, patch) {
    const ref = offers.offerRef();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const offer = snapshot.exists ? snapshot.data() : null;
        if (offer?.sha !== sha || offer.status !== from) return false;
        transaction.set(ref, patch, { merge: true });
        return true;
    });
}

async function release(token, query, offer, connection) {
    const { sha, chatId, messageId, text } = offer;
    if (!(await moveOffer(sha, 'offered', { status: 'releasing', confirmedAt: new Date().toISOString() }))) {
        return telegram.answerButton(token, query.id, 'Этот выпуск уже запущен или отменён.');
    }
    await telegram.answerButton(token, query.id, 'Запускаю выпуск…').catch(() => {});

    let result;
    try {
        result = await runPromotion({
            auth: { uid: `telegram:${query.from.id}`, token: {} },
            kind: 'promote',
            action: ACTIONS.PROMOTE,
            resolveCandidate: (state) => (state.testing?.eligible ? state.testing.sha : null),
            expectedSha: sha,
            reason: `Released from Telegram by ${connection.approverName || 'the owner'}.`,
        });
    } catch (error) {
        // Nothing was dispatched: the offer stands, and the button can be pressed again.
        await offers.offerRef().set({ status: 'offered' }, { merge: true });
        await telegram.editMessage(token, chatId, messageId, `${text}\n\nНе удалось запустить: ${refusalText(error)}`,
            offers.OFFER_ROWS(sha));
        return undefined;
    }

    if (result.status === 'already-live') {
        await offers.offerRef().set({ status: 'done' }, { merge: true });
        return telegram.editMessage(token, chatId, messageId, `${text}\n\nЭта версия уже на ${offers.PRODUCTION_HOST}.`, null);
    }
    await offers.offerRef().set({ requestId: result.requestId }, { merge: true });
    return telegram.editMessage(token, chatId, messageId,
        `${text}\n\nВыпуск запущен. Сообщу сюда, когда ${offers.PRODUCTION_HOST} обновится (обычно 3–5 минут).`, null);
}

/**
 * One press of an offer's button.
 *
 * @param {object} query Telegram's `callback_query`
 * @param {string} token the bot token, already used to check the request
 */
async function handleButton(query, token) {
    const answer = (text) => telegram.answerButton(token, query?.id, text).catch(() => {});
    const match = DATA.exec(String(query?.data || ''));
    if (!match || !query?.id) return answer();
    const [, step, sha] = match;

    const { telegram: connection = {} } = await settings.readSettings();
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    if (connection.chatId === undefined || connection.chatId === null || chatId !== connection.chatId) {
        return answer('Эта кнопка не из чата уведомлений SafeHaul.');
    }
    if (!connection.approverId || query.from?.id !== connection.approverId) {
        return answer('Выпускать может только владелец, который подключил этот чат.');
    }

    const offer = await offers.readOffer();
    if (offer?.sha !== sha || offer.messageId !== messageId) {
        const shown = typeof query.message?.text === 'string' ? query.message.text : 'SafeHaul';
        await telegram.editMessage(token, chatId, messageId,
            `${shown}\n\nУстарело: на тестовом сайте уже есть версия новее.`, null).catch(() => {});
        return answer('Уже есть версия новее — смотрите последнее сообщение.');
    }
    if (offer.status !== 'offered') return answer('Этот выпуск уже запущен или отменён.');

    if (step === 'ask') {
        await telegram.editMessage(token, chatId, messageId,
            `${offer.text}\n\nТочно выпустить версию ${sha.slice(0, 7)} на ${offers.PRODUCTION_HOST}?`, offers.CONFIRM_ROWS(sha))
            .catch(unlessUnchanged);
        return answer();
    }
    if (step === 'back') {
        await telegram.editMessage(token, chatId, messageId, offer.text, offers.OFFER_ROWS(sha)).catch(unlessUnchanged);
        return answer();
    }
    if (step === 'no') {
        if (await moveOffer(sha, 'offered', { status: 'declined' })) {
            await telegram.editMessage(token, chatId, messageId,
                `${offer.text}\n\nНе сейчас. Выпустить её можно позже в панели Super Admin → Releases.`, null);
        }
        return answer('Хорошо, не сейчас.');
    }
    return release(token, query, offer, connection);
}

module.exports = { handleButton, refusalText };
