import React, { useId } from 'react';
import { AlertCircle, CheckCircle, Clock, RefreshCw } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { ErrorState, PageState } from '@design-system/patterns';
import { LINK_PROBLEM } from './linkProblem';

/**
 * The one "this link does not work" screen of the public pages: signing
 * (`/sign`), a past employer's verification (`/verify`), a driver's review of
 * company edits (`/review-change`) and an application's continuation link.
 *
 * It says what happened, what to do, and who to ask: the company, by name when
 * the page knows it. "Try again" appears only when the page passes `onRetry`,
 * which it does only when trying again can help (`isRetryableLinkProblem`, or the
 * application link's own transient outcomes).
 *
 * It lives outside the design system on purpose: it knows about links, senders
 * and what each reason means. Underneath it is the approved page-state pattern,
 * so it looks like every other full-page state.
 */

const COPY = Object.freeze({
    [LINK_PROBLEM.EXPIRED]: {
        tone: 'warning',
        icon: Clock,
        title: 'This link has expired',
        detail: 'For your security, links like this one stop working after a while.',
        advice: (sender) => `If ${sender} sent you a newer message, use the link in it. Otherwise ask ${sender} for a new link.`,
    },
    [LINK_PROBLEM.REPLACED]: {
        tone: 'warning',
        icon: RefreshCw,
        title: 'This link was replaced by a newer one',
        detail: 'A newer link was sent after this one, so this one no longer works.',
        advice: (sender) => `Open the newest message from ${sender} and use the link in it.`,
    },
    [LINK_PROBLEM.USED]: {
        tone: 'info',
        icon: CheckCircle,
        title: 'This link has already been used',
        detail: 'What it was sent for is already done, so there is nothing more to do here.',
        advice: (sender) => `If something looks wrong, contact ${sender}.`,
    },
    [LINK_PROBLEM.NOT_FOUND]: {
        tone: 'warning',
        icon: AlertCircle,
        title: 'This link is not valid',
        detail: 'It may be incomplete, or what it pointed to may no longer exist.',
        advice: (sender) => `Open the link again from your message. If it still does not work, ask ${sender} for a new one.`,
    },
    [LINK_PROBLEM.UNOPENABLE]: {
        tone: 'warning',
        icon: AlertCircle,
        title: 'This link could not be opened',
        detail: 'It may have expired, or a newer link may have replaced it.',
        advice: (sender) => `Open the newest message from ${sender}, or ask them to send you a new link.`,
    },
    [LINK_PROBLEM.UNAVAILABLE]: {
        tone: 'danger',
        title: 'We could not check this link',
        detail: 'Check your internet connection and try again.',
        advice: (sender) => `If it keeps happening, contact ${sender}.`,
    },
});

/**
 * @param {object} props
 * @param {string} props.reason one of `LINK_PROBLEM`
 * @param {string} [props.companyName] who sent the link, when the page knows it
 * @param {string} [props.detail] what happened, in the page's or the server's
 *   words, in place of the reason's own sentence
 * @param {string|null} [props.advice] what to do, in place of the reason's own
 *   sentence; `null` when the page's actions already say it
 * @param {() => void} [props.onRetry] shows "Try again"; pass it only when
 *   trying again can help
 * @param {React.ReactNode} [props.actions] the page's own way forward, after
 *   "Try again"
 */
export function LinkProblemScreen({ reason, companyName, detail, advice, onRetry, actions }) {
    const headingId = `link-problem-${useId().replace(/:/g, '')}`;
    const copy = COPY[reason] ?? COPY[LINK_PROBLEM.UNOPENABLE];
    const sender = (typeof companyName === 'string' && companyName.trim()) || 'the sender';
    const said = advice === undefined ? copy.advice(sender) : advice;
    const description = [detail || copy.detail, said].filter(Boolean).join(' ');
    const way = (onRetry || actions) ? (
        <>
            {onRetry && <Button variant="primary" onClick={onRetry}>Try again</Button>}
            {actions}
        </>
    ) : undefined;
    const shared = {
        headingLevel: 1,
        titleId: headingId,
        // The screen replaces the page that was loading, or the form the person
        // just submitted: focus would otherwise be left on `<body>`.
        focusOnMount: true,
        title: copy.title,
        // A server's sentence can carry an unbroken word; it wraps rather than overflowing.
        description: <span className="[overflow-wrap:anywhere]">{description}</span>,
        actions: way,
    };

    return (
        <main aria-labelledby={headingId} className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
            {/* The width is the wrapper's: a page state's `className` lands inside its card. */}
            <div className="w-full max-w-md">
                {copy.tone === 'danger'
                    ? <ErrorState {...shared} />
                    : <PageState {...shared} tone={copy.tone} icon={copy.icon} />}
            </div>
        </main>
    );
}

export default LinkProblemScreen;
