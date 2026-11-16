import { LayoutDashboard, FileText, ShieldCheck, Activity, StickyNote, History } from '@design-system/icons';

/**
 * The dossier's sections, in the strip's order. Each `label` is the section's
 * one name: the tab says it and the header's title says the same
 * (`sectionTitle`), so a section is never named twice in different words.
 */
export const DOSSIER_SECTIONS = Object.freeze([
    { id: 'application', label: 'Application', icon: LayoutDashboard },
    { id: 'documents', label: 'Documents to sign', icon: FileText },
    { id: 'dq', label: 'DQ File', icon: ShieldCheck },
    { id: 'pev', label: 'Previous Employment', icon: History },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'notes', label: 'Notes', icon: StickyNote },
]);

/** The header's title for a section: its label, and "Lead" for a lead's first section. */
export function sectionTitle(id, { isLead = false } = {}) {
    if (id === 'application' && isLead) return 'Lead';
    return DOSSIER_SECTIONS.find((section) => section.id === id)?.label ?? 'Driver Dossier';
}
