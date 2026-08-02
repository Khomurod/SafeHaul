import React, { useEffect, useState } from 'react';
import { Facebook, CheckCircle, Loader2, Blocks } from 'lucide-react';
import { functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Badge, Button, Card, FieldMessage } from '@/design-system/components';
import { PageHeader, ResponsiveGrid, Stack } from '@/design-system/layouts';

/**
 * Company Settings "Integrations" tab.
 *
 * Migrated to the design system 2026-07-27. This is a PRESENTATION-ONLY
 * migration: every SDK-load, login, Graph API, and callable contract recorded
 * in the 2026-07-23 Integrations deep-audit (NO-GO) is unchanged, and no
 * Cloud Function, rule, or data shape was touched.
 *
 * That audit found a real, unfixed **tenant-binding security defect**:
 * `connectFacebookPage` derives the tenant from `request.auth.uid` rather than
 * the company's real Firestore document id, which is incompatible with
 * SafeHaul's auto-id + membership multi-tenant model. Connected leads would
 * ingest to `companies/{uid}/leads` instead of the real company. That defect
 * is NOT fixed here — fixing it means changing `functions/integrations/
 * facebook.js`, which is out of this campaign's scope (no Firebase/Functions
 * changes) and belongs to a separate, security-reviewed backend project. This
 * migration only replaces the presentation layer around that unchanged,
 * still-unsafe workflow; it does not make the workflow production-ready.
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
export function IntegrationsTab() {
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

            const connectFn = httpsCallable(functions, 'connectFacebookPage');
            await connectFn({
                shortLivedUserToken,
                pageId: pageToConnect.id,
                pageName: pageToConnect.name
            });

            setConnectedPage(pageToConnect.name);
            showSuccess(`Successfully connected Facebook Page: ${pageToConnect.name}`);

        } catch (error) {
            console.error(error);
            showError(error.message || "Failed to connect Facebook Page.");
        } finally {
            setConnecting(false);
        }
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Integrations"
                description="Manage connections with third-party platforms."
            />

            <ResponsiveGrid minItemWidth="320px">
                <Card padding="md">
                    <div className="flex flex-col items-start justify-between gap-ds-4 sm:flex-row">
                        <div className="flex min-w-0 items-start gap-ds-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-ds-lg bg-[#1877F2]/10 text-[#1877F2]">
                                <Facebook size={24} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="flex flex-wrap items-center gap-ds-2 font-bold text-ds-content">
                                    Facebook Lead Ads
                                    {connectedPage && <Badge tone="success">Connected</Badge>}
                                </h2>
                                <p className="mt-ds-1 max-w-md text-ds-sm text-ds-content-muted">
                                    Automatically import leads from your Facebook Lead Gen forms.
                                    We&apos;ll sync new leads directly to your dashboard in real-time.
                                </p>
                                {connectedPage && (
                                    <p className="mt-ds-2 flex items-center gap-ds-1 text-ds-xs text-ds-content-muted">
                                        <CheckCircle size={12} className="text-ds-status-success-fg" aria-hidden="true" />
                                        Active Page: <span className="truncate font-medium text-ds-content">{connectedPage}</span>
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="w-full shrink-0 sm:w-auto">
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
                                    {!connecting && <Facebook size={16} aria-hidden="true" />}
                                    {connecting ? 'Connecting...' : 'Connect Facebook'}
                                </Button>
                            )}
                            {!isSdkLoaded && !connecting && (
                                <FieldMessage tone="help" role="status" className="mt-ds-1 text-center">
                                    <Loader2 size={12} className="animate-spin" aria-hidden="true" /> SDK Loading...
                                </FieldMessage>
                            )}
                        </div>
                    </div>
                </Card>

                {/*
                  No `opacity-*` dimming here: applying it to the whole card
                  (as the pre-migration markup did) scales every descendant
                  color toward the background, including the approved
                  `--ds-color-content-muted` token — dropping its contrast
                  below WCAG AA even though the token itself passes on its own
                  (enforced by `design-system/tests/tokens.test.js`). A real
                  Chromium axe scan caught this. The placeholder look is
                  carried by the dashed border and muted icon/text tokens
                  instead, at full opacity.
                */}
                <Card padding="md" className="flex flex-col items-center justify-center border-dashed text-center">
                    <div className="mb-ds-3 flex h-10 w-10 items-center justify-center rounded-full bg-ds-surface-subtle text-ds-content-muted">
                        <Blocks size={20} aria-hidden="true" />
                    </div>
                    <h2 className="font-semibold text-ds-content-muted">More Integrations Coming Soon</h2>
                    <p className="mt-ds-1 text-ds-xs text-ds-content-muted">Tenstreet, Driver Pulse, and more.</p>
                </Card>
            </ResponsiveGrid>
        </Stack>
    );
}
