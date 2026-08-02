/**
 * Save-state vocabulary for the editor top bar.
 *
 * The rule this exists to enforce: **never claim "Saved" before a save has
 * actually succeeded.** `saved` is only reachable from a completed write, and
 * any subsequent edit moves straight back to `unsaved`.
 */

export const SAVE_STATES = Object.freeze({
    /** Nothing has changed since the last save (or since the document loaded). */
    CLEAN: 'clean',
    /** Edits exist that are not on the server. */
    UNSAVED: 'unsaved',
    /** A write is in flight. */
    SAVING: 'saving',
    /** A write completed successfully. */
    SAVED: 'saved',
    /** A write was attempted and failed; the edits are still local. */
    ERROR: 'error',
});

const LABELS = {
    [SAVE_STATES.CLEAN]: '',
    [SAVE_STATES.UNSAVED]: 'Unsaved changes',
    [SAVE_STATES.SAVING]: 'Saving',
    [SAVE_STATES.SAVED]: 'Saved',
    [SAVE_STATES.ERROR]: 'Not saved',
};

const TONES = {
    [SAVE_STATES.CLEAN]: 'neutral',
    [SAVE_STATES.UNSAVED]: 'warning',
    [SAVE_STATES.SAVING]: 'info',
    [SAVE_STATES.SAVED]: 'success',
    [SAVE_STATES.ERROR]: 'danger',
};

export function saveStateLabel(state) {
    return LABELS[state] ?? '';
}

export function saveStateTone(state) {
    return TONES[state] ?? 'neutral';
}

/** True when leaving would lose work, so the editor must confirm first. */
export function hasUnsavedWork(state) {
    return state === SAVE_STATES.UNSAVED || state === SAVE_STATES.ERROR;
}

/**
 * Heading and primary-action wording for each editor mode.
 *
 * The mode arrives fixed from the Documents workspace and cannot change inside
 * the editor, so this is a pure lookup. The action labels are the pre-existing
 * ones — the save/send behaviour behind them is unchanged.
 */
export const EDITOR_MODES = Object.freeze({
    TEMPLATE: 'template',
    REQUEST: 'request',
    EDIT_TEMPLATE: 'editTemplate',
    CORRECT_REQUEST: 'correctRequest',
});

const MODE_PRESENTATION = {
    [EDITOR_MODES.TEMPLATE]: { label: 'Reusable template', action: 'Save Template', heading: 'Create Template' },
    [EDITOR_MODES.REQUEST]: { label: 'One-off send', action: 'Send Document', heading: 'New Envelope' },
    [EDITOR_MODES.EDIT_TEMPLATE]: { label: 'Edit Template', action: 'Save Template Changes', heading: 'Edit Template' },
    [EDITOR_MODES.CORRECT_REQUEST]: { label: 'Correct Document', action: 'Save Correction', heading: 'Correct Document' },
};

/** Resolve the editor mode from the creator's existing flags. */
export function resolveEditorMode({ creatorMode, isEditingTemplate, isEditingRequest }) {
    if (isEditingTemplate) return EDITOR_MODES.EDIT_TEMPLATE;
    if (isEditingRequest) return EDITOR_MODES.CORRECT_REQUEST;
    return creatorMode === 'template' ? EDITOR_MODES.TEMPLATE : EDITOR_MODES.REQUEST;
}

export function modePresentation(mode) {
    return MODE_PRESENTATION[mode] || MODE_PRESENTATION[EDITOR_MODES.REQUEST];
}

/**
 * The inspector's two tabs. Lives with the other editor UI-state constants so
 * the component file exports only its component.
 */
export const INSPECTOR_TABS = { PROPERTIES: 'properties', AI: 'ai' };
