/**
 * The alert bot's webhook: Telegram posts the bot's updates here, and only a
 * request carrying the bot's secret header is read (`./telegramInbox.js`).
 */

const { onRequest } = require('firebase-functions/v2/https');

const settings = require('./alertSettings');
const inbox = require('./telegramInbox');

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
        await inbox.recordUpdate(req.body);
    } catch (error) {
        // A non-200 makes Telegram send the update again, which is what a failed write wants.
        console.error(`[ops/telegramWebhook] ${error?.name || 'Error'}${error?.code ? ` code=${error.code}` : ''}`);
        res.status(500).send('');
        return;
    }
    res.status(200).send('');
}

exports.telegramWebhook = onRequest({ region: inbox.REGION, invoker: 'public', memory: '256MiB', maxInstances: 2 }, handleUpdate);
exports.handleUpdate = handleUpdate;
