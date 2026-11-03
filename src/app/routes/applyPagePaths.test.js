import { describe, expect, it } from 'vitest';
import { APPLY_PAGE_PATHS, isApplyPagePath } from './applyPagePaths';

describe('apply page paths', () => {
  // Read from the route manifest by id: a renamed id drops a path, and this fails.
  it('names the three routes that reach the driver application', () => {
    expect(APPLY_PAGE_PATHS).toHaveLength(3);
  });

  it.each(['/apply/acme', '/apply/acme/', '/interest/acme', '/sandbox/apply'])(
    'matches %s',
    (pathname) => {
      expect(isApplyPagePath(pathname)).toBe(true);
    },
  );

  it.each([
    '/apply',
    '/apply/acme/extra',
    '/login',
    '/company/dashboard',
    '/sign/a/b',
    '/sandbox/transfer-success',
  ])('does not match %s', (pathname) => {
    expect(isApplyPagePath(pathname)).toBe(false);
  });
});
