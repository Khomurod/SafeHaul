/**
 * Landing-page News & Insights integration.
 *
 * The landing site is static HTML with no build step, so it has no component
 * test to hang assertions off. These tests read the shipped files directly,
 * which is the only way to hold the marketing page to a contract.
 *
 * They deliberately assert two different kinds of thing:
 *  - that the section, navigation and responsive rules are actually present;
 *  - that the card-rendering script cannot inject markup, since it renders
 *    values fetched from an endpoint at runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const html = readFileSync(resolve(root, 'landing/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'landing/assets/css/styles.css'), 'utf8');
const js = readFileSync(resolve(root, 'landing/assets/js/main.js'), 'utf8');

describe('landing page — News & Insights section', () => {
    it('uses the exact required section name', () => {
        expect(html).toContain('SafeHaul News &amp; Insights');
    });

    it('adds a News navigation link pointing at the public route', () => {
        expect(html).toMatch(/<a href="\/news" class="nav-link">News &amp; Insights<\/a>/);
    });

    it('keeps the existing navigation links intact', () => {
        for (const anchor of ['#features', '#pricing', '#why-safehaul', '#faq', '#footer']) {
            expect(html).toContain(`href="${anchor}"`);
        }
    });

    it('links to News & Insights from the footer as well', () => {
        const footer = html.slice(html.indexOf('<footer'));
        expect(footer).toContain('href="/news"');
        expect(footer).toContain('href="/privacy.html"');
    });

    it('provides a link to view every article', () => {
        expect(html).toMatch(/<a href="\/news" class="btn btn-secondary">View all articles<\/a>/);
    });

    it('renders a placeholder so the section is never empty', () => {
        expect(html).toContain('id="newsGrid"');
        expect(html).toContain('id="newsLoading"');
        expect(html).toMatch(/aria-live="polite"/);
        expect(html).toMatch(/aria-busy="true"/);
    });

    it('does not commit article cards, which are published after deployment', () => {
        // A committed card would be stale the day after it shipped, and the
        // landing site has no build step that could regenerate one.
        expect(html).not.toContain('news-card-excerpt');
    });

    it('leaves the lead form and its endpoint untouched', () => {
        expect(html).toContain('id="leadModal"');
        expect(html).toContain('js-open-lead-modal');
        expect(js).toContain("fetch('/api/landing-lead'");
    });

    it('does not pull application or design-system code into the static page', () => {
        // Comments are stripped first: the section's own comment explains that
        // no React is pulled in, and matching that would be a false positive.
        const markup = html.replace(/<!--[\s\S]*?-->/g, '');
        expect(markup).not.toMatch(/\/src\//);
        expect(markup).not.toMatch(/\breact\b/i);
        expect(markup).not.toMatch(/type="module"/);
        // One local stylesheet and one local script, as before.
        expect(html).toMatch(/href="\/assets\/css\/styles\.css/);
        expect(html).toMatch(/src="\/assets\/js\/main\.js"/);
    });
});

describe('landing page — card rendering safety', () => {
    it('never assigns innerHTML anywhere in the page script', () => {
        // The endpoint's output is already escaped server-side, but this page
        // must not depend on that.
        expect(js).not.toMatch(/\.innerHTML\s*=/);
        expect(js).not.toMatch(/insertAdjacentHTML/);
        expect(js).not.toMatch(/document\.write/);
    });

    it('inserts every fetched value as text, not markup', () => {
        expect(js).toContain('titleLink.textContent = post.title');
        expect(js).toContain('excerpt.textContent = post.excerpt');
        expect(js).toContain('eyebrow.textContent = post.themeName');
    });

    it('always sets image alt text, falling back to the title', () => {
        expect(js).toContain('img.alt = post.image.altText || post.title');
    });

    it('requests only three cards', () => {
        expect(js).toContain("fetch('/api/news/latest?limit=3'");
        expect(js).toContain('posts.slice(0, 3)');
    });

    it('degrades to a link rather than an error when the fetch fails', () => {
        expect(js).toContain('renderNewsFallback');
        expect(js).toMatch(/Articles could not be loaded right now/);
        expect(js).toMatch(/The first articles are on their way/);
        expect(js).not.toMatch(/alert\((['"`])Articles/);
    });

    it('clears aria-busy once rendering finishes', () => {
        expect(js).toMatch(/setAttribute\('aria-busy', 'false'\)/);
    });

    it('skips a malformed post rather than rendering an empty card', () => {
        expect(js).toContain('if (post && post.title && post.url)');
    });
});

describe('landing page — News & Insights styling', () => {
    it('styles the card grid with the existing brand tokens', () => {
        expect(css).toContain('.news-section');
        expect(css).toContain('.news-card');
        // Reuses the page's own custom properties rather than new hard-coded
        // colours.
        expect(css).toMatch(/\.news-eyebrow\s*\{[^}]*var\(--deep-blue\)/);
        expect(css).toMatch(/\.news-card\s*\{[^}]*var\(--gray-200\)/);
    });

    it('collapses the grid at the tablet and mobile breakpoints', () => {
        expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]{0,300}grid-template-columns: repeat\(2, 1fr\)/);
        expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]{0,400}grid-template-columns: 1fr/);
        expect(css).toContain('@media (max-width: 480px)');
    });

    it('keeps a visible focus indicator for keyboard users', () => {
        expect(css).toMatch(/\.news-card a:focus-visible[\s\S]{0,200}outline:/);
    });

    it('allows long source URLs to wrap so narrow screens do not scroll sideways', () => {
        expect(css).toMatch(/\.news-sources a\s*\{[\s\S]{0,120}word-break: break-word/);
    });

    it('does not introduce body text below 11px', () => {
        // The design standard forbids 9px and 10px body text.
        const newsBlock = css.slice(css.indexOf('SafeHaul News & Insights'));
        const sizes = [...newsBlock.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)].map((match) => {
            const value = Number(match[1]);
            return match[2] === 'rem' ? value * 16 : value;
        });
        expect(sizes.length).toBeGreaterThan(0);
        for (const size of sizes) expect(size).toBeGreaterThanOrEqual(11);
    });
});

describe('landing page — fallback article image', () => {
    const svg = readFileSync(resolve(root, 'landing/assets/images/news-fallback.svg'), 'utf8');

    it('exists at the path the pipeline references', () => {
        // functions/blog/media/imageProviders.js FALLBACK_IMAGE.imageUrl
        expect(svg).toContain('<svg');
    });

    it('carries an accessible name and the Open Graph card ratio', () => {
        expect(svg).toContain('role="img"');
        expect(svg).toMatch(/aria-label="SafeHaul News and Insights"/);
        expect(svg).toContain('viewBox="0 0 1200 630"');
    });

    it('references no external resource, so it cannot leak a request', () => {
        expect(svg).not.toMatch(/xlink:href|<image|url\(http/);
        expect(svg).not.toMatch(/<script/);
    });
});
