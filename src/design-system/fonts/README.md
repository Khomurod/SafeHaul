# Inter, the product's typeface

Inter 4.001 (`git-9221beed3`), the variable font by The Inter Project Authors,
licensed under the SIL Open Font License 1.1 (`LICENSE.txt`), which permits
redistributing it and cutting it into parts. Both axes are kept: weight
100–900 and optical size 14–32.

| File | What it is |
|---|---|
| `InterVariable.woff2`, `InterVariable-Italic.woff2` | The full upright and italic fonts: the source the parts are cut from. No page loads them. |
| `InterVariable[-Italic]-latin.woff2` | English text, digits, punctuation, Latin-1 accents and the arrows and symbols the screens use. Every page needs it. |
| `InterVariable[-Italic]-latin-ext.woff2` | The rest of the Latin alphabet: names such as Łukasz or Dvořák. |
| `InterVariable[-Italic]-other.woff2` | Cyrillic, Greek, Vietnamese, combining accents and the remaining symbols. |

`../tokens/typeface.css` declares each part with a `unicode-range`, and a browser
downloads a part only when the page shows a character in its range. The ranges
of one style do not overlap, together they name every character of the full
font, and each names only characters its part can draw, so no part is
downloaded for an emoji. `latin` is Google Fonts' latin range plus the arrows
and symbols the screens use; `latin-ext` the Latin Extended blocks, Latin
modifier letters and currency signs; `other` the rest. A glyph that serves two
characters stays whole in one part: `”` and U+02EE in `latin`, Latin `ɩ` and
Greek `ι` in `other`.

Each part also carries the reference letters below, which its range does not
name, so the browser never draws them from that part. Chrome on Linux, where
the visual tests run, hints text with letter heights it measures from them;
without them the letters of `latin-ext` and `other`, and `ª` and `º`, render a
little softer than from the full font. With them every character renders pixel
for pixel as from the full font, except `⊘`, `ₔ` and Inter's private-use
alternates. `../tests/typeface.test.js` holds the files to the ranges and the
reference letters.

## Cutting the parts again

Cut each part with exactly the `unicode-range` its `@font-face` declares plus the
reference letters, using fonttools 4.67.0 (`pip install fonttools==4.67.0
brotli`). From the repository root:

```sh
css=src/design-system/tokens/typeface.css
fonts=src/design-system/fonts
reference=U+0041-005A,U+0061-007A,U+00B2-00B3,U+00B9,U+02B0,U+02B2-02B3,U+02B8,U+02E2-02E3,U+1D31,U+1D34,U+1D38,U+1D3C,U+1D40-1D41,U+1D47-1D49,U+1D4D,U+1D4F,U+1D52,U+1D56,U+1D9C,U+1DA0,U+1DBB,U+2070-2071,U+2075,U+2077
for style in "" "-Italic"; do
  for part in latin latin-ext other; do
    file="InterVariable$style-$part.woff2"
    ranges=$(awk -v f="$file" 'index($0, f) { grab = 1; next }
      grab && /unicode-range:/ { on = 1; sub(/.*unicode-range:/, "") }
      on { buf = buf $0; if ($0 ~ /;/) { print buf; exit } }' "$css" | tr -d ' ;\n')
    pyftsubset "$fonts/InterVariable$style.woff2" --unicodes="$ranges,$reference" \
      --layout-features='*' --name-IDs='*' --flavor=woff2 --output-file="$fonts/$file"
  done
done
```

Run on the files here, this reproduces the six parts byte for byte. Change a
range in `typeface.css` first, then cut again; a new Inter release replaces the
two full files and is cut the same way.

Text that mixes characters from two parts is drawn from two files, so the
kerning between two neighbouring letters from different parts is not applied: a
line of Polish or Vietnamese comes out up to about a pixel wider or narrower. An
accent typed as a separate combining mark (rare; keyboards send the accented
letter itself) is likewise drawn from another part than its letter. Every font
service that splits by script makes the same trade.
