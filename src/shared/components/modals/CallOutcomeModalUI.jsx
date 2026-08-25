import React, { useId } from 'react';
import {
  Phone, X, Save, MessageSquare, CheckCircle, XCircle,
  Clock, AlertCircle, Ban, ThumbsDown, Briefcase, BellPlus
} from 'lucide-react';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { EXPERIENCE_OPTIONS } from '../../../config/form-options';
import {
  Button, FormField, IconButton, Input, SegmentedControl, Select, Textarea,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@design-system/patterns';
/**
 * Call-outcome logging dialog for the recruiter dialer.
 *
 * Migrated to the design system 2026-07-28; it was a hand-built overlay found by
 * the repository-wide dialog scan.
 *
 * Presentation only — this component is purely controlled: every value and setter
 * comes from `CallOutcomeModal`. Frozen and unchanged: the eight outcome ids and
 * their exact labels and order; the twelve `DRIVER_TYPES` and eight `POSITIONS`
 * and their order; the `EXPERIENCE_OPTIONS` source; the quick-reminder rule
 * (+1 hour, `YYYY-MM-DD` date, `HH:MM` time, `outcome = 'callback'`, and the exact
 * `'Quick reminder set: No Answer (1 hr follow-up)'` note); the callback date
 * `min` of today; the `showDetailInputs` / `showCallbackSelect` visibility rules;
 * the `handleSave` submit path; the `'Schedule & Save'` / `'Save Result'` label
 * rule; the `tel:` link and `formatPhoneNumber` display; and every placeholder and
 * string.
 *
 * Defects fixed:
 *  1. **No focus management.** The overlay declared `role="dialog"` and
 *     `aria-modal` but was a bare div: focus never moved into it, Tab escaped to
 *     the page behind, Escape did nothing, and focus was not restored on close.
 *     `role="dialog"` was also on the *backdrop*, so the whole page was nominally
 *     inside the dialog. It now uses the approved accessible `Modal`.
 *  2. **Six controls had no accessible name.** Position, Experience, Freight
 *     Type, the callback Date and Time, and Recruiter Notes all had `<label>`
 *     elements with no `htmlFor` and controls with no `id`. `FormField` owns the
 *     association now.
 *  3. **`text-[10px]` in five places** — every detail-field label and the network
 *     hint — plus `text-gray-400` on them, which is 2.56:1 on white.
 *  4. **The outcome grid communicated its selection by colour and a focus ring
 *     only** — no `aria-pressed`, no grouping, so a screen-reader user could not
 *     tell which of the eight outcomes was chosen.
 *  5. **Eight locally-invented palette trios** (`border-green-200 bg-green-50
 *     text-green-800` and friends, including a `text-red-400` icon) replaced by the
 *     semantic status tokens. The feature keeps the domain→tone decision.
 *  6. A `<label>` carried both `block` and `flex` display classes, so its icon
 *     alignment depended on class order.
 *
 * The outcome grid is the design system's `SegmentedControl` (2026-08-25). It was
 * a `role="group"` of raw `<button aria-pressed>` cards with a local six-tone
 * class map, recorded as an exception "because the design system has no approved
 * Segmented/ToggleGroup primitive" — one shipped on 2026-08-21 naming this exact
 * call site. The semantics are identical by design: the primitive is
 * deliberately `role="group"` + `aria-pressed` rather than a radiogroup, for the
 * reason its own README gives, so nothing about how this dialog announces changed.
 *
 * The `tel:` chip above it stays local. It is a status-tinted pill that is also a
 * link; `Link` is underlined text and `ButtonLink` is button-shaped, and neither
 * is an inline tinted chip. That gap is recorded in the roadmap.
 */

/**
 * Domain outcome → semantic tone. Feature-owned mapping; token-owned values.
 *
 * `icon` is a component reference rather than a rendered element, because
 * `SegmentedControl` sizes the glyph from the control-icon token — the same rule
 * `Button` applies. A pre-rendered `size={18}` here would be overridden anyway.
 *
 * The local `TONE_CLASS` map that used to sit beside this is gone: the tinted
 * selected treatment for each of the six tones is the primitive's, so this file
 * decides which outcome is a warning and the design system decides what a
 * warning looks like.
 */
const OUTCOMES_CONFIG = [
  { id: 'interested', label: 'Connected / Interested', icon: CheckCircle, tone: 'success' },
  { id: 'callback', label: 'Connected / Scheduled Callback', icon: Clock, tone: 'info' },
  { id: 'not_qualified', label: 'Connected / Not Qualified', icon: Ban, tone: 'warning' },
  { id: 'not_interested', label: 'Connected / Not Interested', icon: ThumbsDown, tone: 'neutral' },
  { id: 'hired_elsewhere', label: 'Connected / Hired Elsewhere', icon: Briefcase, tone: 'accent' },
  { id: 'voicemail', label: 'Left Voicemail', icon: MessageSquare, tone: 'warning' },
  { id: 'no_answer', label: 'No Answer', icon: XCircle, tone: 'danger' },
  { id: 'wrong_number', label: 'Wrong Number', icon: AlertCircle, tone: 'danger' },
];

const DRIVER_TYPES = [
  'Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Box Truck', 'Car Hauler',
  'Step Deck', 'Lowboy', 'Conestoga', 'Intermodal', 'Power Only', 'Hotshot'
];

const POSITIONS = [
  'Company Driver (Solo)', 'Company Driver (Team)',
  'Lease Operator (Solo)', 'Lease Operator (Team)',
  'Owner Operator (Solo)', 'Owner Operator (Team)',
  'Lease to Purchase (Solo)', 'Lease to Purchase (Team)'
];

export function CallOutcomeModalUI({
  lead,
  onClose,
  outcome,
  setOutcome,
  notes,
  setNotes,

  driverType, setDriverType,
  experienceLevel, setExperienceLevel,
  position, setPosition,

  callbackDate, setCallbackDate,
  callbackTime, setCallbackTime,
  saving,
  handleSave,

  showDetailInputs,
  showCallbackSelect,
}) {
  const titleId = useId();
  const callbackDateId = useId();
  const callbackTimeId = useId();
  const positionId = useId();
  const experienceId = useId();
  const freightId = useId();
  const notesId = useId();

  const handleQuickReminder = () => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

    setCallbackDate(dateStr);
    setCallbackTime(timeStr);
    setOutcome('callback');
    setNotes('Quick reminder set: No Answer (1 hr follow-up)');
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      overlayClassName="fixed inset-0 z-[70] flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
      className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div className="flex shrink-0 items-center justify-between gap-ds-2 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
        <h2 id={titleId} className="flex items-center gap-ds-2 font-bold text-ds-content">
          <Phone size={20} className="text-ds-content-link" aria-hidden="true" /> Log Call Result
        </h2>
        <IconButton label="Close call result" variant="ghost" size="sm" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-ds-2 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
        <div className="text-ds-sm">
          <span className="text-ds-content-secondary">Driver: </span>
          <span className="font-bold text-ds-content">{lead.firstName} {lead.lastName}</span>
        </div>

        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            className="flex items-center gap-1 rounded-ds-full bg-ds-status-success-bg px-ds-3 py-1.5 text-ds-xs font-bold text-ds-status-success-fg transition-colors hover:bg-ds-surface focus-visible:outline-none focus-visible:shadow-ds-focus"
          >
            <Phone size={12} fill="currentColor" aria-hidden="true" />
            <span className="sr-only">Call now: </span>
            {formatPhoneNumber(lead.phone)}
          </a>
        )}
      </div>

      <form onSubmit={handleSave} className="overflow-y-auto p-ds-5">
        <Stack gap="lg">

          <SegmentedControl
            ariaLabel="Call outcome"
            columns={2}
            value={outcome}
            onChange={setOutcome}
            options={OUTCOMES_CONFIG.map((opt) => ({
              value: opt.id,
              label: opt.label,
              icon: opt.icon,
              tone: opt.tone,
            }))}
          />

          {outcome === 'no_answer' && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" onClick={handleQuickReminder}>
                <BellPlus size={14} aria-hidden="true" /> Remind me in 1 Hour
              </Button>
            </div>
          )}

          {showCallbackSelect && (
            <div className="rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-3">
              <p className="mb-ds-2 flex items-center gap-1 text-ds-xs font-bold uppercase text-ds-status-info-fg">
                <Clock size={12} aria-hidden="true" /> Schedule Callback
              </p>
              <div className="grid grid-cols-2 gap-ds-3">
                <FormField id={callbackDateId} label="Date">
                  <Input
                    type="date"
                    value={callbackDate}
                    onChange={(e) => setCallbackDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </FormField>
                <FormField id={callbackTimeId} label="Time">
                  <Input
                    type="time"
                    value={callbackTime}
                    onChange={(e) => setCallbackTime(e.target.value)}
                  />
                </FormField>
              </div>
            </div>
          )}

          {showDetailInputs && (
            <div className="border-t border-ds-border-subtle pt-ds-3">
              <Stack gap="sm">
                <h3 className="text-ds-xs font-bold uppercase text-ds-content-secondary">Verify Driver Details</h3>

                <FormField id={positionId} label="Position">
                  <Select value={position} onChange={(e) => setPosition(e.target.value)}>
                    <option value="">-- Select Position --</option>
                    {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </FormField>

                <FormField id={experienceId} label="Experience">
                  <Select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)}>
                    <option value="">-- Select Experience --</option>
                    {EXPERIENCE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </Select>
                </FormField>

                <FormField
                  id={freightId}
                  label="Freight Type"
                  description="Updating these fields helps the network."
                >
                  <Select value={driverType} onChange={(e) => setDriverType(e.target.value)}>
                    <option value="">-- Select Type --</option>
                    {DRIVER_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </Select>
                </FormField>
              </Stack>
            </div>
          )}

          <FormField id={notesId} label="Recruiter Notes">
            <Textarea
              rows="3"
              placeholder="Add specific details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>

        </Stack>
      </form>

      <div className="flex shrink-0 justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          loading={saving}
        >
          {!saving && <Save size={16} aria-hidden="true" />}
          {showCallbackSelect ? 'Schedule & Save' : 'Save Result'}
        </Button>
      </div>
    </Modal>
  );
}
