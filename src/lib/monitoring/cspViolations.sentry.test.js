/**
 * The CSP report as the real Sentry SDK builds it, not as a mock records it.
 *
 * Sentry adds the page URL and Referer (HttpContext), breadcrumbs and the
 * transaction name to every event on its own. On `/verify/:token` and
 * `/review-change/:token` those carry the token, so the report must leave
 * with none of them.
 */
import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it } from 'vitest';
import { reportCspViolations } from './cspViolations';

const LINK_PART = 'driver-link-placeholder';
let stop = () => {};

afterEach(async () => {
    stop();
    await Sentry.getClient()?.close();
});

describe('a CSP report sent through the real Sentry SDK', () => {
    it('carries no page path, query, Referer, breadcrumb or transaction', async () => {
        const sent = [];
        window.happyDOM.setURL(`https://app.safehaul.io/verify/${LINK_PART}?step=2`);
        Sentry.init({
            dsn: 'https://public@o1.ingest.us.sentry.io/1',
            integrations: [],
            beforeSend: (event) => { sent.push(event); return null; },
        });
        Sentry.addBreadcrumb({ category: 'navigation', data: { from: '/', to: `/verify/${LINK_PART}` } });
        Sentry.getCurrentScope().setTransactionName(`/verify/${LINK_PART}`);

        stop = reportCspViolations();
        const event = new Event('securitypolicyviolation');
        Object.assign(event, { disposition: 'report', effectiveDirective: 'connect-src', blockedURI: 'https://evil.example/x' });
        document.dispatchEvent(event);
        await Sentry.flush(2000);

        expect(sent).toHaveLength(1);
        expect(sent[0].message).toBe('CSP report: connect-src https://evil.example');
        expect(sent[0].request).toEqual({ url: 'https://app.safehaul.io' });
        expect(sent[0].breadcrumbs).toBeUndefined();
        expect(sent[0].transaction).toBeUndefined();
        expect(JSON.stringify(sent[0])).not.toContain(LINK_PART);
    });
});
