import {
    Sparkles,
    Clock,
    CheckCircle2,
    PauseCircle,
    XCircle,
    ShieldCheck,
    Send,
    Archive,
    Circle,
} from 'lucide-react';

/**
 * Map a status string to a lucide icon component (C3, WCAG 1.4.1).
 *
 * Status must never be conveyed by colour alone. The text label already carries
 * meaning; pairing each status with a distinct icon shape makes it perceivable
 * for colour-blind users and when scanning quickly. Matching is fuzzy/substring
 * so it works for both the canonical StatusBadge labels and the free-form status
 * strings used in candidate/lead lists.
 *
 * @param {string} status
 * @returns {import('react').ComponentType<{ size?: number, className?: string }>}
 */
export function getStatusIcon(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('reject') || s.includes('disqualif') || s.includes('declin')) return XCircle;
    if (s.includes('hired') || s.includes('accept') || s.includes('approved') || s.includes('qualified')) return CheckCircle2;
    if (s.includes('offer')) return Send;
    if (s.includes('background')) return ShieldCheck;
    if (s.includes('hold') || s.includes('needs info')) return PauseCircle;
    if (s.includes('review') || s.includes('contacted') || s.includes('attempted')) return Clock;
    if (s.includes('stale')) return Archive;
    if (s.includes('new') || s.includes('lead')) return Sparkles;
    return Circle;
}

export default getStatusIcon;
