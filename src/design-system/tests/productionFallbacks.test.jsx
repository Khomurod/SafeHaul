/**
 * In a production build a misused prop is reported and the component draws its
 * default: these are the checks after which drawing on with the bad value would
 * itself crash or hide content (a lookup that comes back empty, an element name
 * that is not one, a list that is not a list). Outside a production build every
 * one of them still throws (`contract.test.js`, and each component's own tests).
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/react', () => ({ captureException }));

import { Avatar } from '../components/avatar/Avatar';
import { Button } from '../components/button/Button';
import { DataTable } from '../components/data-table/DataTable';
import { defineTableColumns } from '../components/data-table/tableColumnContract';
import { Disclosure } from '../components/disclosure/Disclosure';
import { FormField } from '../components/form/FormControls';
import { Notice } from '../components/notice/Notice';
import { ProgressBar } from '../components/progress/ProgressBar';
import { SectionNavigation } from '../components/section-navigation/SectionNavigation';
import { SegmentedControl } from '../components/segmented/SegmentedControl';
import { SelectableCard } from '../components/selectable-card/SelectableCard';
import { TabList } from '../components/tabs/Tabs';
import { Icon } from '../icons';
import { ConfirmDialog } from '../patterns/modal/ConfirmDialog';
import { Modal } from '../patterns/modal/Modal';
import { PageState } from '../patterns/page-state/PageState';

const cell = (row) => row.name;

beforeEach(() => {
    vi.stubEnv('PROD', true);
    captureException.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** What was reported to Sentry while the test ran. */
const reported = () => captureException.mock.calls.map(([error]) => error.message);

describe('a production build draws the default after a misused prop', () => {
    it('Avatar: a size that is neither a step nor { base, sm } draws md', () => {
        render(<Avatar size={42}>AO</Avatar>);
        expect(screen.getByText('AO').closest('[data-size]')).toHaveAttribute('data-size', 'md');
    });

    it('Button: an unknown variant and size draw the defaults', () => {
        render(<Button variant="loud" size="huge">Save</Button>);
        const button = screen.getByRole('button', { name: 'Save' });
        expect(button).toHaveAttribute('data-variant', 'secondary');
        expect(button).toHaveAttribute('data-size', 'md');
    });

    it('DataTable columns: what cannot be drawn is left out, a bad option takes its default', () => {
        expect(defineTableColumns('name')).toEqual([]);

        const columns = defineTableColumns([
            null,
            { key: 'notes', header: 'Notes' },
            { key: 'name', header: 'Name', render: cell, align: 'middle', width: 'huge', priority: 'top', mobileLabel: 5 },
        ]);
        expect(columns).toHaveLength(1);
        expect(columns[0]).toMatchObject({ key: 'name', align: 'start', width: 'auto', priority: 'secondary', mobileLabel: undefined });

        render(<DataTable ariaLabel="Drivers" columns={columns} data={[{ id: 'd1', name: 'Ada Lovelace' }]} />);
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(reported()).toHaveLength(7);
    });

    it('Disclosure: a heading level that is not one is an h3', () => {
        render(<Disclosure title="Licences" headingLevel={9}>Body</Disclosure>);
        expect(screen.getByRole('heading', { level: 3, name: 'Licences' })).toBeInTheDocument();
    });

    it('Notice: an unsupported title element is a paragraph', () => {
        render(<Notice title="Saved" titleAs="h1">Done.</Notice>);
        expect(screen.getByText('Saved').tagName).toBe('P');
    });

    it('ProgressBar: a max or value that is not a number draws 0 of 100', () => {
        render(<ProgressBar label="Upload" max={0} value={Number.NaN} />);
        const bar = screen.getByRole('progressbar', { name: 'Upload' });
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveAttribute('aria-valuenow', '0');
    });

    it('SelectableCard: an unsupported element is a button', () => {
        render(<SelectableCard as="span" onSelect={() => {}}>Flatbed</SelectableCard>);
        expect(screen.getByRole('button', { name: 'Flatbed' })).toBeInTheDocument();
    });

    it('Modal: unsupported chrome draws the default chrome', () => {
        render(
            <Modal label="Edit driver" onClose={() => {}} size="huge" scroll="sideways" tone="loud">
                <button type="button">Inside</button>
            </Modal>,
        );
        const panel = document.querySelector('[data-scroll]');
        expect(panel).toHaveAttribute('data-scroll', 'panel');
        expect(panel).toHaveAttribute('data-size', 'lg');
        expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();
    });

    it('TabList: tabs that are not a list draw none; an unknown orientation is horizontal', () => {
        render(<TabList ariaLabel="Sections" idBase="tabs" tabs={null} orientation="diagonal" onChange={() => {}} />);
        expect(screen.getByRole('tablist', { name: 'Sections' })).toHaveAttribute('data-orientation', 'horizontal');
    });

    it('SegmentedControl: options that are not a list draw none', () => {
        render(<SegmentedControl ariaLabel="Mode" options={null} onChange={() => {}} />);
        expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    });

    it('SectionNavigation: groups that are not a list draw none', () => {
        render(<SectionNavigation label="Settings sections" groups={null} />);
        expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    });

    it('Icon: something that is not a glyph draws nothing', () => {
        const { container } = render(<Icon icon={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('FormField: a child that is not one element is shown as it came', () => {
        render(<FormField label="Notes">No control here</FormField>);
        expect(screen.getByText('Notes')).toBeInTheDocument();
        expect(screen.getByText('No control here')).toBeInTheDocument();
    });

    it('ConfirmDialog: an unknown tone is danger', () => {
        render(<ConfirmDialog title="Delete this lead?" tone="loud" onConfirm={() => {}} onCancel={() => {}} />);
        expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute('data-variant', 'danger');
    });

    it('PageState: a heading level that is not one is an h2', () => {
        render(<PageState title="Nothing here yet" headingLevel={7} />);
        expect(screen.getByRole('heading', { level: 2, name: 'Nothing here yet' })).toBeInTheDocument();
    });

    it('reports each misuse to Sentry as it draws the default', () => {
        render(<Notice title="Saved" titleAs="h7">Done.</Notice>);
        expect(reported()).toEqual(['Unsupported Notice titleAs: h7']);
    });
});
