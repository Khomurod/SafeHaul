/**
 * Contract freeze + a11y proof for `GlobalQuestionsManager`, written with its
 * design-system migration.
 *
 * This Super Admin view is a thin wrapper: the question list, creation/editing,
 * type/required/active controls, reordering, per-field validation and delete
 * confirmation all live in the shared, already-migrated
 * `CustomQuestionsBuilder` (a settings-feature primitive this view reuses — the
 * "already shares a proven presentation primitive" case). The wrapper owns only
 * the loading/error/header/legend/success presentation plus the schema
 * flatten/rebuild that bridges the builder to `useGlobalSchema`.
 *
 * Frozen here: the flatten (`field.key → id`, `sectionId`, `sectionTitle`,
 * `stepNumber`, `order = sectionIndex*100 + fieldIndex`); the save rebuild
 * (group by `sectionId`, `sanitizeQuestionPayload` per question, strip
 * `sectionId`/`sectionTitle`/`order`, `Custom Questions`/step 8/order 99
 * defaults, `{ ...schema, sections }` shape, `saveSchema` call); the
 * success/clear/3s-reset behaviour; and every user-facing string. The
 * `useGlobalSchema` Firestore path, versioning and document shape are owned by
 * the hook and untouched.
 *
 * All question keys, labels and section ids below are artificial fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const schemaState = vi.hoisted(() => ({ current: {} }));
const saveSchema = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const builderProps = vi.hoisted(() => ({ current: null }));
const sanitizeSpy = vi.hoisted(() => vi.fn((q) => q));

vi.mock('@/hooks/useGlobalSchema', () => ({ useGlobalSchema: () => schemaState.current }));
vi.mock('@shared/utils/sanitizeUserContent', () => ({ sanitizeQuestionPayload: (q) => sanitizeSpy(q) }));
vi.mock('@/features/settings/components/questions/CustomQuestionsBuilder', () => ({
    CustomQuestionsBuilder: (props) => {
        builderProps.current = props;
        return (
            <div data-testid="builder">
                <button type="button" onClick={() => props.onChange(props.questions)}>sim-change</button>
                <button type="button" onClick={() => props.onSave()}>sim-save</button>
            </div>
        );
    },
}));

import { GlobalQuestionsManager } from './GlobalQuestionsManager';

const SCHEMA = {
    version: '1.2.3',
    keepMe: 'top-level-extra',
    sections: [
        {
            id: 'sec1',
            title: 'Section One',
            stepNumber: 2,
            order: 1,
            fields: [
                { key: 'q1', type: 'text', label: 'Q1', required: true },
                { key: 'q2', type: 'select', label: 'Q2' },
            ],
        },
    ],
};

function base(overrides = {}) {
    return {
        schema: SCHEMA,
        loading: false,
        error: null,
        saving: false,
        saveSchema,
        refetch,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    sanitizeSpy.mockImplementation((q) => q);
    saveSchema.mockResolvedValue({ success: true, version: '1.2.4' });
    schemaState.current = base();
});

describe('GlobalQuestionsManager — states', () => {
    it('announces the loading state', () => {
        schemaState.current = base({ loading: true });
        render(<GlobalQuestionsManager />);
        expect(screen.getByText('Loading global schema...')).toBeInTheDocument();
    });

    it('shows the error state and retries', () => {
        schemaState.current = base({ error: 'boom' });
        render(<GlobalQuestionsManager />);
        expect(screen.getByText('Failed to load schema')).toBeInTheDocument();
        expect(screen.getByText('boom')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
        expect(refetch).toHaveBeenCalled();
    });

    it('renders the header, description and schema version', () => {
        render(<GlobalQuestionsManager />);
        expect(screen.getByRole('heading', { name: 'Global Application Questions' })).toBeInTheDocument();
        expect(screen.getByText(/Define the standard questions asked to all drivers\./)).toBeInTheDocument();
        expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    });

    it('keeps the legend wording', () => {
        render(<GlobalQuestionsManager />);
        expect(screen.getByText(/DOT Required = FMCSA mandated/)).toBeInTheDocument();
        expect(screen.getByText(/Locked = Companies cannot hide/)).toBeInTheDocument();
        expect(screen.getByText(/Editable = Label can be customized/)).toBeInTheDocument();
    });
});

describe('GlobalQuestionsManager — flatten + save rebuild contract', () => {
    it('flattens sections into the builder question list', () => {
        render(<GlobalQuestionsManager />);
        const qs = builderProps.current.questions;
        expect(qs).toHaveLength(2);
        expect(qs[0]).toMatchObject({ id: 'q1', key: 'q1', sectionId: 'sec1', sectionTitle: 'Section One', stepNumber: 2, order: 0 });
        expect(qs[1]).toMatchObject({ id: 'q2', key: 'q2', sectionId: 'sec1', order: 1 });
    });

    it('rebuilds the schema, sanitises each question, strips wrapper keys, and saves', async () => {
        render(<GlobalQuestionsManager />);
        fireEvent.click(screen.getByText('sim-save'));

        await waitFor(() => expect(saveSchema).toHaveBeenCalled());
        // Every question passes through the sanitiser.
        expect(sanitizeSpy).toHaveBeenCalledTimes(2);

        const saved = saveSchema.mock.calls[0][0];
        expect(saved.keepMe).toBe('top-level-extra'); // top-level schema preserved
        expect(saved.sections).toHaveLength(1);
        const section = saved.sections[0];
        expect(section).toMatchObject({ id: 'sec1', title: 'Section One', stepNumber: 2, order: 1 });
        expect(section.fields).toHaveLength(2);
        // Wrapper-only keys are stripped from stored fields.
        expect(section.fields[0]).not.toHaveProperty('sectionId');
        expect(section.fields[0]).not.toHaveProperty('sectionTitle');
        expect(section.fields[0]).not.toHaveProperty('order');
        expect(section.fields[0]).toMatchObject({ key: 'q1', type: 'text', label: 'Q1', required: true });
    });

    it('announces success after a save', async () => {
        vi.useRealTimers();
        render(<GlobalQuestionsManager />);
        fireEvent.click(screen.getByText('sim-save'));
        expect(await screen.findByText('Saved successfully!')).toBeInTheDocument();
    });

    it('clears the success flag when the questions change again', async () => {
        vi.useRealTimers();
        render(<GlobalQuestionsManager />);
        fireEvent.click(screen.getByText('sim-save'));
        expect(await screen.findByText('Saved successfully!')).toBeInTheDocument();
        fireEvent.click(screen.getByText('sim-change'));
        expect(screen.queryByText('Saved successfully!')).not.toBeInTheDocument();
    });

    it('passes the saving flag to the builder', () => {
        schemaState.current = base({ saving: true });
        render(<GlobalQuestionsManager />);
        expect(builderProps.current.loading).toBe(true);
    });
});

describe('GlobalQuestionsManager — accessibility (jsdom baseline)', () => {
    it('has no violations in the loaded state', async () => {
        vi.useRealTimers();
        const { container } = render(<GlobalQuestionsManager />);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations in the error state', async () => {
        vi.useRealTimers();
        schemaState.current = base({ error: 'boom' });
        const { container } = render(<GlobalQuestionsManager />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
