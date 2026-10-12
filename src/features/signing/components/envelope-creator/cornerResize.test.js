/**
 * The corner handle's resize gesture: it follows the pointer that pressed the
 * handle until that press ends, never below 8px, and reports only a size that
 * changed.
 */
import { describe, expect, it, vi } from 'vitest';
import { startCornerResize } from './cornerResize';

function press(start = { width: 100, height: 40 }) {
    const sizeRef = { current: start };
    const setSize = vi.fn();
    const onResized = vi.fn();
    const event = { pointerId: 1, clientX: 50, clientY: 50, stopPropagation: vi.fn() };
    startCornerResize(event, sizeRef, setSize, onResized);
    return { sizeRef, setSize, onResized, event };
}
const move = (x, y, pointerId = 1) => window.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX: x, clientY: y }));
const end = (type = 'pointerup', pointerId = 1) => window.dispatchEvent(new PointerEvent(type, { pointerId }));

describe('startCornerResize', () => {
    it('follows the pointer and reports the size the press ended at', () => {
        const { sizeRef, setSize, onResized, event } = press();
        move(80, 60);
        expect(setSize).toHaveBeenLastCalledWith({ width: 130, height: 50 });
        end();

        expect(event.stopPropagation).toHaveBeenCalled();
        expect(sizeRef.current).toEqual({ width: 130, height: 50 });
        expect(onResized).toHaveBeenCalledWith(130, 50);
    });

    it('never shrinks the box below 8px', () => {
        const { onResized } = press();
        move(-500, -500);
        end();
        expect(onResized).toHaveBeenCalledWith(8, 8);
    });

    it('reports nothing when the size did not change', () => {
        const { onResized } = press();
        end();
        expect(onResized).not.toHaveBeenCalled();
    });

    it('ends on a cancelled press too, and then stops following', () => {
        const { setSize, onResized } = press();
        move(60, 50);
        end('pointercancel');
        expect(onResized).toHaveBeenCalledWith(110, 40);

        setSize.mockClear();
        move(500, 500);
        end();
        expect(setSize).not.toHaveBeenCalled();
        expect(onResized).toHaveBeenCalledTimes(1);
    });

    it('follows only the pointer that pressed the handle, so a second finger changes nothing', () => {
        const { setSize, onResized } = press();
        move(500, 500, 2);
        end('pointerup', 2);
        expect(setSize).not.toHaveBeenCalled();
        expect(onResized).not.toHaveBeenCalled();

        move(80, 60);
        end();
        expect(onResized).toHaveBeenCalledWith(130, 50);
    });
});
