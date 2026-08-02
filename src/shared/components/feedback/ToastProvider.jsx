import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { IconButton } from '@/design-system/components';

const ToastContext = createContext();

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

/**
 * Severity → icon, tone tokens and the announced severity word.
 *
 * The severity word is visually hidden: sighted users get the icon shape and the
 * tone, but before this a screen-reader user heard only the bare message and had
 * no way to tell a success from a failure.
 */
const TOAST_VARIANTS = {
  success: {
    icon: CheckCircle,
    severity: 'Success',
    border: 'border-ds-status-success-border',
    badge: 'bg-ds-status-success-bg text-ds-status-success-fg',
  },
  error: {
    icon: AlertCircle,
    severity: 'Error',
    border: 'border-ds-status-danger-border',
    badge: 'bg-ds-status-danger-bg text-ds-status-danger-fg',
  },
  info: {
    icon: Info,
    severity: 'Information',
    border: 'border-ds-status-info-border',
    badge: 'bg-ds-status-info-bg text-ds-status-info-fg',
  },
  warning: {
    icon: AlertTriangle,
    severity: 'Warning',
    border: 'border-ds-status-warning-border',
    badge: 'bg-ds-status-warning-bg text-ds-status-warning-fg',
  },
};

/**
 * Global transient-notification surface.
 *
 * Visual migration completed 2026-07-28, closing the roadmap's
 * "Toast/notification" row. This is presentation only — the public API
 * (`showSuccess` / `showError` / `showInfo` / `showWarning`), the
 * `addToast(type, message, duration = 4000)` signature, the id shape, the
 * `setTimeout` auto-dismiss, the `role="alert"` announcement and the
 * `Dismiss notification: {message}` control name are all unchanged. No caller
 * needs to change.
 *
 * Two accessibility defects on the dismiss control were fixed separately on
 * 2026-07-27 (it had no accessible name — axe `button-name` critical — and a
 * 16×16 px hit area). The palette migration was deliberately deferred then
 * because this is a global surface; it is done here.
 *
 * Defects fixed in this pass:
 *  1. **Nine legacy palette classes** — `border-green-200`, `bg-green-50`,
 *     `text-green-600` and the red/blue/yellow equivalents — replaced with the
 *     semantic status tokens. `text-yellow-600` in particular was never an
 *     approved token and measured below AA on white.
 *  2. **The dismiss icon was `text-gray-400` on white = 2.56:1.** It is now an
 *     approved `IconButton`, which also gives it the shared focus ring and hit
 *     area rather than a locally hand-rolled 28 px box.
 *  3. **Severity was inaudible.** The icon was `aria-hidden` and the message
 *     never says what kind of notification it is, so a screen-reader user could
 *     not distinguish success from failure. Each toast now announces its severity
 *     before the message.
 *  4. **Long messages could push the toast off-screen on a phone.** The stack was
 *     pinned to `right-6` with no max width and no wrapping rule, so an
 *     unbreakable string (a Firebase error, a long file name) overflowed
 *     horizontally at 412 px. The stack now insets from both edges below `sm`,
 *     caps its width against the viewport, and wraps long words.
 *  5. **An unbounded stack could exceed the viewport height.** The column is now
 *     capped and clips, so a burst of notifications cannot paint over the whole
 *     screen or grow the document.
 *  6. Hard-coded `rounded-lg`, `shadow-lg`, `text-sm` and raw `px-4 py-3` /
 *     `gap-3` spacing replaced with radius, elevation, type and spacing tokens.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((type, message, duration = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message }]);

    if (duration) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const showSuccess = (msg) => addToast('success', msg);
  const showError = (msg) => addToast('error', msg);
  const showInfo = (msg) => addToast('info', msg);
  const showWarning = (msg) => addToast('warning', msg);

  return (
    <ToastContext.Provider value={{ showSuccess, showError, showInfo, showWarning }}>
      {children}

      <div className="pointer-events-none fixed bottom-ds-6 left-ds-4 right-ds-4 z-[100] flex max-h-[calc(100vh-3rem)] flex-col items-end gap-ds-3 overflow-hidden sm:left-auto sm:right-ds-6">
        {toasts.map((toast) => {
          const variant = TOAST_VARIANTS[toast.type] || TOAST_VARIANTS.info;
          const Icon = variant.icon;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-md items-center gap-ds-3 rounded-ds-md border bg-ds-surface px-ds-4 py-ds-3 text-ds-content shadow-ds-lg animate-in slide-in-from-right-full duration-300 ${variant.border}`}
              role="alert"
            >
              <div className={`shrink-0 rounded-full p-1 ${variant.badge}`}>
                {/* Decorative: the severity word and the message carry the meaning. */}
                <Icon size={18} aria-hidden="true" />
              </div>

              <p className="min-w-0 break-words pr-ds-4 text-ds-sm font-medium">
                <span className="sr-only">{variant.severity}: </span>
                {toast.message}
              </p>

              {/*
                DEFECT FIXED (2026-07-27): this dismiss control had no accessible
                name at all — an icon-only button whose only child was a decorative
                `<X>`. The real-browser axe scan of the public driver application
                reported it as `button-name [critical]`, once per visible toast (the
                guest wizard shows one per upload plus one per submission message).
                It also had no explicit `type`, so inside a form it would submit.
                The hit area was 16×16 px, failing WCAG 2.2 AA SC 2.5.8.

                It is now the approved `IconButton`, which owns the name
                requirement, the type, the hit area and the focus ring — so the
                locally hand-rolled 28 px box is gone too.
              */}
              <IconButton
                label={`Dismiss notification: ${toast.message}`}
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0"
                onClick={() => removeToast(toast.id)}
              >
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
