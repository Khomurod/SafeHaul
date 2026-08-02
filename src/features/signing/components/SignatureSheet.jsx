import React, { useEffect, useId, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { ChevronLeft, Eraser } from 'lucide-react';
import { Button } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Signature / initials capture surface shared by mobile and desktop.
 *
 * Fullscreen on phones (maximum drawing area for a finger), centered dialog on
 * md+ screens. Uses react-signature-canvas so strokes are smoothed and the
 * adopted PNG is trimmed to the ink bounding box.
 *
 * Presentation only. Frozen: the accessible dialog name ("Draw your signature" /
 * "Draw your initials"), the Cancel / Clear / "Adopt & continue" controls and
 * their handlers, the `data-testid="signature-sheet-canvas"` hook, every
 * `SignatureCanvas` drawing prop, the wrapper-measured canvas size, and both
 * safe-area insets.
 *
 * The dialog now delegates to the shared accessible `Modal`, which adds focus
 * move-in, focus restore, a Tab trap and Escape-to-cancel — the hand-rolled
 * overlay had none of those. Backdrop dismissal stays **off**: a stray tap
 * outside the pad must not discard a half-drawn signature, which is the
 * behaviour this surface already had.
 */

/**
 * Ink colour baked into the adopted PNG.
 *
 * This is document *content*, not interface chrome. The PNG produced here is
 * stamped into a sealed, legally binding PDF, so it must not follow a theme:
 * re-theming the app can never be allowed to retint a document somebody has
 * already signed. The value equals `--ds-color-slate-900`, but it is
 * deliberately a literal rather than a token reference for that reason.
 */
const SIGNATURE_INK = '#0f172a';

export function SignatureSheet({ kind = 'signature', onCancel, onAdopt }) {
    const padRef = useRef(null);
    const wrapperRef = useRef(null);
    const [size, setSize] = useState({ width: 320, height: 200 });
    const [showEmptyHint, setShowEmptyHint] = useState(false);
    const isInitial = kind === 'initial';
    const rawId = useId().replace(/:/g, '');
    const headingId = `signature-sheet-heading-${rawId}`;
    const consentId = `signature-sheet-consent-${rawId}`;

    const title = isInitial ? 'Draw your initials' : 'Draw your signature';

    // The canvas element needs explicit pixel dimensions (width/height attrs).
    // Measure the flexible wrapper and re-measure on resize/rotation — an
    // orientation change mid-signature re-sizes the pad (drawing is cleared by
    // the library on resize, which is acceptable: a half-drawn signature at the
    // old aspect would be distorted anyway).
    useEffect(() => {
        const measure = () => {
            const el = wrapperRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            setSize({
                width: Math.max(280, Math.floor(rect.width)),
                height: Math.max(160, Math.floor(rect.height)),
            });
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

    const clear = () => {
        padRef.current?.clear();
        setShowEmptyHint(false);
    };

    const adopt = () => {
        const pad = padRef.current;
        if (!pad || pad.isEmpty()) {
            // Adopting an empty pad used to do nothing at all, with no
            // explanation — a dead control for everyone and invisible to a
            // screen-reader user. The no-op contract is unchanged (`onAdopt` is
            // still not called); it is now announced.
            setShowEmptyHint(true);
            return;
        }
        let dataUrl;
        try {
            // Trim whitespace so the ink fills the field box when stamped.
            dataUrl = pad.getTrimmedCanvas().toDataURL('image/png');
        } catch {
            // Trimming depends on a canvas API that may be unavailable (tests).
            dataUrl = pad.toDataURL('image/png');
        }
        onAdopt(dataUrl);
    };

    return (
        <Modal
            onClose={onCancel}
            labelledBy={headingId}
            describedBy={consentId}
            closeOnBackdrop={false}
            overlayClassName="fixed inset-0 z-50 flex items-stretch justify-center bg-ds-overlay md:items-center md:p-ds-6"
            className="flex h-full w-full flex-col overflow-hidden bg-ds-surface md:h-auto md:max-w-xl md:rounded-ds-xl md:shadow-ds-lg"
        >
            <div
                className="flex items-center justify-between gap-ds-2 border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-3"
                style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
            >
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    <ChevronLeft size={20} aria-hidden="true" /> Cancel
                </Button>
                <h2 id={headingId} className="text-ds-body font-bold text-ds-content">
                    {title}
                </h2>
                <Button variant="ghost" size="sm" onClick={clear}>
                    <Eraser size={16} aria-hidden="true" /> Clear
                </Button>
            </div>

            <div
                ref={wrapperRef}
                className="relative mx-ds-4 my-ds-4 flex-1 rounded-ds-xl border-2 border-dashed border-ds-border bg-ds-surface md:h-72 md:flex-none"
            >
                <SignatureCanvas
                    ref={padRef}
                    canvasProps={{
                        width: size.width,
                        height: size.height,
                        className: 'rounded-ds-xl',
                        // touchAction none: strokes must never scroll the page.
                        style: { touchAction: 'none', width: '100%', height: '100%' },
                        'data-testid': 'signature-sheet-canvas',
                    }}
                    penColor={SIGNATURE_INK}
                    minWidth={1.2}
                    maxWidth={2.6}
                    velocityFilterWeight={0.7}
                />
                <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-ds-xs text-ds-content-muted">
                    {isInitial ? 'Draw your initials' : 'Sign'} with your finger or mouse
                </p>
            </div>

            <div
                className="border-t border-ds-border-subtle bg-ds-surface px-ds-4 pb-ds-4"
                style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
                <p id={consentId} className="my-ds-3 text-ds-xs leading-snug text-ds-content-secondary">
                    By tapping Adopt, you agree this drawing is your legal{' '}
                    {isInitial ? 'initials' : 'signature'} and will be applied where you tap{' '}
                    {isInitial ? 'Initial' : 'Sign'} in this document.
                </p>
                {/* Always mounted so the message is announced when it appears
                    rather than the whole region arriving at once. */}
                <p role="status" className="mb-ds-2 text-ds-xs font-medium text-ds-status-danger-fg">
                    {showEmptyHint
                        ? `${title} before adopting ${isInitial ? 'them' : 'it'}.`
                        : ''}
                </p>
                <Button variant="primary" size="lg" fullWidth onClick={adopt}>
                    Adopt &amp; continue
                </Button>
            </div>
        </Modal>
    );
}

export default SignatureSheet;
