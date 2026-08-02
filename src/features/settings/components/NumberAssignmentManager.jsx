import React, { useState } from 'react';
import { Phone, AlertCircle, Save, Beaker } from 'lucide-react';
import { Badge, Button, Card, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { SMSDiagnosticModal } from './SMSDiagnosticModal';
import { useLineAssignments } from '../hooks/useLineAssignments';
import { sanitizePhone, buildLineModel } from '../utils/linePhone';
import { DefaultLineSection } from './number-assignment/DefaultLineSection';
import { AssignmentTable } from './number-assignment/AssignmentTable';

/**
 * NumberAssignmentManager
 * =======================
 * Company-admin screen that maps SMS lines to recruiters and picks the
 * company default line.
 *
 * Migrated to the design system 2026-07-27, closing the debt recorded by the
 * 2026-07-23 deep-audit ("Company Settings SMS / number-assignment deep-audit
 * log (NO-GO)"): unlabelled per-row and default-line selects, `text-[9px]`/
 * `text-[10px]` status text, and color-only status dots. Presentation only —
 * every Firestore/callable contract that audit froze is unchanged:
 * `saveSmsLineAssignments`/`verifyLineConnection` payloads, the stable
 * line-token model (never raw phone values as `<select>` option values), the
 * `sms_provider` doc shape, the roster resolution, and the one-time legacy
 * token backfill. `useLineAssignments.js` and `utils/linePhone.js` are
 * untouched.
 *
 * `DataTable` is deliberately NOT used for the assignment matrix: every cell
 * is an editable per-row `<select>` plus a verify action, which is outside
 * `DataTable`'s proven display-table contract. That finding is unchanged from
 * the deep-audit; only the raw, unlabelled, sub-12px markup around it is
 * fixed. See `AssignmentTable.jsx` for what was fixed there instead.
 *
 * Split for readability (behavior unchanged):
 *  - ../hooks/useLineAssignments.js            — data/logic (listener, roster, backfill, verify, save)
 *  - ../utils/linePhone.js                     — sanitizePhone + stable line-token model
 *  - ./number-assignment/DefaultLineSection.jsx — default line card
 *  - ./number-assignment/AssignmentTable.jsx    — recruiter matrix (rows in AssignmentRow.jsx)
 */
export function NumberAssignmentManager({ companyId }) {
    const {
        loading,
        configDoc,
        configError,
        users,
        saving,
        verifyingLine,
        lineStatuses,
        assignments,
        setAssignments,
        defaultNumber,
        setDefaultNumber,
        assignmentTokenOverrides,
        setAssignmentTokenOverrides,
        savedAssignmentTokens,
        defaultTokenOverride,
        setDefaultTokenOverride,
        savedDefaultToken,
        hasChanges,
        handleVerifyLine,
        handleSave,
    } = useLineAssignments(companyId);

    const [showTestModal, setShowTestModal] = useState(false);

    if (loading) {
        return (
            <p role="status" data-testid="number-assignment-manager" className="p-ds-8 text-center text-ds-sm text-ds-content-muted">
                Loading inventory...
            </p>
        );
    }

    // Distinct from the "not active" branch below: that one means Firestore answered
    // and there is no `sms_provider` doc; this one means the listen itself failed, so
    // we genuinely do not know the company's SMS state and must not imply it is off.
    if (configError) {
        return (
            <Card
                data-testid="number-assignment-manager"
                padding="lg"
                className="border-ds-status-danger-border bg-ds-status-danger-bg text-center"
            >
                <StatusMedallion tone="danger" className="mx-auto mb-ds-2"><AlertCircle /></StatusMedallion>
                <h3 className="font-bold text-ds-status-danger-fg">Couldn't Load SMS Settings</h3>
                <p role="alert" className="mt-ds-1 text-ds-sm text-ds-status-danger-fg">
                    We couldn't reach your SMS configuration. Check your connection and try again, or
                    contact a Super Admin if this keeps happening.
                </p>
            </Card>
        );
    }

    if (!configDoc || !configDoc.isActive) {
        return (
            <Card
                data-testid="number-assignment-manager"
                padding="lg"
                className="border-ds-status-warning-border bg-ds-status-warning-bg text-center"
            >
                <StatusMedallion tone="warning" className="mx-auto mb-ds-2"><AlertCircle /></StatusMedallion>
                <h3 className="font-bold text-ds-status-warning-fg">SMS Integration Not Active</h3>
                <p className="mt-ds-1 text-ds-sm text-ds-status-warning-fg">Please contact a Super Admin to enable SMS for your company.</p>
            </Card>
        );
    }

    const inventory = configDoc.inventory || []; // Array of { phoneNumber, ... }

    // Resilience: if a default line is configured but is not present in the synced
    // inventory (e.g. the number was added directly at the provider, or the sync is
    // stale), the dropdown would otherwise have no matching <option> and silently render
    // as "-- Select Default Number --" -- hiding a default that is configured and used to
    // send. Surface it as a selectable option instead, mirroring the per-recruiter matrix.
    const sanitizedDefault = sanitizePhone(defaultNumber);
    const defaultInInventory = inventory.some(num => sanitizePhone(num.phoneNumber) === sanitizedDefault);

    const { lines, resolveLineToken, tokenForPhone, phoneForToken } = buildLineModel(inventory);

    if (inventory.length === 0) {
        return (
            <Card data-testid="number-assignment-manager" padding="lg" className="text-center">
                <Phone className="mx-auto mb-ds-3 text-ds-content-muted" size={32} />
                <h3 className="font-bold text-ds-content">No Numbers Found</h3>
                <p className="mt-ds-1 text-ds-sm text-ds-content-muted">We couldn't find any phone numbers connected to your provider account.</p>
            </Card>
        );
    }

    return (
        <Stack gap="lg" data-testid="number-assignment-manager">
            <div className="flex items-center justify-between border-b border-ds-border-subtle pb-ds-4">
                <div>
                    <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <Phone className="text-ds-content-link" size={24} aria-hidden="true" /> Number Assignments
                    </h2>
                    <p className="mt-ds-1 text-ds-sm text-ds-content-muted">inventory: {inventory.length} numbers available</p>
                </div>
                <div className="flex items-center gap-ds-3">
                    {hasChanges && (
                        <Badge tone="warning" icon={AlertCircle}>Unsaved changes</Badge>
                    )}
                    <Button variant="secondary" onClick={() => setShowTestModal(true)}>
                        <Beaker size={16} aria-hidden="true" />
                        Diagnostic Lab
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        disabled={saving}
                        loading={saving}
                    >
                        {!saving && <Save size={18} aria-hidden="true" />}
                        {hasChanges ? 'Save Changes Now' : 'Save Changes'}
                    </Button>
                </div>
            </div>

            {/* Default Number Section */}
            <DefaultLineSection
                lines={lines}
                sanitizedDefault={sanitizedDefault}
                defaultInInventory={defaultInInventory}
                defaultNumber={defaultNumber}
                setDefaultNumber={setDefaultNumber}
                defaultTokenOverride={defaultTokenOverride}
                setDefaultTokenOverride={setDefaultTokenOverride}
                savedDefaultToken={savedDefaultToken}
                tokenForPhone={tokenForPhone}
                phoneForToken={phoneForToken}
                resolveLineToken={resolveLineToken}
                handleVerifyLine={handleVerifyLine}
                verifyingLine={verifyingLine}
                lineStatuses={lineStatuses}
            />

            {/* Assignment Matrix */}
            <AssignmentTable
                users={users}
                inventory={inventory}
                lines={lines}
                assignments={assignments}
                setAssignments={setAssignments}
                assignmentTokenOverrides={assignmentTokenOverrides}
                setAssignmentTokenOverrides={setAssignmentTokenOverrides}
                savedAssignmentTokens={savedAssignmentTokens}
                tokenForPhone={tokenForPhone}
                phoneForToken={phoneForToken}
                resolveLineToken={resolveLineToken}
                handleVerifyLine={handleVerifyLine}
                verifyingLine={verifyingLine}
                lineStatuses={lineStatuses}
            />

            {/* SMS Diagnostic Lab Modal */}
            {showTestModal && (
                <SMSDiagnosticModal
                    companyId={companyId}
                    inventory={inventory}
                    onClose={() => setShowTestModal(false)}
                />
            )}
        </Stack>
    );
}
