const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const { FieldValue } = require('firebase-admin/firestore');
const { buildApplicationSearchFields } = require('./searchNormalization');

function generateApplicantKey(companyId, email, phone) {
    const normalizedEmail = (email || '').toLowerCase().trim();
    const normalizedPhone = (phone || '').replace(/\D/g, '').trim();
    const input = `${companyId}:${normalizedEmail}:${normalizedPhone}`;
    const fullHash = crypto.createHash('sha256').update(input).digest('hex');
    return {
        applicantKey: fullHash.substring(0, 20),
        applicantKeyFull: fullHash,
    };
}

function generateApplicationId(applicantKey) {
    return applicantKey;
}

function generateConfirmationNumber() {
    const year = new Date().getFullYear();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let random = '';
    for (let i = 0; i < 5; i++) {
        random += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `SAF-${year}-${random}`;
}

function sanitizeData(data) {
    if (data === undefined) return null;
    if (data === null) return null;
    if (data instanceof Date) return data.toISOString();
    if (Array.isArray(data)) return data.map(sanitizeData);
    if (typeof data === 'object') {
        const sanitized = {};
        for (const key of Object.keys(data)) {
            sanitized[key] = sanitizeData(data[key]);
        }
        return sanitized;
    }
    return data;
}

/**
 * Resolve a company gate.
 *
 * Delegates to `applicationDefinition.resolveGate` so the submission validator,
 * the immutable snapshot and the driver's screen apply one set of defaults and
 * one set of legacy-key aliases. The `defaultRequired` argument is retained for
 * callers asking about a key that is not a declared gate.
 */
function getFieldConfig(applicationConfig, fieldId, defaultRequired = true) {
    const { GATE_DEFAULT_REQUIRED, resolveGate } = require('./applicationDefinition');
    if (Object.prototype.hasOwnProperty.call(GATE_DEFAULT_REQUIRED, fieldId)) {
        const gate = resolveGate(applicationConfig, fieldId);
        return { hidden: gate.hidden, required: gate.required };
    }
    const config = applicationConfig?.[fieldId];
    return {
        hidden: Boolean(config?.hidden),
        required: config !== undefined ? Boolean(config.required) : defaultRequired
    };
}

function hasUploadedFile(value) {
    if (!value) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'object') {
        return Boolean(value.url || value.storagePath || value.name);
    }
    return false;
}

function getMissingRequiredUploads(applicationConfig, formData) {
    const cdlUploadConfig = getFieldConfig(applicationConfig, 'cdlUpload', true);
    const medCardConfig = getFieldConfig(applicationConfig, 'medCardUpload', true);
    const missingRequiredUploads = [];

    if (!cdlUploadConfig.hidden && cdlUploadConfig.required) {
        if (!hasUploadedFile(formData['cdl-front'])) missingRequiredUploads.push('CDL Front');
        if (!hasUploadedFile(formData['cdl-back'])) missingRequiredUploads.push('CDL Back');
    }

    if (!medCardConfig.hidden && medCardConfig.required && !hasUploadedFile(formData['medical-card-upload'])) {
        missingRequiredUploads.push('Medical Card');
    }

    // MVR consent is configurable in Settings but was never enforced anywhere,
    // so a company that marked it Required still received applications without
    // it. It defaults to not-required (see GATE_DEFAULT_REQUIRED), so this
    // cannot start rejecting submissions at companies that never asked for it.
    const mvrConsentConfig = getFieldConfig(applicationConfig, 'mvrConsent', false);
    if (!mvrConsentConfig.hidden && mvrConsentConfig.required && !hasUploadedFile(formData['mvr-consent-upload'])) {
        missingRequiredUploads.push('MVR Consent Form');
    }

    return missingRequiredUploads;
}

function assertRequiredUploads(applicationConfig, formData) {
    const missingRequiredUploads = getMissingRequiredUploads(applicationConfig, formData || {});
    if (missingRequiredUploads.length > 0) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            `Missing required uploaded documents: ${missingRequiredUploads.join(', ')}.`
        );
    }
}

function buildApplicationDoc({
    companyId,
    companyName,
    email,
    phone,
    signature,
    formData,
    sourceMeta = {},
}) {
    const normalizedFormData = formData && typeof formData === 'object' ? formData : {};
    const { applicantKey, applicantKeyFull } = generateApplicantKey(companyId, email, phone);
    const applicationId = generateApplicationId(applicantKey);
    const confirmationNumber = generateConfirmationNumber();
    const now = FieldValue.serverTimestamp();

    const applicationDoc = sanitizeData({
        ...normalizedFormData,
        applicantId: applicationId,
        applicationId: applicationId,
        driverId: applicationId,
        userId: applicationId,
        applicantKey,
        applicantKeyFull,
        confirmationNumber,
        email: (email || '').toLowerCase().trim(),
        phone: phone || '',
        signature,
        signatureType: normalizedFormData.signatureType || sourceMeta.signatureType || 'drawn',
        companyId,
        companyName,
        status: 'New Application',
        sourceType: sourceMeta.sourceType || normalizedFormData.sourceType || 'Public Application',
        sourceSlug: sourceMeta.sourceSlug ?? normalizedFormData.sourceSlug ?? null,
        recruiterCode: sourceMeta.recruiterCode ?? normalizedFormData.recruiterCode ?? null,
        employers: Array.isArray(normalizedFormData.employers) ? normalizedFormData.employers : [],
        violations: Array.isArray(normalizedFormData.violations) ? normalizedFormData.violations : [],
        accidents: Array.isArray(normalizedFormData.accidents) ? normalizedFormData.accidents : [],
        schools: Array.isArray(normalizedFormData.schools) ? normalizedFormData.schools : [],
        military: Array.isArray(normalizedFormData.military) ? normalizedFormData.military : [],
        lifecycle: {
            status: 'submitted',
            submittedAt: new Date().toISOString(),
            clientVersion: sourceMeta.clientVersion || normalizedFormData?.lifecycle?.clientVersion || '2.0-bulletproof',
            isGuest: sourceMeta.isGuest ?? true,
            processedViaFunction: true,
        },
        // Persisted normalized search fields (single source: shared/searchNormalization).
        // upsertApplicationDoc recomputes the id/confirmation-derived ones if the
        // final document id or confirmation number changes during upsert.
        ...buildApplicationSearchFields({
            firstName: normalizedFormData.firstName,
            lastName: normalizedFormData.lastName,
            email,
            phone,
            confirmationNumber,
            applicationId,
        }),
    });

    applicationDoc.updatedAt = now;

    return {
        applicantKey,
        applicantKeyFull,
        applicationId,
        confirmationNumber,
        applicationDoc,
        now,
    };
}

module.exports = {
    assertRequiredUploads,
    buildApplicationDoc,
    generateApplicantKey,
    generateApplicationId,
    generateConfirmationNumber,
    getFieldConfig,
    getMissingRequiredUploads,
    hasUploadedFile,
    sanitizeData,
};
