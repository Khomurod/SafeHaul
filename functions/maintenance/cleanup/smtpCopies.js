/**
 * Data cleanup → old SMTP password copies.
 *
 * A company's email is sent with the first stored settings that hold a
 * password (`shared/smtpSettings.js`): the server-only
 * `system_settings/email_config`, then the company document's `emailSettings`,
 * which the whole team can read, then the oldest `integrations/email_settings`,
 * which company admins can read. Saves before encryption left plain text in
 * any of them.
 *
 * Per company, in one transaction:
 *  1. `email_config` gets the password the company sends with now, encrypted:
 *     re-encrypted where it is plain text, or copied, with its server, port,
 *     account and signature, from the older place email is sent from today;
 *  2. only then are the copies on the company document and in
 *     `integrations/email_settings` deleted.
 * Before anything is written, the settings email would be sent with afterwards
 * are worked out and must equal today's, the password decrypted from the new
 * encrypted value. A company where they do not, or whose stored password
 * cannot be decrypted, is left exactly as it is and counted as `unverifiable`.
 * So no company is ever left without the password it sends with.
 */
const {
    effectiveStoredSettings, isSealed, normalizeSmtpSettings, sealPassword,
} = require('../../shared/smtpSettings');
const { companyIds, has } = require('./shared');

/** The fields a copy of the password is stored under, outside `email_config`. */
const COPY_KEYS = Object.freeze(['smtpPass', 'password']);

const holdsCopy = (stored, key) => has(stored, key) && Boolean(stored[key]);

const sameSettings = (a, b) => ['host', 'port', 'user', 'pass', 'signature'].every((key) => a[key] === b[key]);

function settingsOrNull(stored) {
    try {
        return normalizeSmtpSettings(stored);
    } catch {
        return null;
    }
}

/**
 * What one company needs, from its three stored places. Null when nothing;
 * `{ unverifiable: true }` when it must be left alone.
 */
function planCompany({ company, config, oldest }, FieldValue) {
    const legacy = company?.emailSettings;
    const companyCopies = COPY_KEYS.filter((key) => holdsCopy(legacy, key));
    const oldestCopies = COPY_KEYS.filter((key) => holdsCopy(oldest, key));
    const source = effectiveStoredSettings(config, legacy, oldest);
    if (!source) return null;

    const fromConfig = source === config;
    const reseal = fromConfig && Boolean(config.smtpPass) && !isSealed(config.smtpPass);
    if (fromConfig && !reseal && companyCopies.length + oldestCopies.length === 0) {
        return config.smtpPass ? null : { unverifiable: true };
    }
    // A password `email_config` holds under another name is a shape no save writes.
    if (fromConfig && !config.smtpPass) return { unverifiable: true };

    const before = settingsOrNull(source);
    if (!before || !before.pass) return { unverifiable: true };

    let configWrite = null;
    if (!fromConfig) {
        configWrite = {
            smtpHost: before.host,
            smtpPort: before.port,
            smtpUser: before.user,
            smtpPass: sealPassword(before.pass),
            signature: before.signature,
            isVerified: source.isVerified === true,
            migratedFrom: source === legacy ? 'company_emailSettings' : 'integrations_email_settings',
            migratedAt: FieldValue.serverTimestamp(),
        };
    } else if (reseal) {
        configWrite = { smtpPass: sealPassword(before.pass) };
    }

    const nextConfig = configWrite ? { ...(config || {}), ...configWrite } : config;
    const after = isSealed(nextConfig.smtpPass) ? settingsOrNull(nextConfig) : null;
    if (!after || !sameSettings(before, after)) return { unverifiable: true };

    return { configWrite, companyCopies, oldestCopies, resealed: reseal, copied: !fromConfig };
}

function refsFor(db, companyId) {
    const company = db.collection('companies').doc(companyId);
    return {
        company,
        config: company.collection('system_settings').doc('email_config'),
        oldest: company.collection('integrations').doc('email_settings'),
    };
}

const dataOf = (snap) => (snap.exists ? snap.data() : null);

async function readPlaces(reader, refs) {
    const [company, config, oldest] = await Promise.all([reader(refs.company), reader(refs.config), reader(refs.oldest)]);
    return { company: dataOf(company), config: dataOf(config), oldest: dataOf(oldest) };
}

/** Applies the plan in a transaction that reads the three places again. */
function applyPlan(ctx, refs) {
    const remove = ctx.FieldValue.delete();
    const deletions = (keys, prefix) => Object.fromEntries(keys.map((key) => [`${prefix}${key}`, remove]));
    return ctx.db.runTransaction(async (transaction) => {
        const plan = planCompany(await readPlaces((ref) => transaction.get(ref), refs), ctx.FieldValue);
        if (!plan || plan.unverifiable) return plan;
        if (plan.configWrite) transaction.set(refs.config, plan.configWrite, { merge: true });
        if (plan.companyCopies.length) transaction.update(refs.company, deletions(plan.companyCopies, 'emailSettings.'));
        if (plan.oldestCopies.length) transaction.update(refs.oldest, deletions(plan.oldestCopies, ''));
        return plan;
    });
}

async function sweep(ctx) {
    const counts = { companies: 0, resealed: 0, copiedToConfig: 0, copiesRemoved: 0, unverifiable: 0 };
    for (const companyId of await companyIds(ctx.db)) {
        if (ctx.outOfTime()) return { done: false, counts, total: counts.companies };
        const refs = refsFor(ctx.db, companyId);
        const plan = ctx.apply
            ? await applyPlan(ctx, refs)
            : planCompany(await readPlaces((ref) => ref.get(), refs), ctx.FieldValue);
        if (!plan) continue;
        if (plan.unverifiable) {
            counts.unverifiable += 1;
            console.warn(`[dataCleanup] smtpCopies: ${companyId} left as it is: its SMTP password could not be verified.`);
            continue;
        }
        counts.companies += 1;
        if (plan.resealed) counts.resealed += 1;
        if (plan.copied) counts.copiedToConfig += 1;
        counts.copiesRemoved += plan.companyCopies.length + plan.oldestCopies.length;
    }
    return { done: true, counts, total: counts.companies };
}

module.exports = { sweep, planCompany };
