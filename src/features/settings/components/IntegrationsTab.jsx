import React, { useEffect, useState } from 'react';
import { Icon, Megaphone, CheckCircle, Loader2 } from '@design-system/icons';
import { functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Badge, Button, Card, FieldMessage } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/**
 * Settings → Connections → Facebook leads (section id `integrations`). Shown
 * only for a company a super admin switched Facebook leads on for
 * (`features.callTracking === true`, `CompanySettings`).
 *
 * Presentation only: every SDK-load, login, Graph API and callable contract is
 * frozen, and this component touches no Cloud Function, rule or data shape.
 *
 * It sends `companyId` to `connectFacebookPage`, and the callable
 * (`functions/integrations/facebook.js`) authorizes it against the caller's
 * per-company role: the tenant is the company's Firestore document id, never
 * `request.auth.uid`, which would ingest leads to `companies/{uid}/leads` — a
 * tree belonging to no company. Sending it is not the same as being trusted with
 * it — the server re-checks, and a company admin naming a company they do not
 * administer is rejected.
 *
 * The feature is **switched off** and the "not production-ready" notice below
 * stays: the workflow has never run end-to-end against a real Facebook page in
 * production.
 *
 * No credential or secret ever reaches this component: only the public
 * `VITE_FACEBOOK_APP_ID` and a short-lived user access token are used
 * client-side, and that token is never rendered, logged, or stored — it flows
 * directly into the Graph API fetch and the callable payload, matching the
 * audit's frozen token-security contract.
 *
 * Defects fixed (presentation only):
 *  - the "Connected" state was communicated by a small pill with no visible
 *    icon-independent meaning beyond color+text sized at 10px (below the
 *    12 px floor) — now a `Badge`, which floors at `--ds-font-size-xs`;
 *  - the "SDK Loading..." notice was plain 10px red text with no live-region
 *    role, so a screen-reader user was never told the button would activate
 *    once loading finished — now a `role="status"` `FieldMessage`.
 *
 * Preserved and NOT changed: the connected-state limitation itself (local
 * React state only — not loaded from Firestore, lost on refresh, no
 * disconnect/reconnect flow). Adding a disconnect action would be new
 * business logic with no backend support today, not a presentation fix, so
 * none was added; the "Connected" control remains a disabled indicator, as
 * frozen by the audit.
 */
export function IntegrationsTab({ companyId }) {
    const { showSuccess, showError } = useToast();
    const [isSdkLoaded, setIsSdkLoaded] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectedPage, setConnectedPage] = useState(null);

    // 1. Load Facebook SDK
    useEffect(() => {
        if (window.FB) {
            setIsSdkLoaded(true);
            return;
        }

        window.fbAsyncInit = function () {
            window.FB.init({
                appId: import.meta.env.VITE_FACEBOOK_APP_ID,
                cookie: true,
                xfbml: true,
                version: 'v19.0'
            });
            setIsSdkLoaded(true);
        };

        // Inject Script
        (function (d, s, id) {
            var js, fjs = d.getElementsByTagName(s)[0];
            if (d.getElementById(id)) return;
            js = d.createElement(s); js.id = id;
            js.src = "https://connect.facebook.net/en_US/sdk.js";
            fjs.parentNode.insertBefore(js, fjs);
        }(document, 'script', 'facebook-jssdk'));
    }, []);

    // 2. Handle Connect
    const handleConnectFacebook = () => {
        if (!isSdkLoaded) {
            showError("Facebook SDK not loaded yet. Please refresh.");
            return;
        }

        setConnecting(true);

        window.FB.login(function (response) {
            if (response.authResponse) {
                const userToken = response.authResponse.accessToken;
                connectBackend(userToken);
            } else {
                setConnecting(false);
                if (response.status !== 'unknown') {
                    // 'unknown' usually means closed popup
                    showError("Facebook login failed or was cancelled.");
                }
            }
        }, {
            scope: 'pages_show_list,pages_read_engagement,leads_retrieval,pages_manage_metadata,pages_manage_ads'
        });
    };

    // 3. Call Backend
    const connectBackend = async (shortLivedUserToken) => {
        try {
            // Fetch the user's pages client-side and auto-select the first one.
            // First-page-only, no picker: a recorded, frozen MVP behavior.
            const pagesResp = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${shortLivedUserToken}`)
                .then(r => r.json());

            if (!pagesResp.data || pagesResp.data.length === 0) {
                throw new Error("No Facebook Pages found for this user.");
            }

            const pageToConnect = pagesResp.data[0];

            // `companyId` is which tenant this page's leads belong to. It used to
            // be absent, and the callable fell back to the caller's uid — see the
            // tenant-binding note in `functions/integrations/facebook.js`. The
            // server re-checks it against the caller's per-company role; sending
            // it is not the same as being trusted with it.
            if (!companyId) {
                throw new Error("No company selected. Reopen Settings and try again.");
            }

            const connectFn = httpsCallable(functions, 'connectFacebookPage');
            await connectFn({
                shortLivedUserToken,
                pageId: pageToConnect.id,
                pageName: pageToConnect.name,
                companyId
            });

            setConnectedPage(pageToConnect.name);
            showSuccess(`Successfully connected Facebook Page: ${pageToConnect.name}`);

        } catch (error) {
            console.error(error);
            showError(plainErrorMessage(error, 'The Facebook Page could not be connected.'));
        } finally {
            setConnecting(false);
        }
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Facebook leads"
                description="Bring in leads from your Facebook Lead Ads forms."
            />

            {/* One card: the mark, what it does, and the button. On a phone the
                words take the card's width under the mark's row. */}
            <Card padding="md" elevation="soft">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-ds-4 gap-y-ds-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-ds-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-ds-lg bg-[#1877F2]/10 text-[#1877F2]">
                        <Icon icon={Megaphone} size="2xl" />
                    </div>
                    <div className="min-w-0 max-md:contents">
                        <h2 className="flex flex-wrap items-center gap-x-ds-3 gap-y-ds-1 text-ds-heading-sm font-semibold text-ds-content">
                            Facebook Lead Ads
                            {connectedPage && <Badge tone="success" icon={CheckCircle}>Connected</Badge>}
                        </h2>
                        <p className="mt-ds-1 max-w-[68ch] text-ds-body text-ds-content-secondary [text-wrap:pretty] max-md:col-span-2 max-md:mt-0">
                            Automatically import leads from your Facebook Lead Gen forms.
                            We&apos;ll sync new leads directly to your dashboard in real-time.
                        </p>
                        {connectedPage && (
                            <p className="mt-ds-2 flex items-center gap-ds-1 text-ds-xs text-ds-content-muted max-md:col-span-2 max-md:mt-0">
                                <Icon icon={CheckCircle} size="xs" className="text-ds-status-success-fg" />
                                Active Page: <span className="truncate font-medium text-ds-content">{connectedPage}</span>
                            </p>
                        )}
                    </div>

                    <div className="max-md:col-span-2">
                        {connectedPage ? (
                            <Button variant="secondary" disabled fullWidth>
                                Connected
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                fullWidth
                                onClick={handleConnectFacebook}
                                disabled={connecting || !isSdkLoaded}
                                loading={connecting}
                            >
                                {!connecting && <Icon icon={Megaphone} />}
                                {connecting ? 'Connecting...' : 'Connect Facebook'}
                            </Button>
                        )}
                        {!isSdkLoaded && !connecting && (
                            <FieldMessage tone="help" role="status" className="mt-ds-1 text-center">
                                <Icon icon={Loader2} size="xs" className="animate-spin" /> SDK Loading...
                            </FieldMessage>
                        )}
                    </div>
                </div>
            </Card>
        </Stack>
    );
}
