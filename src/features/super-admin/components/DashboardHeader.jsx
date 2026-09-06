import React, { useId } from 'react';
import { Icon, Building2, Search, X, LogOut, Wrench } from '@design-system/icons';
import { Button, IconButton, Input } from '@/design-system/components';

/**
 * Super Admin masthead: product identity, the global search box, the employer
 * backfill maintenance action, and logout.
 *
 * Migrated to the design system 2026-07-28. Presentation only — `setSearchQuery`
 * still receives the raw input value on every keystroke (the 600 ms debounce and
 * the >= 2 character rule live in `useSuperAdminData`), the clear control still
 * sets `''`, and `onBackfillEmployers` / `onLogout` are called with no arguments
 * exactly as before. The `logout-button-super` id is preserved because existing
 * selectors depend on it.
 *
 * Fixed here:
 *  - The global search `<input>` had **no label at all** — only a placeholder,
 *    which is not an accessible name and disappears on input. It now has a
 *    visually hidden `<label>`.
 *  - The clear-search control was an icon-only raw `<button>` with no accessible
 *    name, so it announced as "button".
 *  - Legacy palette (`bg-blue-600`, `bg-orange-600`, `bg-red-500`, `text-gray-*`)
 *    replaced with design-system Buttons and `--ds-*` tokens.
 *  - The header row could not wrap, so at narrow widths the search box and the
 *    two actions overflowed horizontally; it now wraps and the search box is
 *    allowed to shrink.
 */
export function DashboardHeader({
    searchQuery,
    setSearchQuery,
    onBackfillEmployers,
    backfillTriggerRef,
    backfillingEmployers,
    onLogout
}) {
    const searchId = useId();

    return (
        <header className="sticky top-0 z-ds-sticky border-b border-ds-border-subtle bg-ds-surface shadow-ds-md">
            <div className="container mx-auto flex flex-wrap items-center justify-between gap-ds-4 p-ds-4">

                <div className="flex items-center gap-ds-3">
                    <span
                        aria-hidden="true"
                        className="rounded-ds-md bg-ds-action-primary p-ds-2 text-ds-content-inverse"
                    >
                        <Icon icon={Building2} size="2xl" />
                    </span>
                    <h1 className="text-ds-heading-md font-bold text-ds-content">Super Admin</h1>
                </div>

                <div className="relative min-w-0 flex-1 sm:max-w-xl">
                    <label htmlFor={searchId} className="sr-only">
                        Search companies, users and driver applications
                    </label>
                    <Input
                        id={searchId}
                        type="search"
                        placeholder="Global Search..."
                        className="pl-10 pr-10"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <Icon icon={Search} size="xl"
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                    {searchQuery && (
                        <IconButton
                            label="Clear search"
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1/2 -translate-y-1/2"
                            onClick={() => setSearchQuery('')}
                        >
                            <Icon icon={X} size="xl" />
                        </IconButton>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-ds-2">
                    <Button
                        ref={backfillTriggerRef}
                        variant="secondary"
                        onClick={onBackfillEmployers}
                        loading={backfillingEmployers}
                        title="Backfill employer field names in all existing applications"
                    >
                        {!backfillingEmployers && <Icon icon={Wrench} />}
                        {backfillingEmployers ? "Backfilling..." : "Backfill Employers"}
                    </Button>

                    <Button
                        id="logout-button-super"
                        variant="danger"
                        onClick={onLogout}
                    >
                        <Icon icon={LogOut} size="lg" />
                        <span className="hidden sm:inline">Logout</span>
                        <span className="sr-only sm:hidden">Log out</span>
                    </Button>
                </div>
            </div>
        </header>
    );
}
