/**
 * Presentation helpers shared by the AI Integrations components.
 *
 * These live outside the component files so those files export components only,
 * which is what React Fast Refresh needs to swap a component without remounting
 * the page — and losing a revealed credential's countdown in the process.
 */

/** Masked stand-in. Fixed width, so it reveals nothing about the real value. */
export const MASKED_PLACEHOLDER = '********';

/**
 * The status a provider row should show, most-urgent state first.
 *
 * Every state carries a text label as well as a tone, because "which provider is
 * actually working" must be answerable without relying on colour. The states are
 * deliberately distinct rather than collapsed into healthy/unhealthy: the
 * operator's next action differs for each one.
 *
 * @param {object} provider a row from `listAiProviders`
 * @returns {{ tone: string, label: string, detail: string }}
 */
export function describeProviderState(provider) {
    if (provider.retired) {
        return { tone: 'neutral', label: 'Retired by vendor', detail: provider.retired.reason };
    }

    if (!provider.configured) {
        const missing = [
            ...provider.missingCredentials.map((name) => {
                const field = provider.credentialFields.find((candidate) => candidate.name === name);
                return field ? field.label : name;
            }),
            ...provider.missingConfig.map((name) => {
                const field = provider.configFields.find((candidate) => candidate.name === name);
                return field ? field.label : name;
            }),
        ];
        return {
            tone: 'warning',
            label: 'Not configured',
            detail: missing.length ? `Needs ${missing.join(' and ')}.` : 'No credentials stored.',
        };
    }

    if (!provider.enabled) {
        return { tone: 'neutral', label: 'Disabled', detail: 'Configured but excluded from routing.' };
    }

    if (provider.cooldown.active) {
        const until = provider.cooldown.until ? new Date(provider.cooldown.until) : null;
        const isQuota = provider.cooldown.reason === 'quota';
        return {
            tone: isQuota ? 'warning' : 'danger',
            label: isQuota ? 'Quota cooldown' : 'Failure cooldown',
            detail: until
                ? `Skipped until ${until.toLocaleTimeString()}.`
                : 'Temporarily skipped by the router.',
        };
    }

    if (provider.health === 'degraded') {
        return {
            tone: 'warning',
            label: 'Degraded',
            detail: `${provider.consecutiveFailures} consecutive failure(s).`,
        };
    }

    if (provider.health === 'healthy') {
        return { tone: 'success', label: 'Healthy', detail: 'Last request succeeded.' };
    }

    return { tone: 'info', label: 'Ready', detail: 'Configured and enabled; not yet used.' };
}
