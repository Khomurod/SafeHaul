/**
 * Builds the Environment & Integrations inventory.
 *
 * ## The one rule this module exists to enforce
 *
 * **No plaintext ever leaves here.** Every row carries `maskedValue: '********'`
 * and a boolean-ish status; the actual value is only ever produced by
 * `values.js`, one explicitly requested entry at a time. `hasValue` is a
 * presence flag, not a value, and no length, prefix or suffix is included.
 *
 * ## Company expansion
 *
 * Company-scoped credential fields are enumerated with four collection-group
 * reads rather than per-company document reads, so the cost is independent of
 * tenant count. Rows are emitted only for companies that actually have the
 * integration document — a company with no SMS provider configured has no
 * credentials to inventory, and emitting a dozen "missing" rows for every tenant
 * would bury the real gaps. Fields that are absent *on an existing* integration
 * document do get a `missing` row, which is exactly where a real gap shows up.
 */

const { db } = require('../firebaseAdmin');
const {
    AVAILABILITY,
    CATEGORIES,
    COMPANY_TEMPLATES,
    GLOBAL_ENTRIES,
    SOURCES,
} = require('./registry');

/** The only value string the list response ever contains. */
const MASK = '********';

const STATUS = Object.freeze({
    CONFIGURED: 'configured',
    MISSING: 'missing',
    UNKNOWN: 'unknown',
});

/** Reads at most this many company names for row labelling. */
const COMPANY_NAME_LIMIT = 1000;

/**
 * Presence test used for every source.
 * An empty string is *not* configured — that is exactly how a blanked CI secret
 * reaches the runtime, and reporting it as configured would hide the outage.
 */
function isPresent(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    return true;
}

/** Serialisable row shape shared by global and company entries. */
function baseRow(entry) {
    return {
        id: entry.id,
        key: entry.key,
        displayName: entry.displayName,
        category: entry.category,
        integration: entry.integration,
        scope: entry.scope,
        source: entry.source,
        sensitivity: entry.sensitivity,
        description: entry.description,
        consumers: entry.consumers || [],
        availability: entry.availability,
        requiresDeployment: Boolean(entry.requiresDeployment),
        optional: Boolean(entry.optional),
        permissions: { ...entry.permissions },
        restrictions: { ...entry.restrictions },
        maskedValue: MASK,
    };
}

/**
 * Status for a global entry, evaluated against the source the row names.
 *
 * `browser-visible` rows are honestly reported as `unknown` here: the Cloud
 * Functions runtime has no access to the browser bundle's build-time values, so
 * the server genuinely cannot tell whether one is set. The client refines those
 * rows from its own static map — a presence boolean, never a value.
 */
function globalStatus(entry) {
    switch (entry.availability) {
        case AVAILABILITY.SERVER_RUNTIME:
            return isPresent(process.env[entry.key]) ? STATUS.CONFIGURED : STATUS.MISSING;
        case AVAILABILITY.KNOWN_LITERAL:
            return isPresent(entry.literalValue) ? STATUS.CONFIGURED : STATUS.MISSING;
        case AVAILABILITY.BROWSER_VISIBLE:
        case AVAILABILITY.NOT_RETRIEVABLE:
        default:
            return STATUS.UNKNOWN;
    }
}

function buildGlobalRows() {
    return GLOBAL_ENTRIES.map((entry) => ({
        ...baseRow(entry),
        status: globalStatus(entry),
        // The client resolves these two facts locally for build-time rows.
        statusResolvedBy: entry.availability === AVAILABILITY.BROWSER_VISIBLE ? 'client-bundle' : 'server',
        unavailableReason: entry.unavailableReason || null,
        companyId: null,
        companyName: null,
        documentPath: null,
        field: null,
        lastUpdated: null,
        updatedBy: null,
    }));
}

/**
 * Permissions for a company field, derived from its template definition.
 *
 * Editing additionally requires something to *be* there: the backend refuses an
 * update against an empty field and tells the operator to use Add instead, so
 * offering an enabled Edit control on an empty field would be a control that is
 * guaranteed to fail. Add covers that case, and its own reason says so.
 */
function companyPermissions(definition, { present, providerActive }) {
    const writable = Boolean(definition.editable) && providerActive;
    const editable = writable && present;
    const deletable = Boolean(definition.deletable) && present && providerActive;
    const addable = Boolean(definition.editable || definition.addable) && !present && providerActive;

    const editReason = editable
        ? null
        : (writable && !present
            ? 'Nothing is stored yet — use Add'
            : (definition.editReason || 'Source does not support editing'));

    return {
        permissions: {
            revealable: present,
            editable,
            replaceable: editable,
            addable,
            deletable,
            testable: Boolean(definition.testable),
        },
        restrictions: {
            edit: editReason,
            replace: editReason,
            add: addable ? null : (present ? 'The key already exists' : 'Source does not support adding keys here'),
            delete: deletable
                ? null
                : (present ? (definition.deleteReason || 'Source does not support deletion') : 'Nothing stored to delete'),
        },
    };
}

/**
 * Builds one company-scoped row.
 *
 * @param {object} params
 * @param {string} params.templateId Key into `COMPANY_TEMPLATES`.
 * @param {object} params.definition Field definition from the template.
 * @param {string} params.companyId
 * @param {string|null} params.companyName
 * @param {string} params.documentPath Firestore path of the owning document.
 * @param {boolean} params.present Whether a value is stored.
 * @param {string|null} params.instanceKey Stable, unique instance identifier
 *   (a document id). Two records with the same human label must still produce
 *   two different row ids, or a reveal could resolve to the wrong document.
 * @param {string|null} params.instanceLabel Human label shown to the operator.
 * @param {boolean} params.providerActive Whether the field applies to the active provider.
 * @param {number|null} params.lastUpdated
 * @param {string|null} params.updatedBy
 */
function buildCompanyRow({
    templateId,
    definition,
    companyId,
    companyName,
    documentPath,
    present,
    instanceKey = null,
    instanceLabel = null,
    providerActive = true,
    lastUpdated = null,
    updatedBy = null,
}) {
    const template = COMPANY_TEMPLATES[templateId];
    const availability = definition.encrypted
        ? AVAILABILITY.FIRESTORE_ENCRYPTED
        : AVAILABILITY.FIRESTORE_PLAINTEXT;

    const { permissions, restrictions } = companyPermissions(definition, { present, providerActive });

    const instanceSuffix = instanceKey ? `:${instanceKey}` : '';
    const displaySuffix = instanceLabel ? ` — ${instanceLabel}` : '';

    return {
        id: `company:${companyId}:${templateId}${instanceSuffix}:${definition.field}`,
        key: definition.field,
        displayName: `${definition.displayName}${displaySuffix}`,
        category: CATEGORIES.COMPANY_INTEGRATION,
        integration: template.integration,
        scope: 'company',
        source: definition.encrypted ? SOURCES.FIRESTORE_ENCRYPTED : SOURCES.FIRESTORE_PLAINTEXT,
        sensitivity: definition.sensitivity,
        description: definition.description,
        consumers: [template.docLabel],
        availability,
        requiresDeployment: false,
        optional: Boolean(definition.optional),
        permissions,
        restrictions,
        maskedValue: MASK,
        status: present ? STATUS.CONFIGURED : STATUS.MISSING,
        statusResolvedBy: 'server',
        unavailableReason: null,
        companyId,
        companyName: companyName || companyId,
        documentPath,
        field: definition.field,
        templateId,
        instanceKey,
        instanceLabel,
        lastUpdated,
        updatedBy,
    };
}

function toMillis(timestamp) {
    if (!timestamp) return null;
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
    if (timestamp instanceof Date) return timestamp.getTime();
    return null;
}

/** Company id from a `companies/{id}/...` document reference. */
function companyIdFromRef(ref) {
    const segments = ref.path.split('/');
    return segments[0] === 'companies' ? segments[1] : null;
}

async function loadCompanyNames() {
    const snapshot = await db.collection('companies').select('companyName').limit(COMPANY_NAME_LIMIT).get();
    const names = new Map();
    snapshot.forEach((doc) => {
        names.set(doc.id, doc.data()?.companyName || doc.id);
    });
    return names;
}

/**
 * Enumerates every company-scoped credential field.
 *
 * @param {string|null} companyFilter Restrict to one company when supplied.
 */
async function buildCompanyRows(companyFilter = null) {
    const [names, integrationSnap, systemSettingsSnap, keychainSnap, indexSnap] = await Promise.all([
        loadCompanyNames(),
        db.collectionGroup('integrations').get(),
        db.collectionGroup('system_settings').get(),
        db.collectionGroup('keychain').get(),
        db.collection('integrations_index').get(),
    ]);

    const rows = [];
    const keep = (companyId) => companyId && (!companyFilter || companyFilter === companyId);

    // --- SMS provider configuration -------------------------------------
    integrationSnap.forEach((doc) => {
        if (doc.id !== 'sms_provider') return;
        const companyId = companyIdFromRef(doc.ref);
        if (!keep(companyId)) return;

        const data = doc.data() || {};
        const config = data.config || {};
        const provider = data.provider || null;
        const lastUpdated = toMillis(data.updatedAt);
        const updatedBy = data.updatedBy || null;

        COMPANY_TEMPLATES.sms_provider.fields.forEach((definition) => {
            const container = definition.inConfig ? config : data;
            const present = isPresent(container[definition.field]);
            // A provider-specific credential only applies when that provider is
            // the active one; otherwise it is neither missing nor editable.
            const providerActive = !definition.providers
                || (provider ? definition.providers.includes(provider) : false);
            if (!present && !providerActive) return;

            rows.push(buildCompanyRow({
                templateId: 'sms_provider',
                definition,
                companyId,
                companyName: names.get(companyId),
                documentPath: doc.ref.path,
                present,
                providerActive,
                lastUpdated,
                updatedBy,
            }));
        });
    });

    // --- Dedicated line keychain ----------------------------------------
    keychainSnap.forEach((doc) => {
        const companyId = companyIdFromRef(doc.ref);
        if (!keep(companyId)) return;

        const data = doc.data() || {};
        const label = data.label || doc.id;
        const lastUpdated = toMillis(data.addedAt);
        const updatedBy = data.addedBy || null;

        COMPANY_TEMPLATES.sms_keychain.fields.forEach((definition) => {
            const present = isPresent(data[definition.field]);
            if (!present && definition.optional) return;
            rows.push(buildCompanyRow({
                templateId: 'sms_keychain',
                definition,
                companyId,
                companyName: names.get(companyId),
                documentPath: doc.ref.path,
                present,
                // The document id (the normalised phone) is unique; the label is
                // free text and two lines may share one.
                instanceKey: doc.id,
                instanceLabel: label,
                lastUpdated,
                updatedBy,
            }));
        });
    });

    // --- Email configuration --------------------------------------------
    systemSettingsSnap.forEach((doc) => {
        if (doc.id !== 'email_config') return;
        const companyId = companyIdFromRef(doc.ref);
        if (!keep(companyId)) return;

        const data = doc.data() || {};
        const lastUpdated = toMillis(data.updatedAt);
        const updatedBy = data.updatedBy || null;

        COMPANY_TEMPLATES.email_config.fields.forEach((definition) => {
            rows.push(buildCompanyRow({
                templateId: 'email_config',
                definition,
                companyId,
                companyName: names.get(companyId),
                documentPath: doc.ref.path,
                present: isPresent(data[definition.field]),
                lastUpdated,
                updatedBy,
            }));
        });
    });

    // --- Connected Facebook pages ---------------------------------------
    indexSnap.forEach((doc) => {
        const data = doc.data() || {};
        if (data.platform !== 'facebook') return;
        const companyId = data.companyId;
        if (!keep(companyId)) return;

        COMPANY_TEMPLATES.facebook_page.fields.forEach((definition) => {
            rows.push(buildCompanyRow({
                templateId: 'facebook_page',
                definition,
                companyId,
                companyName: names.get(companyId),
                documentPath: doc.ref.path,
                present: isPresent(data[definition.field]),
                instanceKey: doc.id,
                instanceLabel: data.pageName || doc.id,
                lastUpdated: toMillis(data.updatedAt || data.connectedAt),
                updatedBy: null,
            }));
        });
    });

    return rows;
}

/**
 * Full inventory: every global row plus every company-scoped credential field.
 *
 * @param {object} [options]
 * @param {string|null} [options.companyId] Restrict company rows to one tenant.
 * @param {boolean} [options.includeCompanies=true]
 */
async function buildInventory({ companyId = null, includeCompanies = true } = {}) {
    const globalRows = buildGlobalRows();
    let companyRows = [];
    let companyError = null;

    if (includeCompanies) {
        try {
            companyRows = await buildCompanyRows(companyId);
        } catch (error) {
            // A Firestore failure must not blank the whole page — the global
            // half is still accurate and useful, and the UI says what is missing.
            console.warn('[environmentVault] company inventory unavailable', {
                message: error?.message || 'unknown',
            });
            companyError = 'Company integration credentials could not be listed.';
        }
    }

    return { entries: [...globalRows, ...companyRows], companyError };
}

module.exports = {
    MASK,
    STATUS,
    buildCompanyRow,
    buildGlobalRows,
    buildInventory,
    isPresent,
};
