/**
 * AI provider credentials, managed from Super Admin → AI Integrations.
 *
 * Inventoried here but owned by the AI platform: deriving the rows from its
 * registry is what keeps the two consoles from disagreeing about which
 * credentials exist.
 */

const {
    CATEGORIES, SOURCES, AVAILABILITY, SENSITIVITY, REASONS, readOnly,
} = require('./vocabulary');
const { PROVIDERS: AI_PROVIDERS } = require('../../ai/registry/providers');
const { buildSecretId: buildAiSecretId } = require('../../ai/credentials/secretManager');

// ---------------------------------------------------------------------------
// 8. AI provider credentials, managed from Super Admin → AI Integrations
// ---------------------------------------------------------------------------

/**
 * The AI platform owns its own credentials, but they are still SafeHaul
 * secrets and an operator auditing "what keys does this product hold" must see
 * them here. Rather than transcribing the list — which would drift the first
 * time a provider is added — these rows are derived from the same frozen AI
 * provider registry the router uses, so the two cannot disagree.
 *
 * They are read-only in this console *on purpose*. Reveal, replace and delete
 * all happen in AI Integrations, which enforces the identical super-admin,
 * recent-authentication, one-value-per-request and value-free-audit rules.
 * Pointing at one owner keeps a single source of truth instead of two consoles
 * writing the same Secret Manager resource.
 */
const AI_CREDENTIAL_ENTRIES = AI_PROVIDERS.flatMap((provider) =>
    provider.secretFields.map((field) => ({
        key: buildAiSecretId(provider.id, field.name),
        displayName: `${provider.displayName} ${field.label.toLowerCase()}`,
        description: provider.retired
            ? `${provider.displayName} was retired by its vendor on ${provider.retired.since}. The credential slot is listed for completeness and cannot be configured.`
            : `${field.description} Managed from Super Admin → AI Integrations; stored in Google Secret Manager as ${buildAiSecretId(provider.id, field.name)}.`,
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: `${provider.displayName} (AI)`,
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: ['functions/ai/credentials/secretManager.js'],
        scope: 'global',
        source: SOURCES.SECRET_MANAGER,
        // Read at runtime through the Secret Manager client rather than bound
        // at deploy time, so a new or rotated credential takes effect within
        // the platform's 60-second cache window without redeploying.
        requiresDeployment: false,
        availability: AVAILABILITY.NOT_RETRIEVABLE,
        unavailableReason: 'Managed in Super Admin → AI Integrations, which reveals one credential at a time under its own audit.',
        ...readOnly(REASONS.SOURCE_NO_EDIT),
    })),
);

module.exports = { AI_CREDENTIAL_ENTRIES };
