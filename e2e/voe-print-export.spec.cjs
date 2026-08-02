const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/**
 * Real-browser evidence for the VOE Print and PDF export paths.
 *
 * WHY THIS SPEC EXISTS
 *
 * The Print pipeline was broken in a way that **no unit test could catch**. It
 * ran the generated legal document through `sanitizeUserContent`, whose
 * DOMPurify allowlist deletes every `<div>`, every `class` attribute and every
 * `<img>` — including the applicant's signature, the legally operative part of
 * a 49 CFR §391.23 release. In CI it looked fine, because
 * `createDOMPurify(window)` is inert under happy-dom and sanitising was a no-op
 * there. Only a real browser stripped anything. So the regression gate for this
 * fix has to be a real browser, and it has to inspect the print document
 * itself, not the pipeline that produces it.
 *
 * HOW THE PRINT DOCUMENT IS CAPTURED
 *
 * `PRINT_PROBE` is installed as an init script on the harness page and wraps
 * `window.open`, patching each pop-up it hands back. (A context init script does
 * not reach an `about:blank` pop-up, so the opener has to do the patching.) On
 * the pop-up it replaces `window.print` with a recorder — the document state at
 * the exact moment print was invoked — and `window.close` with a counter, so the
 * pop-up survives for inspection instead of vanishing. Nothing about the
 * component is mocked: the real `handlePrint` runs against a real pop-up.
 *
 * HOW THE MODAL IS REACHED
 *
 * Through `/e2e/voe-preview`, an E2E-only harness route. Under
 * `VITE_E2E_TEST_MODE=1` Firestore is unreachable, the driver dossier settles
 * into its error state and never mounts `DossierContent`, so the PEV tab and
 * this modal cannot be opened the way a user opens them. **That remains true
 * and is not fixed here** — the harness mounts the real component with the real
 * export pipeline, which proves the document and the exports, not the route to
 * them.
 */

const HARNESS = '/e2e/voe-preview?e2eAuth=company_admin';
const url = (extra = '') => `${HARNESS}${extra}`;

/** The literal string the harness injects into applicant/employer values. */
const HOSTILE_TEXT = '<img src=x onerror="window.__voePwned=1">';

/**
 * Neutralise printing and pop-up closing, and record what the document looked
 * like when `print()` was called. Installed on every page and pop-up.
 */
const PRINT_PROBE = () => {
  window.__voePrint = { calls: 0, closeCalls: 0, snapshot: null };
  const realOpen = window.open.bind(window);
  window.__realOpen = realOpen;

  window.open = (...args) => {
    const win = realOpen(...args);
    if (!win) return win;

    win.print = () => {
      window.__voePrint.calls += 1;
      const doc = win.document;
      window.__voePrint.snapshot = {
        ready: doc.body.getAttribute('data-voe-print-ready'),
        divs: doc.querySelectorAll('div').length,
        classed: doc.querySelectorAll('[class]').length,
        images: Array.from(doc.images).map((img) => ({
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          src: img.getAttribute('src'),
        })),
        styleTags: doc.querySelectorAll('style').length,
        scripts: doc.querySelectorAll('script').length,
        unloadedLinks: Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
          .filter((link) => !link.sheet).length,
      };
    };
    // Keep the pop-up alive so the test can inspect what would have printed.
    win.close = () => { window.__voePrint.closeCalls += 1; };

    return win;
  };
};

/** Open the harness with the probe installed and wait for the document. */
async function openHarness(page, extra = '') {
  await page.addInitScript(PRINT_PROBE);
  await page.goto(url(extra));
  await expect(page.getByTestId('voe-document')).toBeVisible();
}

/** Click Print and return the pop-up once `print()` has actually been called. */
async function print(page) {
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /^Print$/ }).click();
  const popup = await popupPromise;
  // The counter lives on the *opener*, so reading it never races the pop-up.
  await expect
    .poll(() => page.evaluate(() => window.__voePrint.calls), { timeout: 15000 })
    .toBe(1);
  return popup;
}

/** The generated document as it exists inside the print pop-up. */
const printedDocument = (popup) => popup.locator('[data-testid="voe-document"]');

test.describe('VOE Print produces the real document', () => {
  test('preserves structure, classes, borders and the image signature', async ({ page }) => {
    await openHarness(page);

    const source = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="voe-document"]');
      return {
        divs: node.querySelectorAll('div').length,
        classed: node.querySelectorAll('[class]').length,
        rootClass: node.getAttribute('class'),
        text: node.textContent,
      };
    });

    const popup = await print(page);
    const printed = printedDocument(popup);
    await expect(printed).toHaveCount(1);

    // ── Structure. The old pipeline left ZERO divs and ZERO classes here. ──
    const copy = await printed.evaluate((node) => ({
      divs: node.querySelectorAll('div').length,
      classed: node.querySelectorAll('[class]').length,
      rootClass: node.getAttribute('class'),
      headings: node.querySelectorAll('h1, h2, h3, h4, h5').length,
      svgs: node.querySelectorAll('svg').length,
      text: node.textContent,
    }));

    expect(copy.divs).toBe(source.divs);
    expect(copy.divs).toBeGreaterThan(50);
    expect(copy.classed).toBe(source.classed);
    expect(copy.classed).toBeGreaterThan(100);
    expect(copy.rootClass).toBe(source.rootClass);
    expect(copy.headings).toBeGreaterThanOrEqual(5);
    expect(copy.svgs).toBeGreaterThan(0);
    // Masked: the 'Generated on …' clock is re-evaluated on every render.
    const maskClock = (t) => t.replace(/Generated on .*?(?=Compliance|VOE-391)/s, 'Generated on <MASKED>');
    expect(maskClock(copy.text)).toBe(maskClock(source.text));

    // ── The signature: present, and actually decoded. ──
    const signature = printed.locator('img[alt="Signature"]');
    await expect(signature).toHaveCount(1);
    expect(await signature.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

    // ── Styling: the CSS is live in the pop-up, not just the class names. ──
    const computed = await printed.evaluate((node) => {
      const box = getComputedStyle(node);
      const heading = getComputedStyle(node.querySelector('h1'));
      const signatureBox = node.querySelector('img[alt="Signature"]').closest('div');
      return {
        background: box.backgroundColor,
        fontFamily: box.fontFamily,
        padding: box.paddingTop,
        borderWidth: box.borderTopWidth,
        headingSize: parseFloat(getComputedStyle(node.querySelector('h1')).fontSize),
        headingWeight: heading.fontWeight,
        signatureBorder: getComputedStyle(signatureBox).borderBottomWidth,
      };
    });

    expect(computed.background).toBe('rgb(255, 255, 255)');
    expect(computed.fontFamily.toLowerCase()).toContain('serif');
    expect(parseFloat(computed.padding)).toBeGreaterThan(0);
    expect(parseFloat(computed.borderWidth)).toBeGreaterThan(0);
    expect(computed.headingSize).toBeGreaterThan(20);
    expect(computed.headingWeight).toBe('900');
    expect(parseFloat(computed.signatureBorder)).toBeGreaterThan(0);

    // ── Legal text and values, verbatim. ──
    expect(copy.text).toContain('I, the undersigned applicant, hereby provide specific written consent');
    expect(copy.text).toContain('49 CFR §391.23');
    expect(copy.text).toContain('§40.321');
    expect(copy.text).toContain('Request for Verification of Employment');
    expect(copy.text).toContain('Employment History Questionnaire (To be completed by Recipient)');
    expect(copy.text).toContain('Maria Garcia');
    expect(copy.text).toContain('***-**-6789');
    expect(copy.text).not.toContain('123-45-6789');
    expect(copy.text).toMatch(/Secure Audit ID:\s*[A-Z0-9-]+/);

    await popup.close();
  });

  test('preserves a typed signature', async ({ page }) => {
    await openHarness(page, '&voeSignature=text');
    const popup = await print(page);
    const printed = printedDocument(popup);

    await expect(printed).toContainText('/s/ Maria Garcia');
    await expect(printed.locator('img[alt="Signature"]')).toHaveCount(0);

    // Typed signatures are the serif italic display treatment, not plain text.
    const style = await printed.locator('span', { hasText: '/s/ Maria Garcia' }).last()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.fontStyle, size: parseFloat(s.fontSize), family: s.fontFamily };
      });
    expect(style.style).toBe('italic');
    expect(style.size).toBeGreaterThan(24);
    expect(style.family.toLowerCase()).toContain('serif');

    await popup.close();
  });

  test('preserves the missing-signature warning', async ({ page }) => {
    await openHarness(page, '&voeSignature=none');
    const popup = await print(page);
    const printed = printedDocument(popup);

    await expect(printed).toContainText('DRIVER SIGNATURE MISSING');
    await expect(printed).toContainText('Application must be signed before transmission');
    await expect(printed.locator('img[alt="Signature"]')).toHaveCount(0);

    await popup.close();
  });

  test('loads no external stylesheet and runs no script in the print window', async ({ page }) => {
    await openHarness(page);
    const requests = [];
    page.context().on('request', (req) => requests.push(req.url()));

    const popup = await print(page);

    const head = await popup.evaluate(() => ({
      scripts: document.querySelectorAll('script').length,
      styleTags: document.querySelectorAll('style').length,
      links: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.href),
      css: Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n'),
    }));

    expect(head.scripts).toBe(0);
    expect(head.styleTags).toBeGreaterThan(0);
    expect(head.css).toMatch(/print-color-adjust:\s*exact/);
    expect(requests.some((u) => u.includes('cdn.tailwindcss.com'))).toBe(false);
    expect(head.links.some((u) => u.includes('cdn.tailwindcss.com'))).toBe(false);

    await popup.close();
  });

  test('never mutates the on-screen document', async ({ page }) => {
    await openHarness(page);
    // The "Generated on … at …" line is `new Date()` evaluated during render,
    // so it legitimately ticks whenever the component re-renders — printing
    // toggles a busy flag, as downloading already did. Masking it is what makes
    // this an assertion about the *scrub* rather than about the clock.
    const html = () => page.getByTestId('voe-document').evaluate(
      (n) => n.outerHTML.replace(/Generated on [^<]*/, 'Generated on <MASKED>'),
    );

    const before = await html();
    const popup = await print(page);
    await popup.close();

    expect(await html()).toBe(before);
    await expect(page.getByTestId('voe-document').locator('img[alt="Signature"]')).toHaveCount(1);
  });
});

test.describe('VOE Print readiness', () => {
  test('prints only after the print document is assembled, styled and decoded', async ({ page }) => {
    await openHarness(page);
    const popup = await print(page);

    const snapshot = await page.evaluate(() => window.__voePrint.snapshot);

    // The marker is set as the last step of assembling the body.
    expect(snapshot.ready).toBe('true');
    // The document was fully present, not half-written.
    expect(snapshot.divs).toBeGreaterThan(50);
    expect(snapshot.classed).toBeGreaterThan(100);
    // Styles were in place before the print call, not racing it.
    expect(snapshot.styleTags).toBeGreaterThan(0);
    expect(snapshot.unloadedLinks).toBe(0);
    // The signature had finished decoding — the whole point of waiting.
    expect(snapshot.images.length).toBe(1);
    expect(snapshot.images[0].complete).toBe(true);
    expect(snapshot.images[0].naturalWidth).toBeGreaterThan(0);

    await popup.close();
  });

  test('closes the print window after printing', async ({ page }) => {
    await openHarness(page);
    const popup = await print(page);
    await expect
      .poll(() => page.evaluate(() => window.__voePrint.closeCalls))
      .toBeGreaterThan(0);
    await popup.close();
  });
});

test.describe('VOE Print rejects hostile values', () => {
  test('renders hostile applicant and employer strings as text and executes nothing', async ({ page }) => {
    await openHarness(page, '&voeHostile=1');

    const popup = await print(page);
    const printed = printedDocument(popup);

    // Visible as text …
    await expect(printed).toContainText(HOSTILE_TEXT);

    // … and inert as markup, in the pop-up and in the opener.
    const audit = await popup.evaluate(() => {
      const node = document.querySelector('[data-testid="voe-document"]');
      return {
        pwned: window.__voePwned ?? null,
        scripts: document.querySelectorAll('script').length,
        injectedImages: node.querySelectorAll('img[src="x"]').length,
        handlerAttrs: Array.from(node.querySelectorAll('*'))
          .flatMap((el) => Array.from(el.attributes))
          .filter((a) => a.name.toLowerCase().startsWith('on')).length,
      };
    });

    expect(audit.pwned).toBeNull();
    expect(audit.scripts).toBe(0);
    expect(audit.injectedImages).toBe(0);
    expect(audit.handlerAttrs).toBe(0);
    expect(await page.evaluate(() => window.__voePwned ?? null)).toBeNull();

    // The document is still the document, not a wreck.
    await expect(printed).toContainText('Request for Verification of Employment');
    await expect(printed.locator('img[alt="Signature"]')).toHaveCount(1);

    await popup.close();
  });

  for (const [label, param] of [
    ['a javascript: signature', '&voeSignature=hostile-js'],
    ['a data:text/html signature', '&voeSignature=hostile-datahtml'],
    ['a data:image/svg+xml signature', '&voeSignature=hostile-svg'],
  ]) {
    test(`strips ${label} from the print document`, async ({ page }) => {
      await openHarness(page, param);
      const popup = await print(page);

      const signature = printedDocument(popup).locator('img[alt="Signature"]');
      await expect(signature).toHaveCount(1);
      expect(await signature.getAttribute('src')).toBeNull();
      expect(await popup.evaluate(() => window.__voePwned ?? null)).toBeNull();

      await popup.close();
    });
  }
});

test.describe('VOE Print failure paths stay recoverable', () => {
  test('reports a blocked pop-up and still prints on the next attempt', async ({ page }) => {
    await openHarness(page);

    await page.evaluate(() => {
      window.__savedOpen = window.open;
      window.open = () => null;
    });

    await page.getByRole('button', { name: /^Print$/ }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Could not open the print window. Please allow pop-ups for this site and try again.',
    );
    await expect(page.getByRole('button', { name: /^Print$/ })).toBeEnabled();

    // Recoverable: allow pop-ups again and the same control works.
    await page.evaluate(() => { window.open = window.__savedOpen; });
    const popup = await print(page);
    await expect(printedDocument(popup).locator('img[alt="Signature"]')).toHaveCount(1);
    await popup.close();
  });

  test('reports a preparation failure visibly and leaves the control usable', async ({ page }) => {
    await openHarness(page);

    // Break the print window's document the moment it is handed over.
    await page.evaluate(() => {
      // Wrap the probe wrapper, so the pop-up is still patched.
      const probeOpen = window.open.bind(window);
      window.open = (...args) => {
        const win = probeOpen(...args);
        if (win) {
          Object.defineProperty(win.document, 'write', {
            configurable: true,
            value: () => { throw new Error('print preparation failed'); },
          });
        }
        return win;
      };
    });

    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: /^Print$/ }).click();
    const popup = await popupPromise;

    await expect(page.getByRole('alert')).toContainText(
      'Failed to prepare the document for printing. Please try again.',
    );
    await expect(page.getByRole('button', { name: /^Print$/ })).toBeEnabled();
    expect(await page.evaluate(() => window.__voePrint.calls)).toBe(0);

    await popup.close().catch(() => {});
  });
});

test.describe('VOE PDF export is unchanged', () => {
  test('downloads the PDF under the frozen filename', async ({ page }) => {
    await openHarness(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /Download PDF/ }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('VOE_Acme_Freight_Maria_Garcia.pdf');
    await expect(page.getByRole('button', { name: /Download PDF/ })).toBeEnabled();
    // No export error was raised.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('leaves the capture surface intact after printing', async ({ page }) => {
    await openHarness(page);
    const popup = await print(page);
    await popup.close();

    // Printing must not disturb the node html2canvas rasterises.
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /Download PDF/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('VOE_Acme_Freight_Maria_Garcia.pdf');
  });
});

test.describe('VOE preview accessibility and layout', () => {
  test('has no serious or critical axe violations in the chrome', async ({ page }) => {
    await openHarness(page);

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      // The generated document is a facsimile of a paper form; its grey legal
      // small print fails contrast and recolouring it changes every exported
      // PDF. Recorded as an open owner decision in the roadmap, excluded here
      // rather than silently passed.
      .exclude('[data-testid="voe-document"]')
      .analyze();

    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    expect(serious.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
  });

  test('keeps the Print control keyboard reachable and operable', async ({ page }) => {
    await openHarness(page);

    const printButton = page.getByRole('button', { name: /^Print$/ });
    await printButton.focus();
    await expect(printButton).toBeFocused();

    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await expect
      .poll(() => page.evaluate(() => window.__voePrint.calls), { timeout: 15000 })
      .toBe(1);
    await popup.close();
  });

  test('Escape closes the dialog and returns to the request', async ({ page }) => {
    await openHarness(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('voe-harness-closed-count')).toHaveText('1');
  });

  test('does not overflow horizontally at desktop, tablet or phone width', async ({ page }) => {
    await openHarness(page);

    for (const [width, height] of [[1440, 900], [1024, 768], [412, 915]]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
      await expect(page.getByRole('button', { name: /^Print$/ })).toBeVisible();
    }
  });

  test('prints the full document from a phone-sized viewport', async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 412, height: 915 });

    const popup = await print(page);
    const printed = printedDocument(popup);

    await expect(printed.locator('img[alt="Signature"]')).toHaveCount(1);
    expect(await printed.evaluate((n) => n.querySelectorAll('[class]').length)).toBeGreaterThan(100);

    await popup.close();
  });
});
