import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, UserPlus } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { Button, Card, DataTable, Notice } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';
import { useTeamRoster } from '../hooks/useTeamRoster';
import { AddPersonDialog } from './team/AddPersonDialog';
import { DailyGoalsDialog } from './team/DailyGoalsDialog';
import { teamColumns } from './team/teamColumns';
import { teamMemberName } from './team/teamMemberStatus';

/**
 * Settings → Team: everyone who recruits for the company, on the page itself.
 * "Add person" opens a dialog (`createPortalUser`); each row copies the member's
 * recruiting link, sets their daily goals, or removes them (`deletePortalUser`).
 * The roster comes from `listCompanyTeam` through `useTeamRoster`. Company
 * admins only.
 */
export function TeamManagementTab({ currentCompanyProfile, currentUserId, isCompanyAdmin }) {
    const companyId = currentCompanyProfile?.id;
    const { showSuccess, showError } = useToast();
    const roster = useTeamRoster(isCompanyAdmin ? companyId : null);
    const [showAdd, setShowAdd] = useState(false);
    const [goalsFor, setGoalsFor] = useState(null);
    const [pendingRemove, setPendingRemove] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    if (!isCompanyAdmin) {
        return (
            <p className="p-10 text-center text-ds-content-muted" data-testid="team-access-denied">
                Access Denied. Only Admins can manage the team.
            </p>
        );
    }

    const copyLink = async (member) => {
        const base = (import.meta.env.VITE_DRIVER_APP_URL || window.location.origin).replace(/\/$/, '');
        const link = `${base}/apply/${currentCompanyProfile.appSlug || companyId}?recruiter=${member.id}`;
        try {
            await navigator.clipboard.writeText(link);
            showSuccess('Custom recruiter link copied!');
        } catch {
            // Nothing reached the clipboard: give the link itself.
            showError(`Could not copy the link. Copy it by hand: ${link}`);
        }
    };

    const removeMember = async () => {
        const { id, name } = pendingRemove;
        setPendingRemove(null);
        setDeletingId(id);
        try {
            await httpsCallable(functions, 'deletePortalUser')({ userId: id, companyId });
            showSuccess(`${name || 'User'} has been removed from the team.`);
            // The membership listener may be denied; the roster must not show them still.
            roster.reload();
        } catch (error) {
            console.error('Error deleting user:', error);
            showError('Failed to remove user: ' + (error.message || 'Unknown error'));
        } finally {
            setDeletingId(null);
        }
    };

    const count = roster.members.length;
    const invalid = roster.invalidMemberships.length;

    return (
        <Stack gap="lg" data-testid="team-management">
            <PageHeader
                title="Team"
                description="Recruiters see their own leads. Admins see everything and change settings."
                count={roster.loading || roster.error ? undefined : count}
                countLabel={count === 1 ? 'person' : 'people'}
                actions={(
                    <Button variant="primary" onClick={() => setShowAdd(true)}>
                        <Icon icon={UserPlus} />
                        Add person
                    </Button>
                )}
            />
            {!roster.loading && !roster.error && invalid > 0 && (
                <Notice tone="warning" title="Data issue">
                    {invalid === 1
                        ? '1 membership record has no user attached and cannot be shown. Contact support to clean it up.'
                        : `${invalid} membership records have no user attached and cannot be shown. Contact support to clean them up.`}
                </Notice>
            )}
            <Card padding="none" className="overflow-hidden">
                <DataTable
                    embedded
                    ariaLabel="Team"
                    density="compact"
                    minWidth="standard"
                    mobilePresentation="cards"
                    data={roster.members}
                    columns={teamColumns({
                        currentUserId,
                        deletingId,
                        onCopyLink: copyLink,
                        onEditGoals: setGoalsFor,
                        onRemove: (member) => setPendingRemove({ id: member.id, name: teamMemberName(member) }),
                    })}
                    getRowId={(member) => member.id}
                    isLoading={roster.loading}
                    loadingLabel="Loading team"
                    error={roster.error ? { title: "Couldn't load your team", message: roster.error, onRetry: roster.reload } : undefined}
                    empty={{ title: 'No members found.', action: { label: 'Add person', onClick: () => setShowAdd(true) } }}
                />
            </Card>

            {showAdd && <AddPersonDialog companyId={companyId} onClose={() => setShowAdd(false)} onAdded={roster.reload} />}
            {goalsFor && (
                <DailyGoalsDialog
                    companyId={companyId}
                    member={goalsFor}
                    memberName={teamMemberName(goalsFor)}
                    onClose={() => setGoalsFor(null)}
                    onSaved={(goals) => roster.updateMember(goalsFor.id, goals)}
                />
            )}
            {pendingRemove && (
                <ConfirmDialog
                    tone="danger"
                    title="Remove team member"
                    description={`Are you sure you want to remove ${pendingRemove.name || 'this user'} from the team?`}
                    confirmLabel="Remove"
                    onCancel={() => setPendingRemove(null)}
                    onConfirm={removeMember}
                />
            )}
        </Stack>
    );
}
