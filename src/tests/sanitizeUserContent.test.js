import { describe, expect, it } from 'vitest';
import { sanitizeQuestionPayload, sanitizeUserContent } from '@shared/utils/sanitizeUserContent';

describe('sanitizeUserContent', () => {
  it('strips script tags and event handler payloads', () => {
    const payload = `<script>alert('hacked')</script><img src="x" onload="alert(1)" /><b>hello</b>`;
    const sanitized = sanitizeUserContent(payload);

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onload=');
    expect(sanitized).toContain('<b>hello</b>');
  });

  it('sanitizes custom question fields recursively', () => {
    const dirty = {
      label: `Name <iframe src="https://evil"></iframe>`,
      helpText: `<img src="x" onerror="alert(1)" />Help`,
      options: [`<script>alert(1)</script>A`, `B`],
      fmcsaReference: `49 CFR <script>pwn()</script>`,
    };
    const clean = sanitizeQuestionPayload(dirty);

    expect(clean.label).not.toContain('iframe');
    expect(clean.helpText).not.toContain('onerror=');
    expect(clean.options[0]).not.toContain('<script');
    expect(clean.fmcsaReference).not.toContain('<script');
  });
});

