import React, { useState, useMemo, useEffect, useId } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Icon, Users, Briefcase, Edit2, Trash2, Search, ShieldCheck } from '@design-system/icons';
import { Avatar, Badge, Button, Card, DataTable, IconButton, Input } from '@/design-system/components';

/**
 * Super Admin users table.
 *
 * Presentation only. Frozen contracts: the name/email search, the client-side
 * 20/50/100 pagination, the Super Admin precedence over memberships
 * (`isSuperAdmin`), the `mem.role === 'company_admin' ? 'Admin' : 'User'` label
 * rule, the `allCompaniesMap.get(...) || "Unknown"` fallback, the `{ id }` /
 * `{ id, name }` callback shapes and every frozen string.
 *
 * The list is a `DataTable`; rows per page and Previous / Next are the
 * table's own pager, and "Load More from Database" stays below it.
 *
 * Defects fixed here:
 *  - Icon-only Edit/Delete actions carried only a `title`, so they had no
 *    accessible name and every row announced identically.
 *  - The Super Admin role was a legacy-palette pill; it is now a `Badge` whose
 *    text carries the meaning, never colour alone. Each membership is a line of
 *    text ("Admin at …"), which wraps where a long company name needs it.
 *  - The search input had no label.
 *  - Loading and error states were not announced.
 *  - Legacy palette throughout, including the `bg-ds-status-accent-bg` avatar.
 */
/**
 * Whether the user holds the Super Admin claim. The claims trigger
 * (`onMembershipWrite`) grants it for a membership whose role is `super_admin`,
 * and nothing writes `users/{uid}.globalRole`, so that field alone left such a
 * user unmarked. An older account may still carry the field; it counts too.
 */
const isSuperAdmin = (user) => user.globalRole === 'super_admin'
    || (user.memberships || []).some((membership) => membership.role === 'super_admin');

const PAGE_SIZES = [20, 50, 100];

export function UsersView({
    listLoading,
    statsError,
    userList = [],
    allCompaniesMap,
    onEdit,
    onDelete,
    loadMore,
    isLoadingMore = false,
    hasMore = false,
}) {
    const [userSearch, setUserSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const searchId = useId();

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

    const columns = [
        {
            key: 'user',
            header: 'User',
            rowHeader: true,
            width: 'xl',
            render: (user) => {
                const userName = getFieldValue(user.name);
                return (
                    <div className="flex min-w-0 items-center gap-ds-3">
                        <Avatar size="md" tone="accent">
                            {userName.charAt(0).toUpperCase()}
                        </Avatar>
                        <span className="min-w-0">
                            <span className="block text-ds-sm font-bold text-ds-content [overflow-wrap:anywhere]">{userName}</span>
                            <span className="block text-ds-xs font-normal text-ds-content-muted [overflow-wrap:anywhere]">{getFieldValue(user.email)}</span>
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'access',
            header: 'Role & Access',
            width: 'xl',
            // Super Admin is a status, so a badge; each membership names a
            // company, which can be long, so it is a line that wraps.
            render: (user) => {
                if (isSuperAdmin(user)) return <Badge tone="danger" icon={ShieldCheck}>Super Admin</Badge>;
                if (!(user.memberships?.length > 0)) {
                    return <span className="text-ds-xs italic text-ds-content-muted">No active memberships</span>;
                }
                return (
                    <ul className="flex flex-col gap-ds-1">
                        {user.memberships.map(mem => (
                            <li key={mem.companyId} className="flex items-start gap-ds-2 text-ds-sm text-ds-content">
                                <Icon icon={Briefcase} size="sm" className="mt-0.5 shrink-0 text-ds-content-muted" />
                                <span className="min-w-0 [overflow-wrap:anywhere]">
                                    {mem.role === 'company_admin' ? 'Admin' : 'User'} at {allCompaniesMap.get(mem.companyId) || "Unknown"}
                                </span>
                            </li>
                        ))}
                    </ul>
                );
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            width: 'md',
            render: (user) => {
                const userName = getFieldValue(user.name);
                return (
                    <div className="flex justify-end gap-ds-2">
                        <IconButton
                            label={`Edit ${userName}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit({ id: user.id })}
                        >
                            <Icon icon={Edit2} size="lg" />
                        </IconButton>
                        <IconButton
                            label={`Delete ${userName}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete({ id: user.id, name: user.name })}
                        >
                            <Icon icon={Trash2} size="lg" className="text-ds-status-danger-fg" />
                        </IconButton>
                    </div>
                );
            },
        },
    ];

    return (
        <Card padding="none" className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 border-b border-ds-border-subtle p-ds-5">
                <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <Icon icon={Users} size="xl" className="text-ds-content-link" />
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
                    <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                </div>
            </div>

            {/* Fills the card below the toolbar; the table scrolls inside it,
                under its sticky header, and sideways on a phone. */}
            <div className="flex min-h-0 flex-1 flex-col">
                <DataTable
                    embedded
                    ariaLabel="All platform users"
                    density="compact"
                    minWidth="standard"
                    data={paginatedData}
                    columns={columns}
                    getRowId={(user) => user.id}
                    isLoading={listLoading}
                    loadingLabel="Loading users..."
                    error={statsError.users ? 'Error loading users.' : undefined}
                    empty={{ title: 'No users found.' }}
                    pagination={{
                        currentPage,
                        totalPages: totalPages || 1,
                        onNext: () => setCurrentPage((p) => Math.min(totalPages, p + 1)),
                        onPrev: () => setCurrentPage((p) => Math.max(1, p - 1)),
                        hasPrev: currentPage > 1,
                        hasNext: currentPage < totalPages,
                        label: `Showing ${paginatedData.length} of ${filteredUserList.length} users`,
                        pageSize: itemsPerPage,
                        pageSizes: PAGE_SIZES,
                        onPageSizeChange: setItemsPerPage,
                    }}
                />
            </div>

            {/* Database Pagination (Load More): the list above is the users read so far, 50 at a time. */}
            {hasMore && (
                <div className="shrink-0 border-t border-ds-border-subtle bg-ds-surface p-ds-4 text-center">
                    <Button
                        variant="secondary"
                        loading={isLoadingMore}
                        onClick={() => loadMore('users')}
                    >
                        {isLoadingMore ? 'Loading…' : 'Load More from Database'}
                    </Button>
                </div>
            )}
        </Card>
    );
}
