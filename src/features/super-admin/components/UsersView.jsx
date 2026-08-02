import React, { useState, useMemo, useEffect, useId } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Users, Briefcase, Edit2, Trash2, Search, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, IconButton, Input, Select } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';

/**
 * Super Admin users table.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the
 * name/email search, the client-side 20/50/100 pagination, the
 * `globalRole === 'super_admin'` precedence over memberships, the
 * `mem.role === 'company_admin' ? 'Admin' : 'User'` label rule, the
 * `allCompaniesMap.get(...) || "Unknown"` fallback, the `{ id }` /
 * `{ id, name }` callback shapes and every frozen string are unchanged.
 *
 * `DataTable` is deliberately not used, for the same reason recorded on
 * `CompaniesView`: per-row interactive actions sit outside its proven
 * display-table contract. The approved native-table pattern is used instead.
 *
 * Defects fixed here:
 *  - Icon-only Edit/Delete actions carried only a `title`, so they had no
 *    accessible name and every row announced identically.
 *  - The Super Admin role and membership chips were legacy-palette pills; role
 *    is now a `Badge` whose text carries the meaning, never colour alone.
 *  - The search input had no label.
 *  - Loading and error states were not announced.
 *  - The loading spinner was a bare `Loader2`; it now uses the shared loader
 *    like the sibling companies table.
 *  - Legacy palette throughout, including the `bg-purple-100` avatar.
 */
export function UsersView({
    listLoading,
    statsError,
    userList = [],
    allCompaniesMap,
    onEdit,
    onDelete
}) {
    const [userSearch, setUserSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const searchId = useId();
    const perPageId = useId();

    const filteredUserList = useMemo(() => {
        const searchTerm = userSearch.toLowerCase();
        if (!searchTerm) return userList;

        return userList.filter(user => {
            return (user.name?.toLowerCase().includes(searchTerm) ||
                user.email?.toLowerCase().includes(searchTerm));
        });
    }, [userSearch, userList]);

    const totalPages = Math.ceil(filteredUserList.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredUserList.slice(start, start + itemsPerPage);
    }, [filteredUserList, currentPage, itemsPerPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [userSearch, itemsPerPage]);

    return (
        <Card padding="none" className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 border-b border-ds-border-subtle p-ds-5">
                <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <Users size={20} className="text-ds-content-link" aria-hidden="true" />
                    Manage All Users
                </h2>
            </div>

            <div className="flex shrink-0 flex-col items-center justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface p-ds-4 sm:flex-row">
                <p className="text-ds-sm text-ds-content-muted">
                    Total Users: <strong className="text-ds-content">{userList.length}</strong>
                </p>
                <div className="relative w-full sm:w-72">
                    <label htmlFor={searchId} className="sr-only">Search users by name or email</label>
                    <Input
                        id={searchId}
                        type="search"
                        placeholder="Search users..."
                        className="pl-10"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                    />
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                </div>
            </div>

            {/* Keyboard-focusable, named scroll region: below `sm` the table
                    scrolls horizontally, and in the empty state it holds no
                    focusable children, so keyboard users could not scroll it at
                    all (axe `scrollable-region-focusable`). Same pattern already
                    used by `EnvelopeHistory` and `CampaignResultsTable`. */}
                <div
                    role="region"
                    aria-label="Users table"
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-auto bg-ds-canvas focus-visible:outline-none focus-visible:shadow-ds-focus"
                >
                <table className="w-full border-collapse text-left">
                    <caption className="sr-only">All platform users</caption>
                    <thead className="sticky top-0 z-10 bg-ds-surface-subtle shadow-ds-xs">
                        <tr>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">User</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Role &amp; Access</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-right text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border-subtle bg-ds-surface">
                        {listLoading ? (
                            <tr><td colSpan="3" role="status" className="p-ds-10 text-center text-ds-content-muted"><SafeHaulLoader size="h-10 w-10" className="mx-auto mb-ds-2" />Loading users...</td></tr>
                        ) : statsError.users ? (
                            <tr><td colSpan="3" role="alert" className="p-ds-10 text-center text-ds-status-danger-fg">Error loading users.</td></tr>
                        ) : filteredUserList.length === 0 ? (
                            <tr><td colSpan="3" className="p-ds-10 text-center text-ds-content-muted">No users found.</td></tr>
                        ) : (
                            paginatedData.map(user => {
                                const userName = getFieldValue(user.name);
                                return (
                                    <tr key={user.id} className="transition-colors hover:bg-ds-surface-subtle">
                                        <th scope="row" className="px-ds-6 py-ds-4 text-left align-middle font-normal">
                                            <div className="flex items-center gap-ds-3">
                                                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ds-status-accent-border bg-ds-status-accent-bg text-ds-sm font-bold text-ds-status-accent-fg">
                                                    {userName.charAt(0).toUpperCase()}
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-ds-sm font-bold text-ds-content">{userName}</span>
                                                    <span className="block truncate text-ds-xs text-ds-content-muted">{getFieldValue(user.email)}</span>
                                                </span>
                                            </div>
                                        </th>
                                        <td className="px-ds-6 py-ds-4 align-middle">
                                            <div className="flex flex-wrap gap-ds-2">
                                                {user.globalRole === 'super_admin' ? (
                                                    <Badge tone="danger" icon={ShieldCheck}>Super Admin</Badge>
                                                ) : (user.memberships?.length || 0) > 0 ? (
                                                    user.memberships.map(mem => (
                                                        <Badge key={mem.companyId} tone="info" icon={Briefcase}>
                                                            {mem.role === 'company_admin' ? 'Admin' : 'User'} at {allCompaniesMap.get(mem.companyId) || "Unknown"}
                                                        </Badge>
                                                    ))
                                                ) : (
                                                    <span className="text-ds-xs italic text-ds-content-muted">No active memberships</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-ds-6 py-ds-4 text-right align-middle">
                                            <div className="flex justify-end gap-ds-2">
                                                <IconButton
                                                    label={`Edit ${userName}`}
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onEdit({ id: user.id })}
                                                >
                                                    <Edit2 size={18} aria-hidden="true" />
                                                </IconButton>
                                                <IconButton
                                                    label={`Delete ${userName}`}
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onDelete({ id: user.id, name: user.name })}
                                                >
                                                    <Trash2 size={18} aria-hidden="true" className="text-ds-status-danger-fg" />
                                                </IconButton>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex shrink-0 flex-col items-center justify-between gap-ds-4 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row">
                <div className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                    <label htmlFor={perPageId}>Show</label>
                    <Select
                        id={perPageId}
                        value={itemsPerPage}
                        onChange={(e) => setItemsPerPage(Number(e.target.value))}
                        className="w-auto py-1.5"
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </Select>
                    <span>per page</span>
                </div>

                <div className="flex items-center gap-ds-4">
                    <span className="text-ds-sm text-ds-content-secondary" role="status">
                        Page <strong>{currentPage}</strong> of <strong>{totalPages || 1}</strong>
                    </span>
                    <div className="flex gap-1">
                        <IconButton
                            label="Previous page"
                            variant="secondary"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft size={16} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                            label="Next page"
                            variant="secondary"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                        >
                            <ChevronRight size={16} aria-hidden="true" />
                        </IconButton>
                    </div>
                </div>
            </div>
        </Card>
    );
}
