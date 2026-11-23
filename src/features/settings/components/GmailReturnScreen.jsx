import React, { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';
import { Icon, ArrowLeft, MailWarning } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { LoadingState, PageState } from '@design-system/patterns';

const EMAIL_SETTINGS_PATH = '/company/settings?section=email';

const EXPIRED = 'This Gmail connection expired. Start again from Settings → Email.';
const GOOGLE_REFUSED = 'Google did not connect Gmail. Start again from Settings → Email.';

/** What Google put in the address: the one-time `code` and `state`, or an `error`. */
function readGmailReturn(search) {
    const params = new URLSearchParams(search);
    return {
        code: params.get('code') || '',
        state: params.get('state') || '',
        error: params.get('error') || '',
    };
}

/**
 * The one call per return. The code works once, so every mount of this page
 * for the same `state` (StrictMode's rehearsal, a remount) shares the first
 * call and its outcome, which never rejects. Nothing here logs the code or the
 * state: a failure is logged by its code only.
 */
let finishing = null;

function finish(state, code) {
    if (finishing?.state === state) return finishing.outcome;
    const entry = { state, settled: false };
    entry.outcome = httpsCallable(functions, 'completeGmailConnection')({ state, code })
        .then(
            ({ data }) => ({ kind: 'connected', email: typeof data?.email === 'string' ? data.email : '' }),
            (error) => {
                console.warn('[GmailReturnScreen] Gmail was not connected:', error?.code || 'error');
                // The server's refusals are sentences for the admin, its `internal` one too.
                return { kind: 'failed', message: plainErrorMessage(error, 'Gmail could not be connected.', { trustInternal: true }) };
            },
        )
        .then((outcome) => {
            entry.settled = true;
            return outcome;
        });
    finishing = entry;
    return entry.outcome;
}

/** What this return comes to: connected, cancelled at Google, failed, or nothing to finish. */
function outcomeOf({ code, state, error }) {
    if (error === 'access_denied') return Promise.resolve({ kind: 'cancelled' });
    if (error) return Promise.resolve({ kind: 'failed', message: GOOGLE_REFUSED });
    if (code && state) return finish(state, code);
    if (code || state) return Promise.resolve({ kind: 'failed', message: EXPIRED });
    // An address already cleared (Back, or a remount): a call still running is this return's.
    if (finishing && !finishing.settled) return finishing.outcome;
    return Promise.resolve({ kind: 'nothing' });
}

/**
 * `/oauth/google/callback`: where Google returns a company admin after Connect
 * Gmail (Settings → Email), with a one-time `code` and `state`, or
 * `error=access_denied` when they cancelled.
 *
 * The address is read once, as the page opens, and its query is taken off at
 * once, before anything waits, so the code leaves the address bar and the
 * history entry (`/oauth/` is also secret to speed monitoring). The code goes
 * only to `completeGmailConnection`, never to a log or another page. Connected,
 * the page goes to Email settings with "Gmail connected: …"; cancelled, with
 * "Gmail was not connected."; refused, it says the server's reason, with the
 * way back.
 */
export function GmailReturnScreen() {
    const navigate = useNavigate();
    const { showSuccess, showInfo } = useToast();
    const headingId = `gmail-return-${useId().replace(/:/g, '')}`;
    const [returned] = useState(() => readGmailReturn(window.location.search));
    const [failure, setFailure] = useState(null);

    useEffect(() => {
        // First, before anything waits.
        if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
        let alive = true;
        outcomeOf(returned).then((outcome) => {
            // A mount that is gone (StrictMode's rehearsal) leaves it to the one that is not.
            if (!alive) return;
            if (outcome.kind === 'failed') {
                setFailure(outcome.message);
                return;
            }
            if (outcome.kind === 'connected') showSuccess(outcome.email ? `Gmail connected: ${outcome.email}` : 'Gmail connected.');
            if (outcome.kind === 'cancelled') showInfo('Gmail was not connected.');
            navigate(EMAIL_SETTINGS_PATH, { replace: true });
        });
        return () => { alive = false; };
        // Once per page: what Google returned is read as it opened.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <main aria-labelledby={headingId} className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
            <div className="w-full max-w-md">
                {failure ? (
                    <PageState
                        tone="danger"
                        icon={MailWarning}
                        headingLevel={1}
                        titleId={headingId}
                        focusOnMount
                        title="Gmail was not connected"
                        description={failure}
                        actions={(
                            <Button variant="primary" onClick={() => navigate(EMAIL_SETTINGS_PATH, { replace: true })}>
                                <Icon icon={ArrowLeft} />
                                Back to Email settings
                            </Button>
                        )}
                    />
                ) : (
                    <LoadingState headingLevel={1} titleId={headingId} title="Connecting Gmail…" />
                )}
            </div>
        </main>
    );
}
