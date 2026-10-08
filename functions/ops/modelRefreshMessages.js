/**
 * What the daily model check tells the owner in Telegram, in Russian, and when.
 *
 * Two kinds of news:
 *
 * - **A list changed**: told once, when it happens. Nothing to do. If it could
 *   not be sent, the job keeps it (`pendingNews`) and sends it with the
 *   provider's next check.
 * - **A state changed**: a lane stopped passing or passed again, or the account
 *   (key, allowance) went wrong or right again. Told on the change only, against
 *   what the owner was last told (`modelCheck.notified`), so a provider failing
 *   all day is one message, not twenty-four. A newly connected chat hears what
 *   is still wrong. When the owner must act, the message says what to do.
 *   A suggestion made while auto-select is off is told the same way: once, and
 *   again only when the check suggests something else.
 *
 * Provider names come from the registry and models from vendor catalogues;
 * nothing a person typed reaches a message.
 */

const { LANES } = require('../ai/registry/capabilities');
const { RESULT } = require('../ai/tasks/modelVerification');

const LANE_WORDS = Object.freeze({
    [LANES.VISION]: 'чтение фото и документов',
    [LANES.TEXT]: 'тексты',
});

function why(result, lane) {
    switch (result) {
        case RESULT.GONE: return 'убрана или недоступна на вашем тарифе';
        case RESULT.MISREAD: return lane === LANES.VISION ? 'неверно прочитала выдуманные права' : 'ответила не по форме';
        case RESULT.REFUSED: return 'отклонила запрос';
        case RESULT.BUSY: return 'сервис был занят';
        default: return 'ошибка проверки';
    }
}

/** A lane's state as the owner hears it: working, or not. Unknown is not news. */
function laneState(status) {
    if (status === 'ok') return 'ok';
    if (status === 'failing') return 'failing';
    return null;
}

/**
 * The lines for one provider's check, and the state now told.
 *
 * @param {object} params
 * @param {string} params.name the provider's display name
 * @param {object} params.check what `checkProvider` returned
 * @param {object} params.notified what the owner was last told: `{ [lane]: 'ok'|'failing', account,
 *   [`${lane}Suggested`]: the versions suggested }`
 * @returns {{ lines: string[], notified: object, news: string[] }} `news`: the list changes among
 *   `lines`, which no later check can see again, so they wait for delivery
 */
function notesFor({ name, check, notified = {} }) {
    const lines = [];
    const news = [];
    const told = { ...notified };

    const account = check.account || null;
    if (account !== (notified.account || null)) {
        if (account === RESULT.KEY) {
            lines.push(`⚠️ ${name}: ключ не принимается. Что сделать: Super Admin → AI Integrations → ${name} → замените ключ. Пока работают другие сервисы.`);
        } else if (account === RESULT.QUOTA) {
            lines.push(`⚠️ ${name}: закончился лимит или деньги на счёте. Что сделать: проверьте тариф и оплату в кабинете ${name}. Пока работают другие сервисы.`);
        } else {
            lines.push(`✅ ${name}: ключ и лимит снова в порядке.`);
        }
        told.account = account;
    }

    for (const [lane, result] of Object.entries(check.lanes || {})) {
        const words = LANE_WORDS[lane] || lane;
        if (result.changed) {
            const parts = [`🔄 ${name}, ${words}: теперь ${result.models.join(', ')}.`];
            for (const { model, result: outcome } of result.dropped || []) parts.push(`Убрана ${model}: ${why(outcome, lane)}.`);
            for (const model of result.added || []) {
                parts.push(`Добавлена ${model}: прошла проверку на ${lane === LANES.VISION ? 'выдуманных правах' : 'тексте'}.`);
            }
            parts.push('Делать ничего не нужно.');
            news.push(parts.join(' '));
            lines.push(parts.join(' '));
        }
        const suggestionKey = `${lane}Suggested`;
        const suggestion = !result.changed && result.suggested ? result.suggested.join(', ') : null;
        if (suggestion && suggestion !== notified[suggestionKey]) {
            lines.push(`ℹ️ ${name}, ${words}: проверка предлагает ${suggestion}, но автоподбор выключен. Включить: Super Admin → AI Integrations.`);
        }
        // Written only when there is one, or one to forget: the record is merged.
        if (suggestion || told[suggestionKey]) told[suggestionKey] = suggestion;

        const state = laneState(result.status);
        if (!state || state === (notified[lane] || 'ok')) continue;
        if (state === 'failing') {
            const tried = (result.results || []).map(({ model, result: outcome }) => `${model}: ${why(outcome, lane)}`).join('; ');
            lines.push(`⚠️ ${name}, ${words}: не прошла проверку ни одна версия${tried ? ` (${tried})` : ''}. `
                + 'Пока работают другие сервисы. Приложение проверит снова в течение дня.');
        } else {
            lines.push(`✅ ${name}, ${words}: снова работает (${result.models[0]}).`);
        }
        told[lane] = state;
    }
    return { lines, notified: told, news };
}

/** One message for a whole run, or null when there is no news. */
function composeMessage(lines) {
    return lines.length > 0 ? `SafeHaul — проверка версий ИИ:\n\n${lines.join('\n\n')}` : null;
}

module.exports = { notesFor, composeMessage, LANE_WORDS };
