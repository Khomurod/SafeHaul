/**
 * After a confirmed run, focus goes back to the button that started it — and
 * never away from wherever the operator has put it since.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusAfterRun } from './useFocusAfterRun';

function button(name) {
    const element = document.createElement('button');
    element.textContent = name;
    document.body.appendChild(element);
    return element;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('useFocusAfterRun', () => {
    it('focuses the trigger when the run ends with focus on <body>', () => {
        const trigger = button('Run');
        const { result, rerender } = renderHook(({ running }) => useFocusAfterRun(running), {
            initialProps: { running: false },
        });

        result.current.current = trigger;
        rerender({ running: true });
        expect(document.activeElement).toBe(document.body);

        rerender({ running: false });
        expect(document.activeElement).toBe(trigger);
        expect(result.current.current).toBeNull();
    });

    it('leaves focus where the operator put it during the run', () => {
        const trigger = button('Run');
        const elsewhere = button('Something else');
        const { result, rerender } = renderHook(({ running }) => useFocusAfterRun(running), {
            initialProps: { running: false },
        });

        result.current.current = trigger;
        rerender({ running: true });
        elsewhere.focus();
        rerender({ running: false });

        expect(document.activeElement).toBe(elsewhere);
    });

    it('does nothing for a run it was not given a trigger for', () => {
        button('Run');
        const { rerender } = renderHook(({ running }) => useFocusAfterRun(running), {
            initialProps: { running: true },
        });

        rerender({ running: false });
        expect(document.activeElement).toBe(document.body);
    });
});
