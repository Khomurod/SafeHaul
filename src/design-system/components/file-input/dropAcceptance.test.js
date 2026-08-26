import { describe, expect, it } from 'vitest';
import { matchesAccept, resolveDroppedFiles } from './dropAcceptance';

/**
 * The rules a drop is judged by, tested directly.
 *
 * These ran through a rendered component and a synthetic `DataTransfer` before
 * 2026-08-26, which tested the wiring and left the rules themselves covered only
 * where a component test happened to reach them. `accept` has three syntaxes and
 * the message has more shapes than the component has states.
 */

const file = (name, type = '') => new File(['x'], name, { type });

describe('matchesAccept', () => {
  it('accepts everything when accept is absent, empty or only separators', () => {
    for (const accept of [undefined, null, '', '   ', ',', ' , ']) {
      expect(matchesAccept(file('anything.bin', 'application/octet-stream'), accept)).toBe(true);
    }
  });

  it('matches an extension pattern', () => {
    expect(matchesAccept(file('contract.pdf', 'application/pdf'), '.pdf')).toBe(true);
    expect(matchesAccept(file('contract.doc', 'application/msword'), '.pdf')).toBe(false);
  });

  it('matches an exact MIME type', () => {
    expect(matchesAccept(file('a.pdf', 'application/pdf'), 'application/pdf')).toBe(true);
    expect(matchesAccept(file('a.png', 'image/png'), 'application/pdf')).toBe(false);
  });

  it('matches a wildcard MIME type', () => {
    expect(matchesAccept(file('a.png', 'image/png'), 'image/*')).toBe(true);
    expect(matchesAccept(file('a.pdf', 'application/pdf'), 'image/*')).toBe(false);
  });

  it('is case-insensitive in both directions', () => {
    // A file called LOGO.PNG is a PNG, and a browser reporting IMAGE/PNG is
    // reporting an image. Both halves have been seen in the wild.
    expect(matchesAccept(file('LOGO.PNG', ''), '.png')).toBe(true);
    expect(matchesAccept(file('logo.png', 'IMAGE/PNG'), 'image/*')).toBe(true);
    expect(matchesAccept(file('logo.png', 'image/png'), 'IMAGE/*')).toBe(true);
    expect(matchesAccept(file('a.PDF', ''), '.pdf')).toBe(true);
  });

  it('accepts a file matching any one pattern in the list', () => {
    const accept = '.pdf,image/*,application/msword';
    expect(matchesAccept(file('a.pdf', ''), accept)).toBe(true);
    expect(matchesAccept(file('b.png', 'image/png'), accept)).toBe(true);
    expect(matchesAccept(file('c.doc', 'application/msword'), accept)).toBe(true);
    expect(matchesAccept(file('d.zip', 'application/zip'), accept)).toBe(false);
  });

  it('tolerates whitespace around patterns, which real markup has', () => {
    expect(matchesAccept(file('a.pdf', ''), ' .pdf , image/* ')).toBe(true);
  });

  it('does not treat a type-less file as matching a MIME pattern', () => {
    // Some browsers report an empty `type` for unusual extensions. Empty is not
    // "anything" — it must not satisfy `image/*`.
    expect(matchesAccept(file('mystery.xyz', ''), 'image/*')).toBe(false);
  });
});

describe('resolveDroppedFiles', () => {
  it('passes a single accepted file through with nothing to say', () => {
    const png = file('logo.png', 'image/png');
    expect(resolveDroppedFiles({ files: [png], accept: 'image/*' }))
      .toEqual({ accepted: [png], rejected: [], message: null });
  });

  it('accepts everything when accept is absent', () => {
    const any = file('mystery.bin', '');
    expect(resolveDroppedFiles({ files: [any] }))
      .toEqual({ accepted: [any], rejected: [], message: null });
  });

  it('names the one file it refused', () => {
    const { accepted, message } = resolveDroppedFiles({
      files: [file('resume.pdf', 'application/pdf')],
      accept: 'image/*',
    });
    expect(accepted).toEqual([]);
    expect(message).toBe('resume.pdf was not added. It is not an accepted file type.');
  });

  it('names two or three refused files', () => {
    const { message } = resolveDroppedFiles({
      files: [file('a.pdf', 'application/pdf'), file('b.zip', 'application/zip')],
      accept: 'image/*',
      multiple: true,
    });
    expect(message).toBe('a.pdf and b.zip were not added. They are not accepted file types.');
  });

  it('counts rather than naming once there are more than three', () => {
    // Four filenames read aloud is worse than being told there were four.
    const { message } = resolveDroppedFiles({
      files: ['a', 'b', 'c', 'd'].map((n) => file(`${n}.zip`, 'application/zip')),
      accept: 'image/*',
      multiple: true,
    });
    expect(message).toBe('4 files were not added. They are not accepted file types.');
  });

  it('counts when a file has no usable name', () => {
    const { message } = resolveDroppedFiles({
      files: [file('', 'application/zip'), file('b.zip', 'application/zip')],
      accept: 'image/*',
      multiple: true,
    });
    expect(message).toBe('2 files were not added. They are not accepted file types.');
  });

  describe('a mixed drop', () => {
    const png = file('logo.png', 'image/png');
    const pdf = file('resume.pdf', 'application/pdf');

    it('keeps the accepted file and still reports the refused one', () => {
      const { accepted, message } = resolveDroppedFiles({
        files: [png, pdf],
        accept: 'image/*',
        multiple: true,
      });
      expect(accepted).toEqual([png]);
      expect(message).toBe('resume.pdf was not added. It is not an accepted file type.');
    });

    it('preserves the dropped order of the files it keeps', () => {
      const second = file('banner.png', 'image/png');
      const { accepted } = resolveDroppedFiles({
        files: [png, pdf, second],
        accept: 'image/*',
        multiple: true,
      });
      expect(accepted).toEqual([png, second]);
    });
  });

  describe('a single-file field', () => {
    const first = file('one.png', 'image/png');
    const second = file('two.png', 'image/png');

    it('takes the first accepted file, as the native picker does', () => {
      const { accepted } = resolveDroppedFiles({ files: [first, second], accept: 'image/*' });
      expect(accepted).toEqual([first]);
    });

    it('says so, rather than letting the rest vanish', () => {
      const { message } = resolveDroppedFiles({ files: [first, second], accept: 'image/*' });
      expect(message).toBe('This field takes one file, so only one.png was added.');
    });

    it('skips over a refused file to the first one it can take', () => {
      const pdf = file('resume.pdf', 'application/pdf');
      const { accepted, message } = resolveDroppedFiles({
        files: [pdf, first],
        accept: 'image/*',
      });
      expect(accepted).toEqual([first]);
      expect(message).toBe('resume.pdf was not added. It is not an accepted file type.');
    });

    it('reports both causes when a drop has both', () => {
      const pdf = file('resume.pdf', 'application/pdf');
      const { accepted, message } = resolveDroppedFiles({
        files: [first, second, pdf],
        accept: 'image/*',
      });
      expect(accepted).toEqual([first]);
      expect(message).toBe(
        'resume.pdf was not added. It is not an accepted file type. '
        + 'This field takes one file, so only one.png was added.',
      );
    });

    it('has nothing to say about a single accepted file', () => {
      expect(resolveDroppedFiles({ files: [first], accept: 'image/*' }).message).toBeNull();
    });
  });

  describe('the files it hands back', () => {
    const png = file('logo.png', 'image/png');
    const pdf = file('resume.pdf', 'application/pdf');

    it('carries the ones accept refused', () => {
      const { rejected } = resolveDroppedFiles({
        files: [png, pdf], accept: 'image/*', multiple: true,
      });
      expect(rejected).toEqual([pdf]);
    });

    it('carries a surplus file a single-file field had no room for', () => {
      /*
       * Found in review on 2026-08-26: the message said "only one.png was added"
       * while `rejected` was empty, which tells a caller two contradictory
       * things. `rejected` means what you dropped and did not get, whichever of
       * the two reasons applies.
       */
      const second = file('banner.png', 'image/png');
      const { accepted, rejected } = resolveDroppedFiles({
        files: [png, second], accept: 'image/*',
      });
      expect(accepted).toEqual([png]);
      expect(rejected).toEqual([second]);
    });

    it('carries both kinds together, in the order they were dropped', () => {
      const second = file('banner.png', 'image/png');
      const { rejected } = resolveDroppedFiles({
        files: [png, pdf, second], accept: 'image/*',
      });
      expect(rejected).toEqual([pdf, second]);
    });

    it('accounts for every dropped file exactly once', () => {
      const second = file('banner.png', 'image/png');
      const dropped = [png, pdf, second];
      const { accepted, rejected } = resolveDroppedFiles({ files: dropped, accept: 'image/*' });
      expect([...accepted, ...rejected]).toHaveLength(dropped.length);
      expect(new Set([...accepted, ...rejected]).size).toBe(dropped.length);
    });
  });

  it('reports nothing for an empty drop', () => {
    expect(resolveDroppedFiles({ files: [] }))
      .toEqual({ accepted: [], rejected: [], message: null });
    expect(resolveDroppedFiles({ files: undefined }))
      .toEqual({ accepted: [], rejected: [], message: null });
  });
});
