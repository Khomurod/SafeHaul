# `SaveBar` and `useUnsavedChanges`

A page that saves when a button is pressed (not a `Switch` that saves at once)
shows one bar while it has changes that are not saved: what changed, Discard,
Save. The catalog's `Patterns/Save bar` stories are the example to copy.

```jsx
const dirty = !isEqual(form, saved);
useUnsavedChanges(dirty);

{dirty && (
  <SaveBar
    summary="1 change · Port"
    saving={saving}
    error={saveError}
    onSave={save}
    onDiscard={() => setForm(saved)}
  />
)}
```

## `SaveBar`

| Prop | Shape | Notes |
|---|---|---|
| `summary` | non-empty string | What changed, in a few words ("2 changes · Owner, Region"). One line; a longer one is cut short with an ellipsis and kept whole in its `title` |
| `onSave`, `onDiscard` | functions | Discard puts the page back to what is saved; it is not destructive, so it asks nothing |
| `saving` | boolean | Save shows its spinner; Discard waits |
| `saveLabel`, `discardLabel` | strings | `Save` and `Discard` unless the page has its own words |
| `error` | node | A failed save, as an alert under the buttons; the bar stays |

- **Rendering it means there are unsaved changes,** as rendering a `Modal` means
  the dialog is open. Do not render it disabled or empty on a clean page.
- **One per page,** after the content it saves, inside the scrolling page. It
  sticks to the bottom of the view, on the page-content layer (`--ds-z-raised`):
  over the content, under the application chrome and dialogs.
- **One row at every width.** On a phone the summary gets the room Discard and
  Save leave it.
- Missing `summary`, `onSave` or `onDiscard` is refused (`contractViolation`).

## `useUnsavedChanges(dirty)`

Called by whatever holds an edit. While `dirty`:

- closing or reloading the tab asks the browser's own "Leave site?" question
  (`beforeunload`);
- an `UnsavedChangesProvider` above it hears that the page is dirty. Several
  parts of a page may each report; the page is dirty while any of them is.

It works without a provider (only the browser question then).

## `useUnsavedChangesGuard()` and `UnsavedChangesProvider`

For a shell that moves between sections of one page. Put the provider around
the shell, and route every move the shell makes through the guard:

```jsx
const guard = useUnsavedChangesGuard();
const select = (id) => guard.request(() => setSection(id));

<ConfirmDialog
  isOpen={guard.pending}
  tone="warning"
  title="Leave without saving?"
  description="This page has changes that have not been saved. Leaving now discards them."
  confirmLabel="Discard changes"
  cancelLabel="Keep editing"
  onConfirm={guard.confirm}
  onCancel={guard.cancel}
/>
```

`request(action, { onCancel })` runs the move at once when nothing is dirty;
otherwise it holds it (`pending`) until `confirm()` runs it or `cancel()` drops
it, calling `onCancel` for a move already under way (the browser's Back). After
`confirm()` the browser's question stays quiet until the page is clean again, so
a move that reloads the page (log out) asks once. The guard needs the provider (`contractViolation` without one). One provider and one
dialog serve a whole application area, so its menu asks too.

## What it does not do

- **It does not block the router.** The application's router has no blocking
  API, so only moves made through `request` ask (a typed address does not);
  reload and close are covered by `beforeunload`.
- **It guards a move made after the edit, not in the same handler.** An edit
  and a section switch are separate clicks or keystrokes; a handler that both
  changes a value and moves away is not asked about.
- **It does not decide what changed or how to save.** The page owns the
  summary, the saved state and the save.
