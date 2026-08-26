import { useCallback, useEffect, useRef } from 'react';

/*
 * `loading` disables the input, and disabling the element that currently has
 * focus drops focus to `<body>` — so an upload started from the keyboard ended
 * with the user at the top of the document once it finished. The two pickers
 * this component replaced each had their own focus-return effect for exactly
 * this; deleting them without putting the behaviour here is what a review of
 * 2026-08-25 caught.
 *
 * It belongs in the primitive rather than at each call site: `loading` is this
 * component's prop, so this is this component's consequence.
 *
 * ## Focus goes back only if it was HERE to begin with (2026-08-26)
 *
 * The first version armed the flag on every `change`, reasoning that "the
 * change event comes from the input, so the input is focused". True of the
 * picker, false of a drop: `handleDrop` below assigns the dropped files to
 * this input and dispatches `change` *from* it, and a drop moves no focus at
 * all. Measured in Chromium — after a drop on the panel `document.activeElement`
 * is still `<body>`, and the dispatched `change` arrives with it still there.
 *
 * So a mouse user who dragged a logo onto the dashed panel had focus jump into
 * a 1x1 clipped input the moment the upload finished. The restore guard below
 * cannot catch that, because `<body>` is both "the user had nothing focused"
 * and "focus was just taken away from this input" — the two states it exists
 * to tell apart. Found in review on 2026-08-26.
 *
 * The fix asks the question the guard cannot: was this input *itself* what
 * focus was on when the file arrived? That is exactly what separates the
 * paths, and each half was measured rather than assumed:
 *
 * - keyboard — Tab to the input, Space opens the picker, the OS dialog leaves
 *   `document.activeElement` on the input, and `change` fires with it there;
 * - mouse on the control — a real click on a `<label>` focuses the control it
 *   names (Chromium, measured), so this path arms too, which is right: focus
 *   is on the control the user just clicked;
 * - drop — focus stays wherever it was, so nothing arms. Unless the user had
 *   already Tabbed to this input and then dragged a file in, in which case
 *   restoring it is not a steal but a return to where they really were.
 *
 * Restoring stays conditional on nothing meaningful holding focus: never take
 * it back from wherever the user moved while the upload was in flight.
 */
export function useFocusRestore(loading, forwardedRef) {
  const inputRef = useRef(null);
  const restoreFocusOnIdle = useRef(false);

  /**
   * Read the focus BEFORE the consumer's handler runs.
   *
   * A consumer's `onChange` is what sets the state that turns `loading` on, and
   * disabling this input is what takes focus off it — so afterwards the answer
   * is already gone.
   */
  const armFromCurrentFocus = useCallback(() => {
    const node = inputRef.current;
    restoreFocusOnIdle.current = Boolean(node) && document.activeElement === node;
  }, []);

  useEffect(() => {
    if (loading || !restoreFocusOnIdle.current) return;
    restoreFocusOnIdle.current = false;
    const node = inputRef.current;
    if (!node || node.disabled) return;
    /*
     * `<body>` is where a browser puts focus after disabling the focused
     * element, but not every engine agrees: Safari can leave `activeElement`
     * null transiently, and a test DOM may report the documentElement. Treating
     * all three as "nothing focused" is what makes this a restore rather than a
     * focus steal.
     */
    const active = document.activeElement;
    const nothingFocused = !active
      || active === document.body
      || active === document.documentElement;
    if (nothingFocused) node.focus();
  }, [loading]);

  /**
   * The one place the input node is stored.
   *
   * The hook owns it rather than handing the ref out, so nothing outside has to
   * remember that a ref object is stable — and `mergeRef` forwards to whatever
   * the caller passed, which is the other reason the node has a single owner.
   */
  const mergeRef = useCallback((node) => {
    inputRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const getNode = useCallback(() => inputRef.current, []);

  return { mergeRef, getNode, armFromCurrentFocus };
}
