import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * `tokens/typeface.css` serves Inter as three parts per style, and a browser
 * picks a part by its `unicode-range` alone: it never looks inside the file
 * first. So the ranges are a claim about the files, and these tests hold the
 * claim to them. A range wider than its file makes a page download a part that
 * cannot draw the character; a narrower one draws a character Inter has in
 * another typeface; a part cut from an older Inter shows up as a lost or extra
 * character. `fonts/README.md` says how the parts are cut, and why each also
 * carries the reference letters below.
 */

const designSystemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = path.join(designSystemRoot, 'fonts');
const typefaceCss = fs.readFileSync(path.join(designSystemRoot, 'tokens/typeface.css'), 'utf8');

/** The characters a WOFF2 file draws, each with its glyph, from the file's `cmap` table. */
function woff2Glyphs(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${file} is not WOFF2`);
  const tableCount = bytes.readUInt16BE(12);
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = bytes[offset];
      offset += 1;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };
  // Tables follow one another, unpadded, in one Brotli stream; cmap is never transformed.
  let cmapStart = null;
  let streamOffset = 0;
  for (let i = 0; i < tableCount; i += 1) {
    const flags = bytes[offset];
    offset += 1;
    const tagIndex = flags & 0x3f;
    if (tagIndex === 0x3f) offset += 4;
    const length = base128();
    const version = flags >> 6;
    const transformed = tagIndex === 10 || tagIndex === 11 ? version === 0 : version !== 0;
    const stored = transformed ? base128() : length;
    if (tagIndex === 0) cmapStart = streamOffset;
    streamOffset += stored;
  }
  const tables = zlib.brotliDecompressSync(bytes.subarray(offset, offset + bytes.readUInt32BE(20)));
  const cmap = tables.subarray(cmapStart);
  const subtables = Array.from({ length: cmap.readUInt16BE(2) }, (_, i) => ({
    platform: cmap.readUInt16BE(4 + i * 8),
    encoding: cmap.readUInt16BE(6 + i * 8),
    at: cmap.readUInt32BE(8 + i * 8),
  }));
  const pick = (platform, encoding) => subtables.find((s) => s.platform === platform && s.encoding === encoding);
  const glyphs = new Map();
  const full = pick(3, 10) || pick(0, 4);
  if (full) {
    const table = cmap.subarray(full.at);
    for (let g = 0; g < table.readUInt32BE(12); g += 1) {
      const [start, end, glyph] = [0, 4, 8].map((k) => table.readUInt32BE(16 + g * 12 + k));
      for (let code = start; code <= end; code += 1) if (glyph + code - start) glyphs.set(code, glyph + code - start);
    }
    return glyphs;
  }
  const basic = pick(3, 1) || pick(0, 3);
  const table = cmap.subarray(basic.at);
  const segX2 = table.readUInt16BE(6);
  for (let s = 0; s < segX2; s += 2) {
    const end = table.readUInt16BE(14 + s);
    const start = table.readUInt16BE(16 + segX2 + s);
    const delta = table.readUInt16BE(16 + 2 * segX2 + s);
    const rangeAt = 16 + 3 * segX2 + s;
    const rangeOffset = table.readUInt16BE(rangeAt);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph = rangeOffset === 0 ? code : table.readUInt16BE(rangeAt + rangeOffset + 2 * (code - start));
      if (rangeOffset !== 0 && glyph === 0) continue;
      glyph = (glyph + delta) & 0xffff;
      if (glyph) glyphs.set(code, glyph);
    }
  }
  return glyphs;
}

const woff2Characters = (file) => new Set(woff2Glyphs(file).keys());

/** `U+0041-005A, U+00E9` → the merged runs [[0x41, 0x5a], [0xe9, 0xe9]]. */
function rangeRuns(list) {
  const runs = list.split(',').map((item) => {
    const match = item.trim().match(/^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i);
    if (!match) throw new Error(`unexpected unicode-range item "${item.trim()}"`);
    return [parseInt(match[1], 16), parseInt(match[2] || match[1], 16)];
  }).sort((a, b) => a[0] - b[0]);
  return runs.reduce((merged, run) => {
    const last = merged[merged.length - 1];
    if (last && run[0] <= last[1] + 1) last[1] = Math.max(last[1], run[1]);
    else merged.push([...run]);
    return merged;
  }, []);
}

function characterRuns(characters) {
  return [...characters].sort((a, b) => a - b).reduce((runs, code) => {
    const last = runs[runs.length - 1];
    if (last && code === last[1] + 1) last[1] = code;
    else runs.push([code, code]);
    return runs;
  }, []);
}

const faces = [...typefaceCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*{([^}]*)}/g)]
  .map(([, body]) => ({
    style: body.match(/font-style:\s*(\w+)/)[1],
    file: body.match(/url\('\.\.\/fonts\/([^']+)'\)/)[1],
    declared: new Set(rangeRuns(body.match(/unicode-range:([^;]+);/)[1])
      .flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, i) => first + i))),
  }));

const fullFonts = { normal: 'InterVariable.woff2', italic: 'InterVariable-Italic.woff2' };
const fullCharacters = (style) => woff2Characters(path.join(fontDir, fullFonts[style]));

/** The letters every part carries besides its range; `fonts/README.md` says why. */
const reference = rangeRuns('U+0041-005A, U+0061-007A, U+00B2-00B3, U+00B9, U+02B0, U+02B2-02B3, '
  + 'U+02B8, U+02E2-02E3, U+1D31, U+1D34, U+1D38, U+1D3C, U+1D40-1D41, U+1D47-1D49, U+1D4D, '
  + 'U+1D4F, U+1D52, U+1D56, U+1D9C, U+1DA0, U+1DBB, U+2070-2071, U+2075, U+2077');
const isReference = (code) => reference.some(([first, last]) => code >= first && code <= last);

describe('the typeface parts', () => {
  it('serves three parts for each style, and every part is in the repository', () => {
    expect(faces.map(({ style, file }) => `${style} ${file}`)).toEqual([
      'normal InterVariable-latin.woff2',
      'normal InterVariable-latin-ext.woff2',
      'normal InterVariable-other.woff2',
      'italic InterVariable-Italic-latin.woff2',
      'italic InterVariable-Italic-latin-ext.woff2',
      'italic InterVariable-Italic-other.woff2',
    ]);
    for (const { file } of faces) expect(fs.existsSync(path.join(fontDir, file)), file).toBe(true);
  });

  it.each(faces)('$file holds the characters its range names, plus the reference letters', ({ style, file, declared }) => {
    const expected = new Set(declared);
    for (const code of fullCharacters(style)) if (isReference(code)) expected.add(code);
    expect(characterRuns(woff2Characters(path.join(fontDir, file)))).toEqual(characterRuns(expected));
  });

  it.each(Object.keys(fullFonts))('the %s ranges name every character of the full font, each once', (style) => {
    const ranges = faces.filter((face) => face.style === style).map(({ declared }) => declared);
    const union = new Set(ranges.flatMap((declared) => [...declared]));
    expect(ranges.reduce((sum, declared) => sum + declared.size, 0)).toBe(union.size);
    expect(characterRuns(union)).toEqual(characterRuns(fullCharacters(style)));
  });

  it.each(Object.keys(fullFonts))('keeps a %s glyph that serves two characters in one part', (style) => {
    const partOf = new Map(faces.filter((face) => face.style === style)
      .flatMap(({ file, declared }) => [...declared].map((code) => [code, file])));
    const byGlyph = new Map();
    for (const [code, glyph] of woff2Glyphs(path.join(fontDir, fullFonts[style]))) {
      byGlyph.set(glyph, [...(byGlyph.get(glyph) || []), code]);
    }
    const split = [...byGlyph.values()].filter((codes) => new Set(codes.map((code) => partOf.get(code))).size > 1);
    expect(split.map((codes) => codes.map((code) => code.toString(16)))).toEqual([]);
  });

  it('draws the text the screens write from the latin part alone', () => {
    const latin = faces.find(({ file }) => file === 'InterVariable-latin.woff2').declared;
    const everyday = [];
    for (let code = 0x20; code <= 0xff; code += 1) if (code < 0x7f || code >= 0xa0) everyday.push(code);
    everyday.push(...[...'‘’“”–—•…→↳⌘⚠✓'].map((ch) => ch.codePointAt(0)));
    // U+00AD, the soft hyphen, is the one Latin-1 character Inter does not draw.
    expect(everyday.filter((code) => !latin.has(code)).map((code) => code.toString(16))).toEqual(['ad']);
  });
});
