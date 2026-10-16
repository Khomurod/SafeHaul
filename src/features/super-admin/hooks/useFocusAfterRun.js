import { useEffect, useRef } from 'react';

/**
 * Gives focus back to the button that started a confirmed run, once the run
 * is over.
 *
 * Confirming a run disables its trigger while the run is in flight, so the
 * confirmation dialog's own focus hand-back lands on a disabled button and
 * falls to `<body>`. Set `trigger.current` to the button when the run starts;
 * when `running` turns false it is focused again — unless the operator has
 * since put focus somewhere else, which this never takes away.
 *
 * @param {boolean} running whether the run is in flight
 * @returns {{ current: HTMLElement|null }} the trigger to focus when it ends
 */
export function useFocusAfterRun(running) {
    const trigger = useRef(null);

    useEffect(() => {
        if (running || !trigger.current) return;
        const element = trigger.current;
        trigger.current = null;
        if (!document.activeElement || document.activeElement === document.body) element.focus();
    }, [running]);

    return trigger;
}
