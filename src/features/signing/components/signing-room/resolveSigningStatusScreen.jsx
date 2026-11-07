import React from 'react';
import { LinkProblemScreen, isRetryableLinkProblem } from '@shared/components/public-link';
import { isSignedStatus } from '@features/signing/utils/alreadySigned';
import {
    SigningLoadingScreen,
    SigningVoidedScreen,
    SigningSuccessScreen,
    SigningAlreadySignedScreen,
    SigningDeclinedScreen,
    EsignConsentScreen,
} from './StatusScreens';

/**
 * Which full-page screen, if any, the signing room shows instead of the
 * document. The order is the point, as in the application's
 * `resolveApplyStatusScreen`:
 *
 *  1. **Loading, then a link that did not open** — neither has a document. The
 *     link's screen keeps the server's reason, names the sender, offers Try
 *     again only when the link could not be checked, and "Ask … for a new link"
 *     (`onRequestNewLink`) where a new link can help.
 *  2. **Voided**, which no later state can undo.
 *  3. **Signed just now**, above "already signed": a submission the room made
 *     itself is thanked, not told it was too late.
 *  4. **Already signed** — never the consent again for a signed document.
 *  5. **Declined**, then **the consent**. ESIGN-8: UETA Sec. 5(b) and ESIGN Act
 *     Sec. 101(c) require the signer to agree to electronic records and
 *     signatures before the document is shown, not inline beside it.
 *     `consentFocus` moves the focus to the consent's heading when Go back
 *     brings it back in place of the declined screen.
 *
 * @returns {React.ReactElement|null} null when the document itself should render
 */
export function resolveSigningStatusScreen({
    loading, linkProblem, companyName, onRetry, onRequestNewLink,
    request, success, declined, hasEsignConsent, consentFocus = false,
    onReturnToDocuments, onAgree, onDecline, onGoBack,
}) {
    if (loading) return <SigningLoadingScreen />;
    if (linkProblem) {
        return (
            <LinkProblemScreen
                reason={linkProblem.reason}
                detail={linkProblem.detail}
                companyName={companyName}
                onRetry={isRetryableLinkProblem(linkProblem.reason) ? onRetry : undefined}
                onRequestNewLink={onRequestNewLink}
            />
        );
    }
    // PHASE 4: Voided document hard-stop
    if (request?.status === 'voided') return <SigningVoidedScreen />;
    if (success) {
        return <SigningSuccessScreen recipientName={request?.recipientName} onReturnToDocuments={onReturnToDocuments} />;
    }
    if (isSignedStatus(request?.status)) {
        return <SigningAlreadySignedScreen signedAt={request.signedAt} onReturnToDocuments={onReturnToDocuments} />;
    }
    if (declined) return <SigningDeclinedScreen onGoBack={onGoBack} />;
    if (!hasEsignConsent) {
        return (
            <EsignConsentScreen title={request?.title} onAgree={onAgree} onDecline={onDecline} focusOnMount={consentFocus} />
        );
    }
    return null;
}
