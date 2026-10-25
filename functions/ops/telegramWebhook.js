/**
 * The alert bot's webhook: Telegram posts the bot's updates here, and only a
 * request carrying the bot's secret header is read (`./telegramInbox.js`).
 * A Start goes to the inbox; a button press to `./releaseButtons.js`, which can
 * start a release and so needs the release credential.
 */

const { onRequest } = require('firebase-functions/v2/https');

const { SECRET_NAMES } = require('../releaseManagement/github');
const settings = require('./alertSettings');
const inbox = require('./telegramInbox');
const { handleButton } = require('./releaseButtons');

async function handleUpdate(req, res) {
    if (req.method !== 'POST') {
        res.status(405).send('');
        return;
    }
    try {
        const token = await settings.readBotToken();
        if (!inbox.secretMatches(req.get(inbox.SECRET_HEADER), token)) {
            res.status(401).send('');
            return;
        }
        if (req.body?.callback_query) await handleButton(req.body.callback_query, token);
        else await inbox.recordUpdate(req.body);
    } catch (error) {
        // A non-200 makes Telegram send the update again, which is what a failed write wants.
        console.error(`[ops/telegramWebhook] ${error?.name || 'Error'}${error?.code ? ` code=${error.code}` : ''}`);
        res.status(500).send('');
        return;
    }
    res.status(200).send('');
}

exports.telegramWebhook = onRequest({
    region: inbox.REGION,
    invoker: 'public',
    memory: '256MiB',
    maxInstances: 2,
    // A confirmed press runs the promotion: two minutes cover GitHub's slowest answers.
    timeoutSeconds: 120,
    secrets: SECRET_NAMES,
}, handleUpdate);
exports.handleUpdate = handleUpdate;
