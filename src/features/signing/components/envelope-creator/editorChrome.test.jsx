// Editor chrome: top bar, canvas toolbar and page navigator.
// react-pdf is stubbed (jsdom cannot rasterise a PDF); all data is artificial.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-pdf', () => ({
    Document: ({ children }) => <div data-testid="pdf-document">{children}</div>,
    Page: ({ pageNumber, width }) => <div data-testid="pdf-thumb" data-page={pageNumber} data-width={width} />,
}));

import { EditorTopBar } from './EditorTopBar';
import { EditorCanvasToolbar } from './EditorCanvasToolbar';
import { PageThumbnailRail } from './PageThumbnailRail';
import { EDITOR_MODES, SAVE_STATES } from '@features/signing/utils/editorSaveState';
import { PDF_VIEWPORT_WIDTH_DEFAULT } from '@features/signing/utils/envelopePdfZoom';

beforeEach(() => vi.clearAllMocks());

describe('EditorTopBar', () => {
    const renderBar = (overrides = {}) => {
        const props = {
            mode: EDITOR_MODES.TEMPLATE,
            title: 'Artificial Onboarding Packet',
            onTitleChange: vi.fn(),
            saveState: SAVE_STATES.CLEAN,
            pageCount: 4,
            fieldCount: 7,
            canUndo: false,
            canRedo: false,
            onUndo: vi.fn(),
            onRedo: vi.fn(),
            onPreview: vi.fn(),
            onBack: vi.fn(),
            onSave: vi.fn(),
            ...overrides,
        };
        return { props, ...render(<EditorTopBar {...props} />) };
    };

    it('shows where you are, what you are building and how big it is', () => {
        renderBar();
        expect(screen.getByRole('button', { name: 'Back to Documents' })).toBeInTheDocument();
        expect(screen.getByLabelText('Document title')).toHaveValue('Artificial Onboarding Packet');
        expect(screen.getByText('Reusable template')).toBeInTheDocument();
        expect(screen.getByText('4 pages')).toBeInTheDocument();
        expect(screen.getByText('7 fields')).toBeInTheDocument();
    });

    it('singularises the counts', () => {
        renderBar({ pageCount: 1, fieldCount: 1 });
        expect(screen.getByText('1 page')).toBeInTheDocument();
        expect(screen.getByText('1 field')).toBeInTheDocument();
    });

    it.each([
        [EDITOR_MODES.TEMPLATE, 'Reusable template', 'Save Template'],
        [EDITOR_MODES.REQUEST, 'One-off send', 'Send Document'],
        [EDITOR_MODES.EDIT_TEMPLATE, 'Edit Template', 'Save Template Changes'],
        [EDITOR_MODES.CORRECT_REQUEST, 'Correct Document', 'Save Correction'],
    ])('states the %s mode and its primary action', (mode, label, action) => {
        renderBar({ mode });
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    });

    it('commits a title edit on blur, not on every keystroke', () => {
        const { props } = renderBar();
        const input = screen.getByLabelText('Document title');

        fireEvent.change(input, { target: { value: 'Renamed packet' } });
        expect(props.onTitleChange).not.toHaveBeenCalled();

        fireEvent.blur(input);
        expect(props.onTitleChange).toHaveBeenCalledExactlyOnceWith('Renamed packet');
    });

    it('commits on Enter and abandons on Escape', () => {
        const { props } = renderBar();
        const input = screen.getByLabelText('Document title');

        fireEvent.change(input, { target: { value: 'Committed' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.blur(input);
        expect(props.onTitleChange).toHaveBeenCalledWith('Committed');

        props.onTitleChange.mockClear();
        fireEvent.change(input, { target: { value: 'Abandoned' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.blur(input);
        expect(props.onTitleChange).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Document title')).toHaveValue('Artificial Onboarding Packet');
    });

    it('does not fire a change when the title is unchanged', () => {
        const { props } = renderBar();
        fireEvent.blur(screen.getByLabelText('Document title'));
        expect(props.onTitleChange).not.toHaveBeenCalled();
    });

    it.each([
        [SAVE_STATES.CLEAN, null],
        [SAVE_STATES.UNSAVED, 'Unsaved changes'],
        [SAVE_STATES.SAVING, 'Saving'],
        [SAVE_STATES.SAVED, 'Saved'],
        [SAVE_STATES.ERROR, 'Not saved'],
    ])('reports the %s save state', (state, label) => {
        renderBar({ saveState: state });
        if (label) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        else expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });

    it('never claims Saved while work is unsaved or a save failed', () => {
        const { unmount } = renderBar({ saveState: SAVE_STATES.UNSAVED });
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
        unmount();

        renderBar({ saveState: SAVE_STATES.ERROR });
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });

    it('enables undo and redo only when there is history', () => {
        const { unmount } = renderBar();
        expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
        unmount();

        const { props } = renderBar({ canUndo: true, canRedo: true });
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
        expect(props.onUndo).toHaveBeenCalledTimes(1);
        expect(props.onRedo).toHaveBeenCalledTimes(1);
    });

    it('offers preview and disables it without a document', () => {
        const { props } = renderBar();
        fireEvent.click(screen.getByRole('button', { name: 'Preview as signer' }));
        expect(props.onPreview).toHaveBeenCalledTimes(1);

        render(<EditorTopBar {...props} previewDisabled />);
        expect(screen.getAllByRole('button', { name: 'Preview as signer' })[1]).toBeDisabled();
    });

    it('blocks the primary action while a save is in flight and announces it', () => {
        renderBar({ saving: true });
        expect(screen.getByRole('button', { name: 'Save Template' })).toBeDisabled();
        expect(screen.getByText('Saving document, please wait…')).toBeInTheDocument();
    });

    it('keeps every control named when compacted for narrow screens', () => {
        renderBar({ compact: true });
        expect(screen.getByRole('button', { name: 'Back to Documents' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Preview as signer' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save Template' })).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderBar({ saveState: SAVE_STATES.UNSAVED, canUndo: true });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('EditorCanvasToolbar', () => {
    const renderToolbar = (overrides = {}) => {
        const props = {
            activePage: 2,
            numPages: 5,
            onPreviousPage: vi.fn(),
            onNextPage: vi.fn(),
            pdfViewportWidth: PDF_VIEWPORT_WIDTH_DEFAULT,
            setPdfViewportWidth: vi.fn(),
            onFitWidth: vi.fn(),
            onFitPage: vi.fn(),
            canUndo: true,
            canRedo: true,
            onUndo: vi.fn(),
            onRedo: vi.fn(),
            onPreview: vi.fn(),
            ...overrides,
        };
        return { props, ...render(<EditorCanvasToolbar {...props} />) };
    };

    it('is a labelled toolbar carrying every documented control', () => {
        renderToolbar();
        const toolbar = screen.getByRole('toolbar', { name: 'Document canvas tools' });
        for (const name of ['Previous page', 'Next page', 'Zoom out', 'Zoom in', 'Undo', 'Redo', 'Preview as signer']) {
            expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
        }
        expect(within(toolbar).getByRole('button', { name: /Fit Width/ })).toBeInTheDocument();
        expect(within(toolbar).getByRole('button', { name: /Fit Page/ })).toBeInTheDocument();
        expect(within(toolbar).getByText('Page 2 / 5')).toBeInTheDocument();
    });

    it('pages through the document and stops at both ends', () => {
        const { props } = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(props.onPreviousPage).toHaveBeenCalledTimes(1);
        expect(props.onNextPage).toHaveBeenCalledTimes(1);

        render(<EditorCanvasToolbar {...props} activePage={1} />);
        expect(screen.getAllByRole('button', { name: 'Previous page' })[1]).toBeDisabled();

        render(<EditorCanvasToolbar {...props} activePage={5} />);
        expect(screen.getAllByRole('button', { name: 'Next page' })[2]).toBeDisabled();
    });

    it('keeps the existing zoom steps and reset', () => {
        const { props } = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        const shrink = props.setPdfViewportWidth.mock.calls[0][0];
        expect(shrink(700)).toBe(652);

        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        const grow = props.setPdfViewportWidth.mock.calls[1][0];
        expect(grow(700)).toBe(748);

        fireEvent.click(screen.getByRole('button', { name: /Reset zoom to 100 percent/ }));
        expect(props.setPdfViewportWidth).toHaveBeenLastCalledWith(PDF_VIEWPORT_WIDTH_DEFAULT);
    });

    it('offers Fit Width and Fit Page', () => {
        const { props } = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: /Fit Width/ }));
        fireEvent.click(screen.getByRole('button', { name: /Fit Page/ }));
        expect(props.onFitWidth).toHaveBeenCalledTimes(1);
        expect(props.onFitPage).toHaveBeenCalledTimes(1);
    });

    it('announces page and zoom rather than relying on the visuals', () => {
        renderToolbar({ pdfViewportWidth: 350 });
        expect(screen.getByRole('status')).toHaveTextContent('Page 2 of 5. Zoom 50 percent.');
    });

    it('does not let its own clicks reach the canvas deselect handler', () => {
        const onCanvasClick = vi.fn();
        const { props } = renderToolbar();
        render(
            <div onClick={onCanvasClick}>
                <EditorCanvasToolbar {...props} />
            </div>,
        );
        fireEvent.click(screen.getAllByRole('button', { name: 'Zoom in' })[1]);
        expect(onCanvasClick).not.toHaveBeenCalled();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderToolbar();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('PageThumbnailRail', () => {
    const renderRail = (overrides = {}) => {
        const props = {
            file: { name: 'artificial.pdf' },
            numPages: 3,
            activePage: 2,
            onSelectPage: vi.fn(),
            fieldCountsByPage: { 1: 2, 2: 5 },
            suggestionCountsByPage: {},
            reviewPages: [],
            ...overrides,
        };
        return { props, ...render(<PageThumbnailRail {...props} />) };
    };

    it('lists one entry per page inside a labelled navigation region', () => {
        renderRail();
        const nav = screen.getByRole('navigation', { name: 'Pages' });
        expect(within(nav).getAllByRole('button')).toHaveLength(3);
    });

    it('states the page number and field count in the accessible name', () => {
        renderRail();
        expect(screen.getByRole('button', { name: 'Page 1, 2 fields' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Page 3, 0 fields' })).toBeInTheDocument();
    });

    it('marks the current page with aria-current, not colour alone', () => {
        renderRail();
        expect(screen.getByRole('button', { name: 'Page 2, 5 fields' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Page 1, 2 fields' })).not.toHaveAttribute('aria-current');
    });

    it('jumps to the chosen page', () => {
        const { props } = renderRail();
        fireEvent.click(screen.getByRole('button', { name: 'Page 3, 0 fields' }));
        expect(props.onSelectPage).toHaveBeenCalledExactlyOnceWith(3);
    });

    it('reports AI suggestions and manual-review pages in the accessible name', () => {
        renderRail({ suggestionCountsByPage: { 1: 3 }, reviewPages: [1] });
        expect(
            screen.getByRole('button', { name: 'Page 1, 2 fields, 3 AI suggestions, needs manual review' }),
        ).toBeInTheDocument();
    });

    it('renders thumbnails at navigator size, not canvas size', () => {
        renderRail();
        for (const thumb of screen.getAllByTestId('pdf-thumb')) {
            expect(Number(thumb.dataset.width)).toBeLessThanOrEqual(96);
        }
    });

    it('renders nothing until there is a document with pages', () => {
        expect(renderRail({ numPages: 0 }).container).toBeEmptyDOMElement();
        expect(renderRail({ file: null }).container).toBeEmptyDOMElement();
    });

    it('rasterises only a handful of a long document, not every page', () => {
        // The point of the navigator's laziness: a 40-page packet must not hand
        // 40 pages to react-pdf on mount. Only the pages near the current one
        // render until the observer reports more.
        const observe = vi.fn();
        const original = global.IntersectionObserver;
        global.IntersectionObserver = class {
            constructor() { this.observe = observe; this.disconnect = vi.fn(); }
        };
        try {
            renderRail({ numPages: 40, activePage: 20 });
            const rendered = screen.queryAllByTestId('pdf-thumb');
            expect(rendered.length).toBeGreaterThan(0);
            expect(rendered.length).toBeLessThanOrEqual(5);
            expect(observe).toHaveBeenCalled();
        } finally {
            global.IntersectionObserver = original;
        }
    });

    it('always renders the current page, even before the observer reports', () => {
        renderRail({ numPages: 40, activePage: 12 });
        const pages = screen.getAllByTestId('pdf-thumb').map((node) => Number(node.dataset.page));
        expect(pages).toContain(12);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderRail({ suggestionCountsByPage: { 1: 2 }, reviewPages: [2] });
        expect((await axe(container)).violations).toEqual([]);
    });
});
