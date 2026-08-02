# QA Script — Document-First Mobile Signing (E-Doc)

Scope: the public signing room at `/sign/:companyId/:requestId?token=…`
(`src/features/signing/SigningRoom.jsx`). Mobile and desktop now share one
document-first view: the real PDF renders with interactive field overlays
anchored to their authored coordinates; there is no extracted mobile form.

## What is already covered by automation

| Vector | Where |
|---|---|
| Overlay anchoring math (percent geometry, zoom commit, midpoint compensation) | `src/features/signing/utils/envelopePdfZoom.test.js` |
| Reading-order navigation / Enter-advance / completeness | `src/features/signing/utils/signerFieldFlow.test.js` |
| Keyboard scroll-adjustment math (visualViewport band) | `src/features/signing/utils/fieldViewport.test.js` |
| Component behavior: zoom re-render, Enter focus chain, signature stamping, render gate on slow pages | `src/features/signing/SigningRoom.test.jsx` |
| E2E: anchors at 320px (iPhone SE) and 884px (Z Fold) widths, corner fields, tap-after-zoom accuracy, orientation persistence, synthesized pinch (chromium), submit | `e2e/edoc-recruiter-send-and-sign.spec.cjs` |

Run them: `npx vitest run src/features/signing/` and
`npx playwright test --project=chromium e2e/edoc-recruiter-send-and-sign.spec.cjs`.

## Manual device matrix

Test on at minimum: a small iPhone (SE/13 mini), a current iPhone (Safari), a
mid-range Android (Chrome), and one tablet or foldable. Use a **real envelope**
(recruiter-sent, multi-page, with fields near page edges), not the e2e mock.

### 1. Coordinate scaling at the edges
1. Author a template with fields at top-left, bottom-right, and straddling a
   page break (last line of page 1, first line of page 2).
2. Open the link on each device, portrait.
3. PASS: every field sits exactly on its intended text/line at fit-width, after
   two zoom-in steps, and after pinching to ~300%. No field drifts, clips
   outside its page, or detaches while panning.

### 2. Pinch & pan stress
1. Pinch to ~300% (zoom label shows the committed percent; capped at 400%).
2. Pan with one finger diagonally; pan while two fingers are still down.
3. Tap a small checkbox while zoomed; tap Sign on a signature field.
4. PASS: pinch is smooth (transient scale during gesture, crisp re-render on
   release); the point under your fingers stays put on release; taps land on
   the exact field with no offset; one-finger pan never zooms; the page never
   zooms the whole UI (header/footer stay fixed).

### 3. Virtual keyboard
1. Zoom to ~150%. Tap a **text field in the bottom quarter** of the screen.
2. PASS: the keyboard opens, the document scrolls so the field sits in the
   upper visible band (never hidden under the keyboard), the page does NOT
   viewport-zoom (iOS `maximum-scale=1` suppresses focus auto-zoom), and the
   field is at least ~22 CSS px tall (auto zoom bump may fire first — that is
   expected and should land centered on the field).
3. Press the keyboard's **Next/Enter** key repeatedly.
4. PASS: focus walks fields in reading order (top-to-bottom, left-to-right,
   page by page); signature/checkbox fields scroll into view with a blue flash
   instead of receiving a text cursor; the last field dismisses the keyboard.

### 4. Orientation shift
1. Fill 2–3 fields, zoom to ~200%, then rotate to landscape; rotate back.
2. PASS: the page re-fits the new width instantly, overlays stay anchored,
   every entered value (text, date, checks, drawn signature) survives, and the
   sticky header/bottom bar reflow without overlap. Repeat with the signature
   sheet open: rotating clears the in-progress stroke (expected — aspect would
   distort it) but never crashes or loses already-adopted ink.

### 5. Network degradation (slow 3G)
1. Chrome DevTools remote-debug the device (or use browser throttling) at
   "Slow 3G". Open a real multi-page envelope.
2. PASS: a "Loading document…" spinner shows; each page shows "Rendering
   page N…" and its fields are **non-interactive (dimmed)** until that page's
   canvas paints; no field can be tapped over a blank page; if the PDF fetch
   fails, the "Couldn't load the document" panel appears and **Try again**
   recovers without losing typed values (they persist in localStorage).
3. Kill the network entirely mid-fill, reload the page when back online.
4. PASS: previously entered values are restored from the device draft.

### 6. Signature specifics
1. Tap Sign → fullscreen sheet → draw → Adopt.
2. PASS: the actual ink appears inside the field box on the document; tapping
   a second signature field stamps the same ink in one tap; tapping an
   already-signed box reopens the sheet to redraw; initials are tracked
   separately from signatures.

### 7. Legal-context sanity (the reason for this redesign)
PASS: at no point does the signer fill a field without the surrounding
document text visible around it. Submit is only reachable from the document
view, and the success screen appears only after `submitPublicEnvelope`
succeeds.

## Known limitations (by design)
- Mid-pinch rendering is a scaled bitmap (slightly soft); it re-renders crisp
  on release.
- Rotating while drawing a signature clears the in-progress stroke.
- WebKit/Firefox e2e runs skip the synthesized-pinch test (chromium-only CDP);
  pinch on those engines is covered by this manual script.
