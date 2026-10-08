// functions/ai/credentials/modelLists.js
//
// The write side of the saved model lists: what a daily model check found for
// one provider (`modelCheck`), and the lanes whose versions it changed
// (`modelLists`, read by `../registry/savedModels.js`). Both are merged into the
// provider's own config document, as health is, so nothing else in it moves.
//
// A lane's list is written only with versions that passed the check, and never
// empty (`../tasks/modelCheck.js`). `clearModelLists` forgets every saved list,
// so the built-in ones apply again.

const { admin } = require('../../firebaseAdmin');
const { configRef } = require('./configDoc');

/**
 * @param {string} providerId
 * @param {object} patch
 * @param {object} [patch.modelLists] `{ [lane]: { models, verifiedAt, seed } }` for the lanes that changed
 * @param {object} patch.modelCheck what the check found
 */
async function saveModelCheck(providerId, { modelLists, modelCheck }) {
    const update = { modelCheck, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (modelLists && Object.keys(modelLists).length > 0) update.modelLists = modelLists;
    await configRef(providerId).set(update, { merge: true });
}

async function clearModelLists(providerId) {
    await configRef(providerId).set({
        modelLists: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

module.exports = { saveModelCheck, clearModelLists };
