/**
 * The page's zoom cap, on iOS only.
 *
 * iOS Safari zooms into a text field under 16px when it takes focus, and that
 * zoom fights the signing room's own document zoom. `maximum-scale=1` stops it
 * there, and since iOS 10 a person's pinch-zoom ignores the cap. Android honours
 * the same cap as a lock on pinch-zoom, so the page could not be enlarged at all;
 * `index.html` no longer carries it, and this adds it where it does no harm.
 */
export function isIOS({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    // iPadOS reports itself as a Mac, and only its touch screen tells them apart.
    return /iP(hone|ad|od)/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function capZoomOnIOS(doc = document, nav = navigator) {
    if (!isIOS(nav)) return;
    const viewport = doc.querySelector('meta[name="viewport"]');
    if (viewport && !/maximum-scale/.test(viewport.content)) {
        viewport.content = `${viewport.content}, maximum-scale=1`;
    }
}
