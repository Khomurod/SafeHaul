import { useEffect, useRef, useState } from 'react';

/**
 * Keeps keyboard focus on a "Load more" control while it loads a page.
 *
 * `Button loading` renders `disabled`, and the button unmounts once the last
 * page arrives; either can drop focus to `<body>` (out of a dialog, too). After
 * a press, once the page has landed or the read has failed, focus goes back to
 * the button while more remain, else to the "All … shown" line (`doneRef`, with
 * `tabIndex={-1}`). Focus the user moved elsewhere in the meantime stays there.
 *
 * `showDone` is true only after the user loaded a page and none remain, so a
 * list that fitted in its first read says nothing extra. A `resetKey` change
 * (another list) clears both the pending press and `showDone`.
 *
 * Usage: `<Button ref={buttonRef} loading={isLoadingMore} onClick={press(loadMore)}>`.
 */
export function useLoadMoreFocus({ resetKey, hasMore, isLoadingMore, loadMoreFailed, loadedCount }) {
    const buttonRef = useRef(null);
    const doneRef = useRef(null);
    // How many items were loaded when the user pressed; null while no press is pending.
    const [pressedAt, setPressedAt] = useState(null);
    const [userLoadedAPage, setUserLoadedAPage] = useState(false);
    const [shownResetKey, setShownResetKey] = useState(resetKey);

    // Another list: render-time adjustment, so its first paint shows no done line.
    if (shownResetKey !== resetKey) {
        setShownResetKey(resetKey);
        setPressedAt(null);
        setUserLoadedAPage(false);
    }

    useEffect(() => {
        if (pressedAt === null || isLoadingMore) return;
        // Settled: a page landed, the read failed, or nothing remains.
        if (loadedCount === pressedAt && !loadMoreFailed && hasMore) return;
        setPressedAt(null);
        const active = document.activeElement;
        if (active && active !== document.body && active !== buttonRef.current) return;
        (hasMore ? buttonRef.current : doneRef.current)?.focus();
    }, [pressedAt, isLoadingMore, loadedCount, loadMoreFailed, hasMore]);

    const press = (loadMore) => () => {
        setPressedAt(loadedCount);
        setUserLoadedAPage(true);
        loadMore();
    };

    return { buttonRef, doneRef, showDone: userLoadedAPage && !hasMore, press };
}
