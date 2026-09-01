// Shared harness for the LaunchPad suites. The real `initBulkSession`
// callable is never reached — every test drives a stub — and all campaign
// fixtures are artificial.
//
// =====================================================================
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below. This module
// must not import `LaunchPad` or any mocked module (the component imports
// the mocked firebase modules) — loading either here fires a mock factory
// that is itself awaiting this module, which deadlocks vitest silently
// (learned on `CA-3`). Each suite imports the component and passes it to
// `makeRenderPad`. `callable` is an ESM live binding assigned by
// `resetMigratedHarness`.
// =====================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

export const fnMocks = { httpsCallable: vi.fn() };
export const toast = { showSuccess: vi.fn(), showError: vi.fn() };
// E2E flags are module constants, so they are exposed through a getter the tests
// can flip per case.
export const e2e = { enabled: false, param: '' };

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const libFirebaseMock = () => ({
    functions: {},
    db: {}
});
// The suites configure this spy through `vi.mocked(httpsCallable)`, so the
// factory must hand out the INSTANCE, not a wrapper around it.
export const firebaseFunctionsMock = () => ({
    httpsCallable: fnMocks.httpsCallable,
});
export const toastProviderMock = () => ({
    useToast: () => ({
        showSuccess: toast.showSuccess,
        showError: toast.showError
    })
});
export const e2eModeMock = () => ({
    get isE2ETestMode() { return e2e.enabled; },
    getE2EQueryParam: () => e2e.param,
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const mockCampaign = {
    name: 'Test Campaign',
    matchCount: 10,
    filters: { status: ['new'] },
    messageConfig: { message: 'Hi' }
};

export const validCampaign = {
    name: 'Artificial Campaign',
    matchCount: 40,
    filters: { status: ['new'] },
    messageConfig: { method: 'sms', message: 'Artificial outreach message.' },
};

export let callable;

/**
 * The original `renderPad`, verbatim, except the component arrives as an
 * argument: each suite imports it after its own hoisted mocks.
 */
export const makeRenderPad = (LaunchPad) => (props = {}) => {
    const onLaunchSuccess = props.onLaunchSuccess ?? vi.fn();
    const utils = render(
        <BrowserRouter>
            <LaunchPad
                companyId={props.companyId === undefined ? 'co-1' : props.companyId}
                campaign={props.campaign || validCampaign}
                onLaunchSuccess={onLaunchSuccess}
            />
        </BrowserRouter>,
    );
    return { onLaunchSuccess, ...utils };
};

export const openConfirm = () => fireEvent.click(screen.getByRole('button', { name: /Launch Immediately/ }));
export const confirmLaunch = async () => {
    await React.act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
    });
};

/** The migrated-flow describe's `beforeEach` body, verbatim. */
export function resetMigratedHarness() {
    vi.clearAllMocks();
    e2e.enabled = false;
    e2e.param = '';
    callable = vi.fn().mockResolvedValue({ data: { success: true, targetCount: 40, sessionId: 'session-abcdef123' } });
    fnMocks.httpsCallable.mockReturnValue(callable);
}
