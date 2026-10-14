/**
 * Where signing in returns to: the page a signed-out visitor asked for, which
 * the protected routes hand to `/login` as `state.from`. Only a path on this
 * site counts, so a doctored history entry cannot send anyone elsewhere.
 *
 * @param {unknown} state the sign-in page's `location.state`
 * @returns {string|null}
 */
export function returnPathFrom(state) {
    const from = state?.from;
    return typeof from === 'string' && /^\/(?![/\\])/.test(from) ? from : null;
}
