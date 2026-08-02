/**
 * Policy tests for the trusted-document print helpers.
 *
 * These are worth writing (unlike a unit test of `sanitizeUserContent`'s
 * allowlist, which is meaningless here because `createDOMPurify(window)` is
 * inert under happy-dom) because `scrubTrustedPrintTree` is *our own* DOM walk.
 * It behaves identically in happy-dom and in Chrome, so what passes here is
 * what happens in a real print window. The browser-level proof that the printed
 * page is the document lives in `e2e/voe-print-export.spec.cjs`.
 */
import { describe, it, expect } from 'vitest';
import {
  PRINT_DOCUMENT_STYLES,
  collectPrintStyles,
  scrubTrustedPrintTree,
  waitForPrintDocumentReady,
} from '@shared/utils/printDocument';

const treeFrom = (html) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('scrubTrustedPrintTree — what it must preserve', () => {
  it('keeps structural elements that the user-content sanitiser deletes', () => {
    const root = treeFrom(`
      <div class="bg-white border p-12">
        <h1 class="text-2xl">SAFEHAUL</h1>
        <h4 class="uppercase">To (Previous Employer)</h4>
        <table><tbody><tr><td>cell</td></tr></tbody></table>
      </div>
    `);

    scrubTrustedPrintTree(root);

    expect(root.querySelectorAll('div').length).toBe(1);
    expect(root.querySelector('h1')?.textContent).toBe('SAFEHAUL');
    expect(root.querySelector('h4')).not.toBeNull();
    expect(root.querySelector('td')?.textContent).toBe('cell');
  });

  it('keeps every class attribute, which is what makes the printed page styled', () => {
    const root = treeFrom('<div class="a b"><span class="c">x</span></div>');
    scrubTrustedPrintTree(root);
    expect(root.querySelector('div').getAttribute('class')).toBe('a b');
    expect(root.querySelector('span').getAttribute('class')).toBe('c');
  });

  it('keeps a base64 raster signature image', () => {
    const root = treeFrom('<img alt="Signature" class="h-20" src="data:image/png;base64,AAAA">');
    scrubTrustedPrintTree(root);
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img.getAttribute('alt')).toBe('Signature');
  });

  it('keeps an https signature image', () => {
    const root = treeFrom('<img alt="Signature" src="https://cdn.example.test/sig.png">');
    scrubTrustedPrintTree(root);
    expect(root.querySelector('img').getAttribute('src')).toBe('https://cdn.example.test/sig.png');
  });

  it('keeps the inline svg watermark and shield icons', () => {
    const root = treeFrom('<svg viewBox="0 0 24 24"><path d="M1 1"></path></svg>');
    scrubTrustedPrintTree(root);
    expect(root.querySelector('svg')).not.toBeNull();
    expect(root.querySelector('path').getAttribute('d')).toBe('M1 1');
  });

  it('keeps a benign inline style', () => {
    const root = treeFrom('<div style="padding: 20px;">x</div>');
    scrubTrustedPrintTree(root);
    expect(root.querySelector('div').getAttribute('style')).toBe('padding: 20px;');
  });

  it('reports nothing removed for markup that is already clean', () => {
    const root = treeFrom('<div class="a"><img alt="Signature" src="data:image/png;base64,AA"><h1>T</h1></div>');
    expect(scrubTrustedPrintTree(root)).toEqual({ removedElements: [], removedAttributes: [] });
  });
});

describe('scrubTrustedPrintTree — what it must remove', () => {
  it('deletes script elements outright, content and all', () => {
    const root = treeFrom('<div>before<script>window.pwned = true;</script>after</div>');
    const { removedElements } = scrubTrustedPrintTree(root);
    expect(root.querySelector('script')).toBeNull();
    expect(root.innerHTML).not.toContain('pwned');
    expect(removedElements).toContain('script');
  });

  it.each(['iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'style', 'template', 'canvas', 'video', 'audio'])(
    'deletes <%s>',
    (tag) => {
      const root = treeFrom(`<div><${tag}></${tag}></div>`);
      scrubTrustedPrintTree(root);
      expect(root.querySelector(tag)).toBeNull();
    },
  );

  it('deletes every on* handler attribute', () => {
    const root = treeFrom('<div onclick="a()" onmouseover="b()" ONLOAD="c()"><span onerror="d()">x</span></div>');
    const { removedAttributes } = scrubTrustedPrintTree(root);
    const div = root.querySelector('div');
    expect(div.getAttribute('onclick')).toBeNull();
    expect(div.getAttribute('onmouseover')).toBeNull();
    expect(div.getAttribute('onload')).toBeNull();
    expect(root.querySelector('span').getAttribute('onerror')).toBeNull();
    expect(removedAttributes).toEqual(
      expect.arrayContaining(['div@onclick', 'div@onmouseover', 'div@onload', 'span@onerror']),
    );
    // The element itself survives — only the handler goes.
    expect(div).not.toBeNull();
  });

  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['  javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['java\nscript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['vbscript:msgbox(1)'],
  ])('strips an unsafe img src (%s)', (src) => {
    const root = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', src);
    img.setAttribute('alt', 'Signature');
    root.appendChild(img);

    const { removedAttributes } = scrubTrustedPrintTree(root);

    expect(root.querySelector('img').getAttribute('src')).toBeNull();
    expect(removedAttributes).toContain('img@src');
    // The alt text remains, so a rejected signature is visibly absent rather
    // than silently replaced by something else.
    expect(root.querySelector('img').getAttribute('alt')).toBe('Signature');
  });

  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>1</script>'])(
    'strips an unsafe href (%s)',
    (href) => {
      const root = document.createElement('div');
      const anchor = document.createElement('a');
      anchor.setAttribute('href', href);
      root.appendChild(anchor);

      scrubTrustedPrintTree(root);
      expect(root.querySelector('a').getAttribute('href')).toBeNull();
    },
  );

  it('keeps safe hrefs', () => {
    const root = treeFrom('<div><a href="https://a.test">a</a><a href="mailto:hr@a.test">b</a><a href="tel:+15125550100">c</a><a href="#x">d</a><a href="/rel">e</a></div>');
    scrubTrustedPrintTree(root);
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://a.test', 'mailto:hr@a.test', 'tel:+15125550100', '#x', '/rel']);
  });

  it('strips srcdoc and a javascript-bearing style', () => {
    const root = treeFrom('<div srcdoc="<script>1</script>" style="background:url(javascript:alert(1))">x</div>');
    scrubTrustedPrintTree(root);
    const div = root.querySelector('div');
    expect(div.getAttribute('srcdoc')).toBeNull();
    expect(div.getAttribute('style')).toBeNull();
  });

  it('does not choke on a nested forbidden element inside a removed subtree', () => {
    const root = treeFrom('<div><form><input><script>1</script></form><p class="keep">kept</p></div>');
    scrubTrustedPrintTree(root);
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('p.keep')?.textContent).toBe('kept');
  });

  it('scrubs the root element itself, not only its descendants', () => {
    const root = treeFrom('<span>x</span>');
    root.setAttribute('onclick', 'a()');
    scrubTrustedPrintTree(root);
    expect(root.getAttribute('onclick')).toBeNull();
  });

  it('tolerates a null or non-element argument', () => {
    expect(scrubTrustedPrintTree(null)).toEqual({ removedElements: [], removedAttributes: [] });
    expect(scrubTrustedPrintTree({})).toEqual({ removedElements: [], removedAttributes: [] });
  });
});

describe('collectPrintStyles', () => {
  it('inlines the rules of a readable same-origin stylesheet', () => {
    const fakeDocument = {
      styleSheets: [{ cssRules: [{ cssText: '.a { color: red; }' }, { cssText: '.b { color: blue; }' }] }],
    };
    const result = collectPrintStyles(fakeDocument);
    expect(result.cssText).toBe('.a { color: red; }\n.b { color: blue; }');
    expect(result.readableSheets).toBe(1);
    expect(result.unreadableSheets).toBe(0);
    expect(result.hrefs).toEqual([]);
  });

  it('falls back to the href of a stylesheet whose rules throw', () => {
    const fakeDocument = {
      styleSheets: [{
        href: 'https://fonts.example.test/inter.css',
        get cssRules() { throw new Error('SecurityError'); },
      }],
    };
    const result = collectPrintStyles(fakeDocument);
    expect(result.hrefs).toEqual(['https://fonts.example.test/inter.css']);
    expect(result.unreadableSheets).toBe(1);
    expect(result.readableSheets).toBe(0);
  });

  it('reports an empty result when there is nothing to copy', () => {
    const result = collectPrintStyles({ styleSheets: [] });
    expect(result).toEqual({ cssText: '', hrefs: [], readableSheets: 0, unreadableSheets: 0 });
  });

  it('tolerates a document with no styleSheets at all', () => {
    expect(collectPrintStyles(undefined).readableSheets).toBeGreaterThanOrEqual(0);
    expect(collectPrintStyles({}).readableSheets).toBe(0);
  });

  it('forces backgrounds and borders to print', () => {
    expect(PRINT_DOCUMENT_STYLES).toMatch(/print-color-adjust:\s*exact/);
    expect(PRINT_DOCUMENT_STYLES).toMatch(/@page/);
  });
});

describe('waitForPrintDocumentReady', () => {
  const makeResource = () => {
    const listeners = {};
    return {
      node: {
        complete: false,
        addEventListener: (type, fn) => { listeners[type] = fn; },
      },
      fire: (type) => listeners[type]?.(),
      has: (type) => Boolean(listeners[type]),
    };
  };

  it('resolves immediately when there is nothing pending', async () => {
    const printWindow = {
      document: { querySelectorAll: () => [], images: [] },
    };
    await expect(waitForPrintDocumentReady(printWindow)).resolves.toEqual({ timedOut: false });
  });

  it('waits for a pending image and does not time out when it loads', async () => {
    const image = makeResource();
    const printWindow = {
      document: { querySelectorAll: () => [], images: [image.node] },
    };

    let resolved = false;
    const pending = waitForPrintDocumentReady(printWindow, { timeoutMs: 5000 })
      .then((r) => { resolved = true; return r; });

    await Promise.resolve();
    expect(resolved).toBe(false);

    image.fire('load');
    await expect(pending).resolves.toEqual({ timedOut: false });
  });

  it('treats a failed image as settled rather than hanging', async () => {
    const image = makeResource();
    const printWindow = { document: { querySelectorAll: () => [], images: [image.node] } };
    const pending = waitForPrintDocumentReady(printWindow, { timeoutMs: 5000 });
    image.fire('error');
    await expect(pending).resolves.toEqual({ timedOut: false });
  });

  it('waits for a linked stylesheet that has not produced a sheet yet', async () => {
    const link = makeResource();
    const printWindow = {
      document: { querySelectorAll: () => [link.node], images: [] },
    };
    const pending = waitForPrintDocumentReady(printWindow, { timeoutMs: 5000 });
    expect(link.has('load')).toBe(true);
    link.fire('load');
    await expect(pending).resolves.toEqual({ timedOut: false });
  });

  it('ignores a stylesheet that has already loaded', async () => {
    const printWindow = {
      document: { querySelectorAll: () => [{ sheet: {} }], images: [] },
    };
    await expect(waitForPrintDocumentReady(printWindow)).resolves.toEqual({ timedOut: false });
  });

  it('falls back to the timeout backstop when a resource never settles', async () => {
    const image = makeResource();
    const printWindow = { document: { querySelectorAll: () => [], images: [image.node] } };
    await expect(waitForPrintDocumentReady(printWindow, { timeoutMs: 10 }))
      .resolves.toEqual({ timedOut: true });
  });

  it('tolerates a window with no document', async () => {
    await expect(waitForPrintDocumentReady(null)).resolves.toEqual({ timedOut: false });
    await expect(waitForPrintDocumentReady({})).resolves.toEqual({ timedOut: false });
  });
});
