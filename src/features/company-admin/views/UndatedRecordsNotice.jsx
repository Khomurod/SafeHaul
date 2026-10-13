import React from 'react';
import { Notice } from '@/design-system/components';

/**
 * How many records the candidate list cannot show because they have no Added
 * Date (no `createdAt`). Firestore sorts the list by that date, and a sort
 * leaves out a record without it; search is not sorted that way, so it still
 * finds one. Nothing renders while every record has a date.
 */
export function UndatedRecordsNotice({ count }) {
    if (!count) return null;
    const message = count === 1
        ? '1 record has no added date, so this list, which is sorted by that date, cannot show it. Search by name, phone or email to find it.'
        : `${count.toLocaleString('en-US')} records have no added date, so this list, which is sorted by that date, cannot show them. Search by name, phone or email to find one.`;
    return (
        <Notice tone="info" size="sm" className="mb-ds-3">
            {message}
        </Notice>
    );
}
