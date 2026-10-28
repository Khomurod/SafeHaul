import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { contractViolation } from '../../contract';

/**
 * Unsaved changes, reported by the parts of a page that hold them and read by
 * the page that can be left.
 *
 * - `useUnsavedChanges(dirty)` is called by whatever holds an edit. While
 *   `dirty`, closing or reloading the tab asks the browser's own "Leave site?"
 *   question, and an `UnsavedChangesProvider` above it hears that it is dirty.
 * - `useUnsavedChangesGuard()` is called by whatever moves the person away.
 *   `request(action, { onCancel })` runs the move at once when nothing is
 *   dirty; otherwise it holds it as `pending`, one dialog asks (a
 *   `ConfirmDialog`), and `confirm()` runs it or `cancel()` drops it, calling
 *   `onCancel` if the move was already under way (the browser's Back).
 *   Once the person has chosen to discard, a move that reloads the page (log
 *   out) is not asked about again by the browser. A move that reports it did
 *   not happen (its promise rejects or resolves to `false`) guards the page
 *   again.
 *
 * Router-free on purpose: the application's router has no blocking API, so
 * the moves an application makes itself go through `request`.
 */
const UnsavedChangesContext = createContext(null);

export function UnsavedChangesProvider({ children }) {
  const [reports, setReports] = useState(() => new Map());
  const [pending, setPending] = useState(null);
  // Set when the person chooses to discard; read only when the page unloads.
  const discarded = useRef(false);

  const setDirty = useCallback((id, dirty) => {
    setReports((current) => {
      if (Boolean(current.get(id)) === dirty) return current;
      const next = new Map(current);
      if (dirty) next.set(id, true);
      else next.delete(id);
      return next;
    });
  }, []);

  const dirty = reports.size > 0;
  useEffect(() => {
    if (!dirty) discarded.current = false;
  }, [dirty]);
  const value = useMemo(() => ({ dirty, setDirty, pending, setPending, discarded }), [dirty, setDirty, pending]);
  return React.createElement(UnsavedChangesContext.Provider, { value }, children);
}

export function useUnsavedChanges(dirty) {
  const context = useContext(UnsavedChangesContext);
  const setDirty = context?.setDirty;
  const discarded = context?.discarded;
  const id = useId();
  const isDirty = Boolean(dirty);

  useEffect(() => {
    if (!setDirty) return undefined;
    setDirty(id, isDirty);
    return () => setDirty(id, false);
  }, [setDirty, id, isDirty]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const warn = (event) => {
      if (discarded?.current) return;
      event.preventDefault();
      // Older browsers still read this to show their question.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty, discarded]);
}

export function useUnsavedChangesGuard() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    contractViolation('useUnsavedChangesGuard needs an UnsavedChangesProvider above it.');
  }
  const { dirty = false, pending = null, setPending, discarded } = context ?? {};

  // `dirty` as the committed render saw it: an edit and a move are separate
  // events, and an edit's report commits before the next one arrives.
  const request = useCallback((action, { onCancel } = {}) => {
    if (!dirty || !setPending) {
      action();
      return;
    }
    setPending({ action, onCancel });
  }, [dirty, setPending]);

  const confirm = useCallback(() => {
    const held = pending;
    setPending?.(null);
    if (discarded) discarded.current = true;
    const outcome = held?.action();
    if (discarded && typeof outcome?.then === 'function') {
      outcome.then(
        (made) => { if (made === false) discarded.current = false; },
        () => { discarded.current = false; },
      );
    }
  }, [pending, setPending, discarded]);

  const cancel = useCallback(() => {
    const held = pending;
    setPending?.(null);
    held?.onCancel?.();
  }, [pending, setPending]);

  return { dirty, pending: Boolean(pending), request, confirm, cancel };
}
