import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMock = vi.hoisted(() => ({ captureMessage: vi.fn(), getClient: vi.fn(() => ({})) }));
vi.mock('@sentry/react', () => sentryMock);

import { reportCspViolations } from './cspViolations';

function violation(fields) {
    const event = new Event('securitypolicyviolation');
    Object.assign(event, { disposition: 'report', effectiveDirective: 'script-src-elem', ...fields });
    return event;
}

let stop = () => {};

beforeEach(() => {
    vi.resetAllMocks();
});

afterEach(() => {
    stop();
});

describe('reportCspViolations', () => {
    it('sends a violation to Sentry as a warning, grouped by disposition, directive and blocked origin', () => {
        stop = reportCspViolations();
        document.dispatchEvent(violation({ blockedURI: 'https://evil.example/x.js', sourceFile: 'https://app.safehaul.io/assets/main-abc.js', lineNumber: 7 }));
        expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
        const [message, context] = sentryMock.captureMessage.mock.calls[0];
        expect(message).toBe('CSP report: script-src-elem https://evil.example');
        expect(context).toEqual({
            level: 'warning',
            fingerprint: ['csp-violation', 'report', 'script-src-elem', 'https://evil.example'],
            tags: { csp_disposition: 'report', csp_directive: 'script-src-elem', csp_blocked: 'https://evil.example' },
            extra: { sourceOrigin: 'https://app.safehaul.io', lineNumber: 7 },
        });
    });

    it('never sends a path or query, which can carry tokens', () => {
        const capture = vi.fn();
        stop = reportCspViolations({ capture });
        document.dispatchEvent(violation({
            effectiveDirective: 'connect-src',
            blockedURI: 'https://graph.example/v19.0/me/accounts?access_token=SECRET',
            sourceFile: 'https://app.safehaul.io/verify/TOKEN123?x=1',
        }));
        const sent = JSON.stringify(capture.mock.calls);
        expect(sent).not.toContain('SECRET');
        expect(sent).not.toContain('TOKEN123');
        expect(sent).not.toContain('/me/accounts');
        expect(capture.mock.calls[0][1].tags.csp_blocked).toBe('https://graph.example');
        expect(capture.mock.calls[0][1].extra.sourceOrigin).toBe('https://app.safehaul.io');
    });

    it('reports CSP keywords such as inline and eval as they are', () => {
        const capture = vi.fn();
        stop = reportCspViolations({ capture });
        document.dispatchEvent(violation({ effectiveDirective: 'script-src', blockedURI: 'inline' }));
        document.dispatchEvent(violation({ effectiveDirective: 'script-src', blockedURI: 'eval' }));
        document.dispatchEvent(violation({ effectiveDirective: 'img-src', blockedURI: 'data:image/png;base64,AAAA' }));
        document.dispatchEvent(violation({ effectiveDirective: 'worker-src', blockedURI: 'blob:https://app.safehaul.io/1f2e' }));
        expect(capture.mock.calls.map(([, context]) => context.tags.csp_blocked)).toEqual(['inline', 'eval', 'data', 'blob']);
    });

    it('sends each distinct violation once per page load', () => {
        const capture = vi.fn();
        stop = reportCspViolations({ capture });
        for (let i = 0; i < 3; i += 1) {
            document.dispatchEvent(violation({ blockedURI: `https://cdn.example/file-${i}.js` }));
        }
        document.dispatchEvent(violation({ disposition: 'enforce', blockedURI: 'https://cdn.example/a.js' }));
        expect(capture).toHaveBeenCalledTimes(2);
    });

    it('stops after the limit, so a broken page cannot flood Sentry', () => {
        const capture = vi.fn();
        stop = reportCspViolations({ capture, limit: 2 });
        ['https://a.example', 'https://b.example', 'https://c.example'].forEach((origin) => {
            document.dispatchEvent(violation({ blockedURI: origin }));
        });
        expect(capture).toHaveBeenCalledTimes(2);
    });

    it('keeps a violation seen before Sentry starts, so its repeat is sent once Sentry runs', () => {
        // The listener starts in the startup guards, before `main.jsx` calls initSentry.
        sentryMock.getClient.mockReturnValueOnce(undefined);
        stop = reportCspViolations({ limit: 1 });
        document.dispatchEvent(violation({ blockedURI: 'https://early.example/x.js' }));
        expect(sentryMock.captureMessage).not.toHaveBeenCalled();
        // Neither marked seen nor counted against the limit.
        document.dispatchEvent(violation({ blockedURI: 'https://early.example/x.js' }));
        expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
        expect(sentryMock.captureMessage.mock.calls[0][0]).toBe('CSP report: script-src-elem https://early.example');
    });

    it("ignores a browser extension's own violations", () => {
        const capture = vi.fn();
        stop = reportCspViolations({ capture });
        document.dispatchEvent(violation({ blockedURI: 'chrome-extension://abcdef/inject.js' }));
        document.dispatchEvent(violation({ blockedURI: 'inline', sourceFile: 'moz-extension://1234/content.js' }));
        expect(capture).not.toHaveBeenCalled();
        document.dispatchEvent(violation({ blockedURI: 'inline', sourceFile: 'https://app.safehaul.io/assets/main.js' }));
        expect(capture).toHaveBeenCalledTimes(1);
    });

    it('ignores an event that names no directive', () => {
        const capture = vi.fn();
        stop = reportCspViolations({ capture });
        document.dispatchEvent(violation({ effectiveDirective: '', violatedDirective: '' }));
        expect(capture).not.toHaveBeenCalled();
    });

    it('does nothing without a document', () => {
        expect(() => reportCspViolations({ win: {} })()).not.toThrow();
    });
});
