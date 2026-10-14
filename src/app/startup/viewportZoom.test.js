/**
 * `maximum-scale=1` sat in `index.html` for every browser, so Android, which
 * honours it as a lock, could not pinch-zoom the app at all. It is now added on
 * iOS only, where it stops only Safari's zoom into a focused field.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { capZoomOnIOS, isIOS } from './viewportZoom';

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 };
const IPAD_AS_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const MAC = { ...IPAD_AS_MAC, maxTouchPoints: 0 };
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 };

const BASE = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
const viewport = () => document.querySelector('meta[name="viewport"]');

beforeEach(() => {
    document.head.innerHTML = `<meta name="viewport" content="${BASE}">`;
});

describe('the viewport zoom cap', () => {
    it('tells iPhone and iPadOS from a Mac and from Android', () => {
        expect([IPHONE, IPAD_AS_MAC, MAC, ANDROID].map(isIOS)).toEqual([true, true, false, false]);
    });

    it('caps zoom on iOS, once', () => {
        capZoomOnIOS(document, IPHONE);
        capZoomOnIOS(document, IPHONE);
        expect(viewport().content).toBe(`${BASE}, maximum-scale=1`);
    });

    it('is not in index.html, which every browser reads', () => {
        const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
        const [, content] = html.match(/<meta name="viewport" content="([^"]*)"/);
        expect(content).toBe(BASE);
    });

    it('leaves Android and desktops free to zoom', () => {
        capZoomOnIOS(document, ANDROID);
        capZoomOnIOS(document, MAC);
        expect(viewport().content).toBe(BASE);
    });
});
