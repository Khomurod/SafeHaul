/**
 * The redesigned marketing site.
 *
 * The landing site is static HTML with no build step, so — as with
 * `landingNewsSection.test.js` — these tests read the shipped files directly.
 * That is the only way to hold a page with no component tree to a contract.
 *
 * The assertions here are deliberately weighted towards the defects the
 * redesign was fixing, because those are the ones that will come back:
 *
 *  - claims the product's own capability package prohibits;
 *  - a FAQ accordion no keyboard user could open;
 *  - a dialog that was `aria-modal` in name only;
 *  - screenshots containing real people's names and phone numbers;
 *  - the lead form losing everything when a visitor abandoned it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

const html = read('landing/index.html');
const privacy = read('landing/privacy.html');
const css = read('landing/assets/css/styles.css');
const js = read('landing/assets/js/main.js');

/** Page text as a visitor reads it: no markup, no comments. */
const visibleText = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('landing page — claims match the verified capability package', () => {
    // The deterministic checker the article pipeline already runs on every
    // draft. Importing it rather than restating the rules is what stops the
    // marketing page and the blog from drifting apart.
    it('makes no claim the capability package prohibits', async () => {
        const { checkClaims } = await import('../../functions/ai/knowledge/safehaulCapabilities.js');
        const result = checkClaims(visibleText);
        expect(result.violations).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('does not promise the product is free while selling subscriptions', () => {
        expect(visibleText).not.toMatch(/free\s+forever/i);
        // The pricing it does publish is still there.
        expect(visibleText).toMatch(/199/);
        expect(visibleText).toMatch(/299/);
    });

    it('does not advertise a job board, which does not exist in the codebase', () => {
        expect(visibleText).not.toMatch(/\bjob\s*board\b/i);
    });

    it('does not claim document-expiry monitoring, and says plainly that it is absent', () => {
        expect(visibleText).not.toMatch(/(expir\w*|renewal)\s+(reminder|alert)s?\b/i);
        // Stating the limitation is the point: the honest version of this
        // section is worth more than the missing feature.
        expect(visibleText).toMatch(/does not (monitor|track) their dates|it does not monitor/i);
    });

    it('does not claim to guarantee DOT compliance', () => {
        expect(visibleText).not.toMatch(/(guarantee\w*)\s+(your\s+)?(fmcsa|dot)\s+compliance/i);
        expect(visibleText).toMatch(/no software can do that/i);
    });

    it('states the bulk-messaging limitation the package requires', () => {
        // `bulk-messaging` is `partial`: its stated limitations must accompany
        // any mention of it.
        expect(visibleText).toMatch(/your own messaging provider/i);
        expect(visibleText).toMatch(/two-way (message|conversation) threads.{0,60}not/i);
    });
});

describe('landing page — accessibility', () => {
    it('gives every FAQ question a real button with a state', () => {
        // Previously a <div> with a click listener: no keyboard user could open
        // a single answer on the page.
        const questions = html.match(/<button[^>]*class="faq-question"[^>]*>/g) || [];
        expect(questions.length).toBeGreaterThanOrEqual(6);
        for (const button of questions) {
            expect(button).toMatch(/aria-expanded="false"/);
            expect(button).toMatch(/aria-controls="faq-a\d+"/);
        }
        expect(js).toMatch(/setAttribute\('aria-expanded'/);
    });

    it('toggles answers with the hidden attribute, and makes hidden actually win', () => {
        expect(html).toMatch(/class="faq-answer"[^>]*hidden/);
        // `.form-step` and `.modal-success` set a display value, which outranks
        // the browser default for [hidden]. Without this rule `element.hidden`
        // silently does nothing.
        expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
    });

    it('traps focus inside the lead dialog', () => {
        expect(js).toContain('trapFocus');
        expect(js).toMatch(/event\.key !== 'Tab'/);
        expect(js).toMatch(/document\.addEventListener\('keydown', trapFocus\)/);
        expect(js).toMatch(/document\.removeEventListener\('keydown', trapFocus\)/);
    });

    it('moves focus into the dialog after the overlay becomes visible', () => {
        // Focus called in the same frame as the class change silently fails
        // while the overlay is still `visibility: hidden`.
        expect(js).toMatch(/requestAnimationFrame/);
        expect(css).toMatch(/\.modal-overlay\.active\s*\{[^}]*visibility:\s*visible/);
        expect(css).toMatch(/transition:[^;]*visibility 0s;/);
    });

    it('announces the mobile menu state', () => {
        expect(html).toMatch(/id="mobileMenuToggle"[\s\S]{0,160}aria-expanded="false"/);
        expect(html).toMatch(/aria-controls="navLinks"/);
    });

    it('offers a skip link and a single h1', () => {
        expect(html).toContain('class="skip-link"');
        expect(css).toMatch(/\.skip-link:focus\s*\{[^}]*top:\s*0/);
        expect((html.match(/<h1[\s>]/g) || []).length).toBe(1);
    });

    it('keeps every interactive target at least 44px high', () => {
        expect(css).toMatch(/\.btn\s*\{[\s\S]{0,300}min-height:\s*44px/);
        expect(css).toMatch(/\.mobile-menu-toggle\s*\{[\s\S]{0,300}height:\s*44px/);
    });

    it('honours prefers-reduced-motion', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}animation-duration:\s*0\.001ms/);
    });

    it('never uses a rule or ground token as a text colour', () => {
        // REPLACES the outgoing `never uses the folder ground as a text colour`.
        // That assertion named `--folder`/`--folder-deep`, the goldenrod ground
        // of the world this redesign left; neither token exists any more, so the
        // old grep could only ever pass vacuously. The rule it protected is real
        // and still worth enforcing, so it is re-pointed at the tokens that now
        // carry the same risk: the three grounds and the two rule weights. They
        // may fill a band or draw a hairline; they may not carry a word.
        // `--rule-strong` (#C3C7C3) measures 1.9:1 on `--paper` and `--paper-2`
        // is a 1.04:1 non-colour — text in either is text nobody can read.
        //
        // The lookbehind excludes `background-color`, `border-color` and
        // `outline-color`, none of which set text.
        const textColour = css.match(
            /(?<![a-z-])color:\s*var\(--(rule|rule-strong|paper-2|paper-3)\)[^;]*/g,
        ) || [];
        expect(textColour).toEqual([]);
    });
});

describe('landing page — conversion flow', () => {
    it('asks only for a name and an email before capturing the lead', () => {
        const stepOne = html.slice(html.indexOf('id="stepOne"'), html.indexOf('id="stepTwo"'));
        expect(stepOne).toContain('id="fullName"');
        expect(stepOne).toContain('id="workEmail"');
        // Qualification belongs to step two, after the lead is already saved.
        expect(stepOne).not.toContain('id="companySize"');
        expect(stepOne).not.toContain('id="primaryGoal"');
    });

    it('posts step one and step two separately to the same endpoint', () => {
        expect(js).toContain("fetch('/api/landing-lead'");
        expect(js).toMatch(/step:\s*1/);
        expect(js).toMatch(/step:\s*2/);
        expect(js).toMatch(/reference:\s*leadReference/);
    });

    it('lets the visitor skip qualification, because step one already counted', () => {
        expect(html).toContain('id="skipStepTwo"');
        expect(js).toMatch(/skipButton\.addEventListener\('click'/);
    });

    it('keeps the honeypot, hidden from people and out of the tab order', () => {
        expect(html).toMatch(/class="honeypot-field"[^>]*aria-hidden="true"/);
        expect(html).toMatch(/id="website"[^>]*tabindex="-1"/);
        // Positioned off-screen rather than display:none, which some bots skip.
        expect(css).toMatch(/\.honeypot-field\s*\{[^}]*position:\s*absolute/);
    });

    it('reports errors inline instead of through a browser alert', () => {
        expect(js).not.toMatch(/\balert\s*\(/);
        expect(html).toContain('class="field-error"');
        expect(html).toMatch(/id="formStatus"[^>]*role="status"/);
    });

    it('captures attribution without asking the visitor for it', () => {
        expect(js).toMatch(/utm_source/);
        expect(js).toMatch(/sourcePage/);
    });
});

describe('landing page — SEO', () => {
    it('declares a canonical URL and an Open Graph card', () => {
        expect(html).toMatch(/<link rel="canonical" href="https:\/\/safehaul\.io\/">/);
        expect(html).toContain('property="og:site_name"');
        expect(html).toMatch(/og:image" content="https:\/\/safehaul\.io\/assets\/images\/og-card\.png"/);
        expect(html).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('ships a real raster social card, not the SVG logo', () => {
        // Most social platforms will not render an SVG og:image, so the old
        // page effectively had none.
        expect(existsSync(resolve(root, 'landing/assets/images/og-card.png'))).toBe(true);
        expect(html).not.toMatch(/og:image"[^>]*logo\.svg/);
        expect(html).toContain('<meta property="og:image:width" content="1200">');
    });

    it('publishes Organization and SoftwareApplication structured data', () => {
        const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        expect(jsonLd).not.toBeNull();
        const parsed = JSON.parse(jsonLd[1]);
        const types = parsed['@graph'].map((node) => node['@type']);
        expect(types).toContain('Organization');
        expect(types).toContain('SoftwareApplication');

        // The advertised prices and the structured data must agree; two numbers
        // on one page that disagree is the mistake this whole redesign started with.
        const offers = parsed['@graph'].find((n) => n['@type'] === 'SoftwareApplication').offers;
        expect(offers.map((offer) => offer.price).sort()).toEqual(['199', '299']);
    });

    it('links the article feed from the page head', () => {
        expect(html).toMatch(/rel="alternate" type="application\/atom\+xml"/);
    });

    it('gives privacy.html its own canonical', () => {
        expect(privacy).toMatch(/<link rel="canonical" href="https:\/\/safehaul\.io\/privacy\.html">/);
    });
});

describe('landing page — performance', () => {
    it('self-hosts both faces rather than blocking render on a third party', () => {
        // Archivo carries structure and display; Geist Mono carries anything a
        // technical document types or numbers. Both are served from this folder,
        // so the page never opens a connection to a font CDN.
        //
        // The second path was `courier-prime.woff2` until the "Specification"
        // redesign replaced that face with Geist Mono and deleted both Courier
        // Prime files. Only the path changed: the CDN prohibitions and the
        // `font-display: swap` requirement below are the point of this test and
        // are untouched.
        expect(existsSync(resolve(root, 'landing/assets/fonts/archivo-variable.woff2'))).toBe(true);
        expect(existsSync(resolve(root, 'landing/assets/fonts/geist-mono-variable.woff2'))).toBe(true);
        expect(css).toMatch(/@font-face\s*\{[\s\S]{0,300}font-display:\s*swap/);
        // Comments are stripped first: the head comment explains why the
        // Google Fonts request was removed, and matching that would fail the
        // page for documenting the very thing being asserted.
        const markup = (source) => source.replace(/<!--[\s\S]*?-->/g, ' ');
        expect(markup(html)).not.toContain('fonts.googleapis.com');
        expect(markup(privacy)).not.toContain('fonts.googleapis.com');
        expect(markup(html)).not.toContain('fonts.gstatic.com');
    });

    it('needs no hero image request, and preloads both faces it does need', () => {
        // REPLACES `preloads the hero image and marks it high priority`, which
        // asserted a `rel="preload" as="image"` for pipeline.png. The
        // "Specification" redesign removed the hero screenshot: the first
        // viewport's figure is authored inline SVG, so it arrives inside the
        // document and there is nothing left to preload — the old assertion
        // described a request that would now be a regression to add.
        //
        // What still matters is kept, in two parts. First, the hero must not be
        // lazy: whatever it contains is above the fold by definition.
        const hero = html.slice(html.indexOf('class="hero-visual'), html.indexOf('logos-section'));
        expect(hero.length).toBeGreaterThan(1);
        expect(hero).not.toContain('loading="lazy"');
        // Second, the two self-hosted faces ARE render-critical, so both are
        // preloaded with the crossorigin a font fetch requires.
        for (const face of ['archivo-variable', 'geist-mono-variable']) {
            expect(html).toMatch(
                new RegExp(`rel="preload" href="/assets/fonts/${face}\\.woff2" as="font"[^>]*crossorigin`),
            );
        }
    });

    it('declares intrinsic dimensions on every image, so nothing shifts', () => {
        const images = html.match(/<img[^>]*>/g) || [];
        expect(images.length).toBeGreaterThan(4);
        for (const img of images) {
            expect(img).toMatch(/width="\d+"/);
            expect(img).toMatch(/height="\d+"/);
            expect(img).toMatch(/alt="/);
        }
    });

    it('lazy-loads everything below the fold but not the hero', () => {
        const hero = html.slice(html.indexOf('class="hero-visual"'), html.indexOf('logos-section'));
        expect(hero).not.toContain('loading="lazy"');
        const below = html.slice(html.indexOf('logos-section'));
        expect(below).toContain('loading="lazy"');
    });
});

describe('landing page — assets', () => {
    it('ships no image with a filename the web handles badly', () => {
        const logos = readdirSync(resolve(root, 'landing/assets/images/company_logos'));
        for (const file of logos) {
            // Spaces and ampersands have to be URL-encoded in markup, and .jfif
            // is patchily supported by tooling.
            expect(file).not.toMatch(/[\s&]/);
            expect(file).not.toMatch(/\.jfif$/);
        }
    });

    it('does not ship the orphaned images the old page carried', () => {
        // ~537 KB that appeared in the deploy artifact and on no page.
        expect(existsSync(resolve(root, 'landing/assets/images/hero-illustration.png'))).toBe(false);
        expect(existsSync(resolve(root, 'landing/assets/images/feature-leads.png'))).toBe(false);
    });

    it('references only screenshots that exist', () => {
        const referenced = [...html.matchAll(/src="(\/assets\/images\/screenshots\/[^"]+)"/g)]
            .map((match) => match[1]);
        expect(referenced.length).toBeGreaterThan(0);
        for (const src of new Set(referenced)) {
            expect(existsSync(resolve(root, 'landing', src.slice(1)))).toBe(true);
        }
    });
});

describe('landing page — no duplicated lead form', () => {
    it('keeps the dialog on one page only', () => {
        // The modal used to be copy-pasted into privacy.html, so every change
        // had to be made twice or the two drifted.
        expect(html).toContain('id="leadModal"');
        expect(privacy).not.toContain('id="leadModal"');
        expect(privacy).not.toContain('js-open-lead-modal');
        // privacy.html routes to the homepage dialog instead.
        expect(privacy).toContain('href="/#get-started"');
        expect(js).toMatch(/window\.location\.hash === '#get-started'/);
    });
});
