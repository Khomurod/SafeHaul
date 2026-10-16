/**
 * The design-system exceptions: a file, a check it may break, and why.
 *
 * Read by every rule in `./index.mjs` (each takes the checks it owns) and
 * passed in by `eslint.config.js`. Each reason is the one roadmap §5 records
 * for the call site; the design system's own `DataTable`, `FileInput` and
 * `TabList`, where the rules send feature code, and two test doubles are the
 * others.
 *
 * An exception covers its check in the whole file — there are no counts — so
 * one is added only by hand, with its reason, and judged in review. ESLint
 * refuses to run with an exception that names no real check or carries a
 * reason shorter than 20 characters, and `scripts/test-lint-rules.mjs` §O
 * refuses one the file no longer needs: a retired exception must not linger as
 * cover for a new violation.
 *
 * A `raw-table` exception approves the file's native tables AND arms the
 * `ds-native-table` check on each of them (`./native-table.mjs`); it is not a
 * licence to style a table by hand.
 */

const NATIVE_TABLE = 'roadmap §5 — approved native-table pattern for an editable matrix or per-row '
    + 'interactive rows. DataTable is a display-table contract. The table must still use the --ds-table-* '
    + 'roles.';

const VOE_DOCUMENT = 'roadmap §5 — the generated 49 CFR §391.23 document is immutable legal content, not '
    + 'themeable app chrome. The reason recorded here until 2026-09-04 was that the export paths have no '
    + '--ds-* properties so a token would resolve to nothing; that is FALSE on both paths and was '
    + 'corrected rather than left standing. html2canvas rasterises from COMPUTED style, which resolves '
    + 'var() before the rasteriser sees it; and handlePrint inlines the application\'s own stylesheets via '
    + 'collectPrintStyles (rebuilt 2026-07-27), which copies every readable sheet including '
    + 'tokens/foundation.css and semantic.css. The surviving ground is stronger: a --ds-* role is '
    + 'themeable BY DESIGN, and this artefact must render the same next year as today — a palette change '
    + 'must not reach a signed regulatory document that has already been exported. Its class list is the '
    + 'capture surface, so any edit changes every exported PDF and every printed page. Tokenising it needs '
    + 'a re-proof of export parity — a real captured PDF and a real printed page — not a passing unit '
    + 'test. VOEPreviewModal.export.test.jsx enforces the boundary in both directions.';

export const DS_EXCEPTIONS = {
    'src/design-system/components/data-table/DataTable.jsx': {
        'raw-table': 'DataTable is the approved display-table contract. The rule exists to send feature '
            + 'code here; this is here.',
    },
    'src/design-system/components/file-input/FileInput.jsx': {
        'raw-file-input': 'FileInput IS the approved picker contract, and its whole point is that the real '
            + '`<input type="file">` is here rather than hand-built at a call site. Same shape of entry as '
            + 'DataTable\'s raw-table: the rule exists to send feature code here, and this is here.',
    },
    'src/design-system/components/tabs/Tabs.jsx': {
        'hand-rolled-tablist': 'TabList IS the approved tab contract, so the one `role="tablist"` in the '
            + 'product that is not hand-rolled lives here. Same shape of entry as DataTable\'s raw-table: '
            + 'the rule exists to send feature code here.',
    },
    'src/features/auth/components/LoginScreen.jsx': {
        'raw-hex-colour': 'roadmap §5 — the hero\'s background wash is brand artwork: three decorative '
            + 'blobs blurred over 256–384px, aria-hidden, carrying no information, two drawn in the mark\'s '
            + 'own colours and one in white (`bg-[#fff]/5`). The named brand roles '
            + '(--ds-color-brand-accent / -primary) cover everything on that panel that carries meaning; '
            + 'these three are translucent, and a Tailwind opacity modifier cannot be applied to a var() '
            + 'colour, so tokenising them would mean three single-use tint tokens for a blur.',
    },
    'src/features/campaigns/components/AudienceBuilder.jsx': {
        'raw-hex-colour': 'roadmap §5 — `bg-[#000]/20`, the scrim behind the audience preview list. '
            + 'Recorded rather than migrated because NO existing role matches it, measured: '
            + '`--ds-color-overlay` is rgb(15 23 42 / 0.6) — slate-900 at 60% — where this is pure black '
            + 'at 20%, so the swap would visibly lighten and re-tint the backdrop. The rule\'s remedy '
            + 'points at declaring a semantic `rgb(… / a)` token, and that is the right fix; naming a new '
            + 'scrim ROLE is a design-system decision rather than a mechanical one, so it waits on the '
            + 'scrim-role decision recorded in roadmap §6. Retire this entry with it.',
    },
    'src/features/campaigns/components/CampaignCard.jsx': {
        'hand-styled-button': 'roadmap §5 — two `role="menuitem"` entries in the card\'s overflow menu, '
            + 'plus one stat affordance inside the card body. `Button` renders `role="button"`, which '
            + 'would break the menu contract exactly as it would break the FMCSA combobox\'s '
            + '`role="option"`; the stat affordance has no button chrome at all (no padding, no '
            + 'background, no border) and is a text-and-icon cell trigger. All three are tokenised and '
            + 'carry the shared focus ring.',
    },
    'src/features/campaigns/components/CampaignResultsTable.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/features/campaigns/components/DetailedReportModal.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/features/campaigns/components/DeviceMockup.jsx': {
        'raw-hex-colour': 'roadmap §5 — DeviceMockup is artwork, not interface. The bezel, side buttons '
            + 'and battery pips are moulded plastic, not a SafeHaul surface; mapping them onto '
            + '--ds-color-surface-inverse-subtle would look identical today and would mean re-tuning the '
            + 'console surface silently restyles a picture of a phone. Declared once, as literal hex '
            + 'values, in the DEVICE constant at the top of the file. The screen itself takes '
            + '--ds-color-surface.',
        'sub-12px-type': 'roadmap §5 — the phone status-bar time is a decorative illustration of a real '
            + 'device, not interface text.',
    },
    'src/features/company-admin/components/modals/VOEDocument.jsx': {
        'sub-12px-type': VOE_DOCUMENT,
        'arbitrary-type-size': VOE_DOCUMENT,
    },
    'src/features/company-admin/components/tabs/PEVTab.jsx': {
        'raw-file-input': 'roadmap §5 — a PROGRAMMATIC picker: one hidden input opened by whichever '
            + 'per-employer "Upload Result" row action was activated. `FileInput` is a visible control by '
            + 'contract (a real input behind a real label), and there is no visible picker here to be — '
            + 'the affordance is a table row action. It carries an accessible name and the `hidden` '
            + 'attribute as well as the class, so it leaves the accessibility tree without depending on '
            + 'CSS.',
    },
    'src/features/driver-app/components/application/IntakeChooser.jsx': {
        'raw-file-input': 'roadmap §5 — a PROGRAMMATIC picker. The visible affordance is one of two '
            + 'mutually exclusive intake choice cards ("Scan my CDL" beside "Fill Out Manually"), so it '
            + 'has to look like its sibling card rather than like a picker; `FileInput` is a visible '
            + 'control by contract. The input is `aria-hidden` and out of the tab order because the card '
            + 'is the control, and the card is a keyboard-reachable approved `Button`.',
    },
    'src/features/driver-app/components/application/steps/components/EmployerNameAutocomplete.jsx': {
        'hand-styled-button': 'roadmap §5 — an ARIA combobox option must carry role="option" inside the '
            + 'listbox, and `Button` renders role="button", which would break the combobox contract. No '
            + 'Combobox/Listbox primitive exists yet.',
    },
    'src/features/settings/components/IntegrationsTab.jsx': {
        'raw-hex-colour': 'roadmap §5 — #1877F2 is Facebook\'s brand blue on the Facebook connection tile. '
            + 'A third-party mark is not a SafeHaul role and must not be re-tuned by a change to this '
            + 'product\'s palette, so it stays literal, the same way the SafeHaul mark\'s own colours are '
            + 'pinned rather than derived.',
    },
    'src/features/settings/components/number-assignment/AssignmentTable.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/features/signing/EnvelopeCreator.aiAssistant.support.jsx': {
        'hand-rolled-current': 'A TEST DOUBLE. `EnvelopeCreator.aiAssistant.support.jsx` stands in for the '
            + 'envelope creator\'s AI assistant surface in component tests, and its page rail is a '
            + 'deliberately minimal copy of the real one — the point of a double is that it is NOT the '
            + 'production component, so pulling `SelectableCard` into it would couple the test to the '
            + 'thing under test. Recorded rather than migrated, and recorded rather than left unlisted, so '
            + 'the count can only fall if the double is ever deleted.',
    },
    'src/features/signing/EnvelopeCreator.editor.support.jsx': {
        'raw-file-input': 'a prop-recording sidebar double inside the vitest harness for the editor-shell '
            + 'suites — it stands in for the real sidebar\'s upload control so the suites can drive the '
            + 'same handleFileChange the shell hands down. It renders only under vitest, never in the '
            + 'product. Moved verbatim from EnvelopeCreator.editor.test.jsx (source-size split), which the '
            + 'scanner excluded as a test file; the support module is scanned, so the double is recorded '
            + 'here instead.',
        'hand-rolled-current': 'A TEST DOUBLE. `EnvelopeCreator.editor.support.jsx` stands in for the '
            + 'envelope creator\'s editor surface in component tests, and its page rail is a deliberately '
            + 'minimal copy of the real one — the point of a double is that it is NOT the production '
            + 'component, so pulling `SelectableCard` into it would couple the test to the thing under '
            + 'test. Recorded rather than migrated, and recorded rather than left unlisted, so the count '
            + 'can only fall if the double is ever deleted.',
    },
    'src/features/signing/components/SignatureSheet.jsx': {
        'raw-hex-colour': 'roadmap §5 — signature ink, rasterised into a legal record. The canvas this '
            + 'colour strokes is converted to a PNG (adopted by the signing room and stamped into a sealed '
            + 'PDF) and stored as part of a signed document, so it must not follow a theme: re-theming the '
            + 'application can never be allowed to retint a signature somebody has already given. Same '
            + 'argument as SignatureSheet.jsx, which has documented it in its own source since it was '
            + 'written. Found on 2026-09-05 when raw-hex-colour was widened to JS assignments — it had '
            + 'been invisible because the rule matched only arbitrary-value classes and CSS-style '
            + 'declarations.',
    },
    'src/features/signing/components/envelope-creator/EditorMobileBar.jsx': {
        'hand-styled-button': 'roadmap §5 — a mobile bottom app bar. Its items are equal-width stacked '
            + 'icon-over-label targets at 56px, which is the platform convention for a bottom bar and '
            + 'deliberately taller than the 44px control step; `Button` is an inline 44px control and '
            + 'cannot be either. No primitive covers a bottom app bar and one consumer does not justify '
            + 'writing one. Tokenised, each item named "Open <section>" so it does not collide with the '
            + 'heading inside the sheet it opens.',
    },
    'src/features/signing/components/envelope-creator/ResizableDraggableField.jsx': {
        'hand-styled-field': 'roadmap §5 — the inline field-label editor sits inside the draggable field '
            + 'rectangle, whose minimum size is 8px. The approved `Input`\'s control height would overflow '
            + 'the box it is labelling. Same exception family as `SignerField`\'s controls (roadmap §5, '
            + 'PDF-geometry controls).',
    },
    'src/features/signing/components/signing-room/SignerField.jsx': {
        'hand-styled-button': 'roadmap §5 — the signature affordance overlays an author-placed PDF field '
            + 'box, whose size comes from the document\'s coordinates and can be as small as 8px. Every '
            + 'approved control carries the shared 36/44/52px control height and inline padding, which '
            + 'would break alignment with the PDF underneath. Same constraint already recorded for this '
            + 'file\'s inputs.',
        'hand-styled-field': 'roadmap §5 — these inputs overlay author-placed PDF field boxes, whose '
            + 'geometry comes from the document\'s own coordinates and can be as small as 8px. The approved '
            + 'controls carry the shared 36/44/52px control height and inline padding, which would break '
            + 'alignment with the PDF. Same constraint already recorded for the signature button in this '
            + 'file.',
    },
    'src/features/super-admin/components/CompaniesView.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/features/super-admin/components/FeaturesView.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/features/super-admin/components/StatsBackfillPanel.jsx': {
        'raw-table': 'roadmap §5 — an operator console with six per-row actions and live progress. Uses '
            + 'the --ds-table-* roles. Per-row interactive rows are the case §5 approves a native table '
            + 'for.',
    },
    'src/features/super-admin/components/UsersView.jsx': {
        'raw-table': 'roadmap §5 — a native table inside a virtualised scroll region. Uses the '
            + '--ds-table-* roles. DataTable owns its own scroll container, so adopting it here would mean '
            + 'nesting two, which is the defect that produces a dead scrollbar gutter.',
    },
    'src/features/super-admin/components/integrations/LineManager.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/features/super-admin/components/modals/ViewCompanyAppsModal.jsx': {
        'raw-table': 'roadmap §5 — a native table with a per-row filter control and a per-row action, '
            + 'inside a dialog. Uses the --ds-table-* roles. Converting it to DataTable is out of scope: '
            + 'DataTable is proven only for display tables, and a per-row filter control is the per-row '
            + 'interaction §5 approves a native table for.',
    },
    'src/features/super-admin/views/AnalyticsView.jsx': {
        'raw-table': 'roadmap §5 — three <table> elements: two visible native tables with per-row actions, '
            + 'which apply ds-native-table and so read the --ds-table-* header, divider and density roles, '
            + 'plus one sr-only table that is the text equivalent of the chart above it. DataTable is a '
            + 'display-table contract and does not cover per-row actions in two linked tables sharing one '
            + 'scroll region. All three carry ds-native-table, the hidden one included: the guard has no '
            + 'hidden-table exemption, because deciding whether a class list is hidden at every breakpoint '
            + 'is not decidable (sr-only xl:not-sr-only is hidden on a phone and visible on a desktop, and '
            + 'that pattern is already in this repo). Measured first — sr-only keeps position:absolute and '
            + 'clip:rect(0,0,0,0), so the contract changes the box and nothing visible.',
    },
    'src/lib/signature.js': {
        'raw-hex-colour': 'roadmap §5 — signature ink, rasterised into a legal record. The canvas this '
            + 'colour strokes is converted to a PNG (read back by getSignatureDataUrl() and submitted with '
            + 'the driver\'s application from Step9_Consent) and stored as part of a signed document, so it '
            + 'must not follow a theme: re-theming the application can never be allowed to retint a '
            + 'signature somebody has already given. Same argument as SignatureSheet.jsx, which has '
            + 'documented it in its own source since it was written. Found on 2026-09-05 when '
            + 'raw-hex-colour was widened to JS assignments — it had been invisible because the rule '
            + 'matched only arbitrary-value classes and CSS-style declarations. Two sites: the initial '
            + 'stroke style and the one clearCanvas restores, which must agree or a cleared pad would sign '
            + 'in a different colour.',
    },
    'src/shared/components/signature/SignaturePad.jsx': {
        'raw-hex-colour': 'roadmap §5 — signature ink, rasterised into a legal record. The canvas this '
            + 'colour strokes is converted to a PNG (handed to the parent as a data URL by '
            + 'onSignatureChange) and stored as part of a signed document, so it must not follow a theme: '
            + 're-theming the application can never be allowed to retint a signature somebody has already '
            + 'given. Same argument as SignatureSheet.jsx, which has documented it in its own source since '
            + 'it was written. Found on 2026-09-05 when raw-hex-colour was widened to JS assignments — it '
            + 'had been invisible because the rule matched only arbitrary-value classes and CSS-style '
            + 'declarations.',
    },
    'src/shared/components/table/ModernDriverTable.jsx': {
        'raw-table': NATIVE_TABLE,
    },
    'src/shared/utils/printDocument.js': {
        'raw-hex-colour': 'roadmap §5 — `background: #ffffff` on html/body in PRINT_DOCUMENT_STYLES. Paper '
            + 'is white; that is a physical fact about the medium, not a surface role that a palette '
            + 'change may re-tune. The reason recorded here until 2026-09-04 said the print window has no '
            + '--ds-* properties — false, since collectPrintStyles inlines the application\'s own '
            + 'stylesheets, tokens included. The real ground is that these rules are injected as a STRING '
            + 'and are the safety net for the case collectPrintStyles reports: a sheet it could not read. '
            + 'A net that depends on the thing it is catching for is not a net.',
    },
};
