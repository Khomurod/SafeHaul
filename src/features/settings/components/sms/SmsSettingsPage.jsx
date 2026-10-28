import React, { useState } from 'react';
import { Button, Card, DataTable, Notice } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { ErrorState, LoadingState, SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { Icon, Plus, Send, Copy } from '@design-system/icons';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { AddLineModal } from '@/features/super-admin/components/integrations/AddLineModal';
import { RemoveLineDialog } from '@/features/super-admin/components/integrations/RemoveLineDialog';
import { useRemovePhoneLine } from '@/features/super-admin/components/integrations/useRemovePhoneLine';
import { useLineAssignments } from '../../hooks/useLineAssignments';
import { buildLineModel, sanitizePhone } from '../../utils/linePhone';
import { SMSDiagnosticModal } from '../SMSDiagnosticModal';
import { AssignmentTable } from '../number-assignment/AssignmentTable';
import { SmsSetupChecklist } from './SmsSetupChecklist';
import { phoneLineColumns } from './phoneLineColumns';
import { changeSummary, membersByLine } from './smsLineState';
import { supportRequestText } from './smsSupportRequest';

/**
 * Settings → Text messages (SMS): the company's phone lines, who texts from
 * which, and the default line. Until texting works (no active `sms_provider`
 * doc or no line) it is a four-step checklist instead.
 *
 * Frozen contracts, unchanged here: `useLineAssignments` (the listener, roster,
 * token backfill, `verifyLineConnection` and the token-based
 * `saveSmsLineAssignments`), the line-token model in `utils/linePhone.js`,
 * `removePhoneLine` through `useRemovePhoneLine`, and `AddLineModal`, which takes
 * the RingCentral credentials with the first line and encrypts them server-side.
 * Edits to who texts from which line and to the default are kept on the page
 * until Save; the save bar and the shell's leave guard watch them.
 */
export function SmsSettingsPage({ companyId, companyName }) {
    const la = useLineAssignments(companyId);
    const { removingLine, removeLine } = useRemovePhoneLine(companyId);
    const { showSuccess, showError } = useToast();
    const [showAdd, setShowAdd] = useState(false);
    const [showTest, setShowTest] = useState(false);
    const [pendingRemove, setPendingRemove] = useState(null);
    useUnsavedChanges(la.hasChanges);

    const configDoc = la.configDoc;
    const inventory = configDoc?.inventory || [];
    // The same derivation as `LineManager`: the shared credentials exist once both are saved.
    const hasCredentials = !!(configDoc?.config?.clientId && configDoc?.config?.clientSecret);
    const configured = !!configDoc?.isActive && inventory.length > 0;

    const header = (
        <PageHeader
            title="Text messages (SMS)"
            description={configured
                ? `RingCentral · ${inventory.length} ${inventory.length === 1 ? 'line' : 'lines'}. A member without a line of their own texts from the default line.`
                : 'Text drivers from your own phone numbers. Four steps to set it up.'}
            actions={configured && !la.loading && !la.configError ? (
                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="secondary" onClick={() => setShowTest(true)}><Icon icon={Send} />Send a test</Button>
                    <Button variant="primary" onClick={() => setShowAdd(true)}><Icon icon={Plus} />Add line</Button>
                </div>
            ) : undefined}
        />
    );

    const addLineModal = showAdd && (
        <AddLineModal
            companyId={companyId}
            onClose={() => setShowAdd(false)}
            // The listener brings the new line in.
            onSuccess={() => {}}
            sharedCredentials={{ hasCredentials }}
        />
    );

    if (la.loading) {
        return <Stack gap="lg" data-testid="sms-settings">{header}<LoadingState title="Loading phone lines" /></Stack>;
    }
    // A failed read says nothing about whether texting is set up, so it never shows the checklist.
    if (la.configError) {
        return (
            <Stack gap="lg" data-testid="sms-settings">
                {header}
                <ErrorState
                    title="Couldn't load SMS settings"
                    description="We couldn't reach your SMS configuration. Check your connection and try again, or contact a Super Admin if this keeps happening."
                />
            </Stack>
        );
    }

    const { lines: modelLines, tokenForPhone, phoneForToken, resolveLineToken } = buildLineModel(inventory);
    const lines = modelLines.map((line, index) => ({ ...line, index, raw: inventory[index] }));
    const sanitizedDefault = sanitizePhone(la.defaultNumber);

    if (!configured) {
        const copySupportRequest = async () => {
            try {
                await navigator.clipboard.writeText(supportRequestText({ companyName, companyId }));
                showSuccess('Request copied. Send it to SafeHaul support.');
            } catch {
                // Nothing reached the clipboard, so say what to ask for instead.
                showError('Could not copy the request. Ask SafeHaul support to set up text messaging for your company.');
            }
        };
        return (
            <Stack gap="lg" data-testid="sms-settings">
                {header}
                {configDoc && !configDoc.isActive && inventory.length > 0 && (
                    <Notice tone="warning" title="Text messaging is switched off">
                        Your lines are kept. SafeHaul support can switch texting back on.
                    </Notice>
                )}
                <SmsSetupChecklist
                    steps={[
                        {
                            id: 'connect',
                            title: 'Connect RingCentral',
                            description: 'Your RingCentral Client ID and Client Secret, entered once with your first line. SafeHaul support can do this for you.',
                            done: hasCredentials,
                        },
                        {
                            id: 'line',
                            title: 'Add your first line',
                            description: 'A phone number and its token from RingCentral admin.',
                            done: inventory.length > 0,
                            actions: (
                                <>
                                    <Button variant="primary" onClick={() => setShowAdd(true)}><Icon icon={Plus} />Add line</Button>
                                    <Button variant="secondary" onClick={copySupportRequest}><Icon icon={Copy} />Copy request for support</Button>
                                </>
                            ),
                        },
                        {
                            id: 'default',
                            title: 'Choose the default line',
                            description: 'Used for automated texts and by anyone without a line of their own.',
                            done: !!sanitizedDefault,
                        },
                        {
                            id: 'members',
                            title: 'Give recruiters their own lines',
                            description: 'Optional. Drivers then see each recruiter’s own number.',
                            done: Object.values(la.assignments).some((phone) => sanitizePhone(phone)),
                        },
                    ]}
                />
                {addLineModal}
            </Stack>
        );
    }

    const lineState = {
        assignments: la.assignments,
        assignmentTokenOverrides: la.assignmentTokenOverrides,
        savedAssignmentTokens: la.savedAssignmentTokens,
        tokenForPhone,
        resolveLineToken,
    };
    // The default as a line token, so it is found even when a browser hides the digits.
    const defaultToken = la.defaultTokenOverride
        ?? (tokenForPhone(sanitizedDefault) || resolveLineToken(la.savedDefaultToken));
    const defaultMissing = !!sanitizedDefault && !lines.some((line) => line.token === defaultToken);

    const columns = phoneLineColumns({
        defaultToken,
        membersByToken: membersByLine(la.users, lineState),
        usage: la.rosterLoading || la.ownersLoading ? 'loading' : la.rosterFailed ? 'failed' : 'ready',
        lineStatuses: la.lineStatuses,
        verifyingLine: la.verifyingLine,
        removingLine,
        onVerify: la.handleVerifyLine,
        onSetDefault: (line) => { la.setDefaultTokenOverride(line.token); la.setDefaultNumber(line.phone); },
        onUnsetDefault: () => { la.setDefaultTokenOverride(''); la.setDefaultNumber(''); },
        onRemove: (line) => setPendingRemove({ phoneNumber: line.raw.phoneNumber }),
    });

    return (
        <Stack gap="lg" data-testid="sms-settings">
            {header}
            {defaultMissing && (
                <Notice tone="warning" title="The default line is not among your lines">
                    {sanitizedDefault} is the default line, but it is missing from the synced lines. Set one of your lines as the default.
                </Notice>
            )}
            <Card padding="none" className="overflow-hidden">
                <div className="border-b border-ds-border-subtle px-ds-4 py-ds-3">
                    <h2 className="font-semibold text-ds-content">Phone lines</h2>
                    <p className="text-ds-sm text-ds-content-muted">Check sends nothing: it only confirms the line answers RingCentral.</p>
                </div>
                <DataTable
                    embedded
                    ariaLabel="Phone lines"
                    density="compact"
                    minWidth="standard"
                    mobilePresentation="cards"
                    data={lines}
                    columns={columns}
                    getRowId={(line) => line.token}
                />
            </Card>
            <AssignmentTable
                users={la.users}
                loading={la.rosterLoading}
                onRetry={la.rosterFailed ? la.reloadRoster : undefined}
                inventory={inventory}
                lines={lines}
                assignments={la.assignments}
                setAssignments={la.setAssignments}
                assignmentTokenOverrides={la.assignmentTokenOverrides}
                setAssignmentTokenOverrides={la.setAssignmentTokenOverrides}
                savedAssignmentTokens={la.savedAssignmentTokens}
                tokenForPhone={tokenForPhone}
                phoneForToken={phoneForToken}
                resolveLineToken={resolveLineToken}
            />
            {la.hasChanges && (
                <SaveBar
                    summary={changeSummary(la.users, la)}
                    saving={la.saving}
                    onSave={la.handleSave}
                    onDiscard={la.discardChanges}
                />
            )}
            {showTest && <SMSDiagnosticModal companyId={companyId} inventory={inventory} onClose={() => setShowTest(false)} />}
            {addLineModal}
            {pendingRemove && (
                <RemoveLineDialog
                    line={pendingRemove}
                    onCancel={() => setPendingRemove(null)}
                    onConfirm={() => {
                        const { phoneNumber } = pendingRemove;
                        setPendingRemove(null);
                        removeLine(phoneNumber);
                    }}
                />
            )}
        </Stack>
    );
}

