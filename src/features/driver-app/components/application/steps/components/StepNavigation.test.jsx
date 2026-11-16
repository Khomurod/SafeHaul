// The wizard's step footer: "Finish later" saves and then says, under the buttons,
// how the driver comes back — another device only when the save allows it.
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StepNavigation } from './StepNavigation';

const SAME_DEVICE = /open the link to this application again on this device and browser/;
const ANOTHER_DEVICE = /On another phone or computer, open the link and enter the same last name, date of birth, Social Security number and email or phone within 30 days/;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function renderFooter(onSaveDraft) {
    return render(<StepNavigation onBack={vi.fn()} onContinue={vi.fn()} onSaveDraft={onSaveDraft} />);
}

const finishLater = () => fireEvent.click(screen.getByRole('button', { name: 'Finish later' }));

beforeEach(() => {
    vi.resetAllMocks();
});

describe('Finish later', () => {
    it('is offered as "Finish later", and nothing is said before it is pressed', () => {
        renderFooter(vi.fn(() => null));

        expect(screen.getByRole('button', { name: 'Finish later' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save as Draft' })).toBeNull();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('saves, and says in the live region how to come back on this device', async () => {
        const onSaveDraft = vi.fn(() => ({ saved: true, anotherDevice: Promise.resolve(false) }));
        renderFooter(onSaveDraft);

        finishLater();
        await act(async () => {});

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        const status = screen.getByRole('status');
        expect(within(status).getByText('Saved. You can finish later.')).toBeInTheDocument();
        expect(status).toHaveTextContent(SAME_DEVICE);
        expect(status).toHaveTextContent('You will pick up where you left off.');
        expect(status).not.toHaveTextContent(ANOTHER_DEVICE);
    });

    it('adds another device once the save says it can be found there', async () => {
        const server = deferred();
        renderFooter(vi.fn(() => ({ saved: true, anotherDevice: server.promise })));

        finishLater();
        expect(screen.getByRole('status')).not.toHaveTextContent(ANOTHER_DEVICE);

        await act(async () => { server.resolve(true); await server.promise; });

        expect(screen.getByRole('status')).toHaveTextContent(SAME_DEVICE);
        expect(screen.getByRole('status')).toHaveTextContent(ANOTHER_DEVICE);
    });

    it('lets only the latest press add another device', async () => {
        const first = deferred();
        const second = deferred();
        const onSaveDraft = vi.fn()
            .mockReturnValueOnce({ saved: true, anotherDevice: first.promise })
            .mockReturnValueOnce({ saved: true, anotherDevice: second.promise });
        renderFooter(onSaveDraft);

        finishLater();
        finishLater();
        await act(async () => { first.resolve(true); await first.promise; });
        expect(screen.getByRole('status')).not.toHaveTextContent(ANOTHER_DEVICE);

        await act(async () => { second.resolve(false); await second.promise; });
        expect(screen.getByRole('status')).not.toHaveTextContent(ANOTHER_DEVICE);
    });

    it('goes when an answer changes after the save, and its late confirmation does not bring it back', async () => {
        const server = deferred();
        const onSaveDraft = vi.fn(() => ({ saved: true, anotherDevice: server.promise }));
        const answers = { firstName: 'Pat' };
        const { rerender } = render(
            <StepNavigation onBack={vi.fn()} onContinue={vi.fn()} onSaveDraft={onSaveDraft} answers={answers} />,
        );

        finishLater();
        expect(screen.getByRole('status')).toHaveTextContent(SAME_DEVICE);

        // The same answers again (any re-render of the step) keep it.
        rerender(<StepNavigation onBack={vi.fn()} onContinue={vi.fn()} onSaveDraft={onSaveDraft} answers={answers} />);
        expect(screen.getByRole('status')).toHaveTextContent(SAME_DEVICE);

        // An edit is not saved until the next Continue or Finish later.
        rerender(
            <StepNavigation onBack={vi.fn()} onContinue={vi.fn()} onSaveDraft={onSaveDraft} answers={{ firstName: 'Pa' }} />,
        );
        expect(screen.getByRole('status')).toBeEmptyDOMElement();

        await act(async () => { server.resolve(true); await server.promise; });
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('says nothing about coming back when nothing was saved', () => {
        renderFooter(vi.fn(() => null));

        finishLater();

        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('is absent, with its live region, from a step that does not offer it', () => {
        render(<StepNavigation onBack={vi.fn()} onContinue={vi.fn()} />);

        expect(screen.queryByRole('button', { name: 'Finish later' })).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('has no accessibility violations once the notice shows', async () => {
        const { container } = renderFooter(vi.fn(() => ({ saved: true, anotherDevice: Promise.resolve(true) })));

        finishLater();
        await act(async () => {});

        expect(screen.getByRole('status')).toHaveTextContent(ANOTHER_DEVICE);
        expect((await axe(container)).violations).toEqual([]);
    });
});
