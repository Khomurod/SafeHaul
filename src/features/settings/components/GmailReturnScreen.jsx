import React, { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@shared/components/feedback';
import { Icon, ArrowLeft, MailWarning } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { LoadingState, PageState } from '@design-system/patterns';
import { gmailReturnOutcome, readGmailReturn } from '../services/gmailReturn';

const EMAIL_SETTINGS_PATH = '/company/settings?section=email';

/**
 * `/oauth/google/callback`: where Google returns a company admin after Connect
 * Gmail (Settings → Email), with a one-time `code` and `state`, or
 * `error=access_denied` when they cancelled.
 *
 * The address is read once, as the page opens, and its query is taken off at
 * once, before anything waits, so the code leaves the address bar and the
 * history entry (`/oauth/` is also secret to speed monitoring). The code goes
 * only to `completeGmailConnection` (`services/gmailReturn.js`, one call per
 * `state`), never to a log or another page. Connected, the page goes to Email
 * settings with "Gmail connected: …"; cancelled, with "Gmail was not
 * connected."; refused, it says the server's reason, with the way back.
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
        gmailReturnOutcome(returned).then((outcome) => {
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
