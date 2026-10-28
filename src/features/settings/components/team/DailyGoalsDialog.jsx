import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Icon, X } from '@design-system/icons';
import { Button, FieldMessage, FormField, IconButton, Input } from '@/design-system/components';
import { Modal } from '@design-system/patterns';

/**
 * A member's daily goals: dials and contacts, stored in
 * `companies/{companyId}/team/{userId}` (merged, with `updatedAt`), as before.
 */
export function DailyGoalsDialog({ companyId, member, memberName, onClose, onSaved }) {
    const [dials, setDials] = useState(String(member.callGoal ?? ''));
    const [contacts, setContacts] = useState(String(member.contactGoal ?? ''));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const goals = { callGoal: Number(dials), contactGoal: Number(contacts) };
        try {
            await setDoc(doc(db, 'companies', companyId, 'team', member.id), { ...goals, updatedAt: new Date() }, { merge: true });
            onSaved(goals);
            onClose();
        } catch (err) {
            console.error(err);
            setError('Error saving goal');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal onClose={onClose} labelledBy="daily-goals-title" size="sm">
            <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4">
                <h2 id="daily-goals-title" className="min-w-0 truncate font-bold text-ds-content">
                    Daily goals · {memberName}
                </h2>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>
            <form onSubmit={handleSubmit} className="space-y-ds-4 p-ds-6">
                <div className="grid grid-cols-2 gap-ds-4">
                    <FormField id="team-goal-dials" label="Dials" required>
                        <Input type="number" min="0" value={dials} onChange={(e) => setDials(e.target.value)} />
                    </FormField>
                    <FormField id="team-goal-contacts" label="Contacts" required>
                        <Input type="number" min="0" value={contacts} onChange={(e) => setContacts(e.target.value)} />
                    </FormField>
                </div>
                {error && <FieldMessage tone="error">{error}</FieldMessage>}
                <div className="flex justify-end gap-ds-3">
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" variant="primary" loading={saving}>Save</Button>
                </div>
            </form>
        </Modal>
    );
}
