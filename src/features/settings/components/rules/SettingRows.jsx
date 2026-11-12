import React from 'react';
import { SETTING_HELP, SETTING_ROW_INSET, SETTING_TITLE } from './settingRowStyles';

/*
 * The rows of a settings card (Application questions → Rules and Report
 * uploads): one setting a row, dividers from edge to edge.
 *
 * The list is a size container, so a row lays itself out by the card's width
 * rather than the window's: beside the settings rail at 1366px the card is
 * narrower than on a 1024px tablet without it.
 */
export function SettingRows({ children, className = '' }) {
    return (
        <ul className={`divide-y divide-ds-border-subtle [container-type:inline-size] ${className}`.trim()}>
            {children}
        </ul>
    );
}

/**
 * A setting that is one switch. The switch stands at the end of the title's
 * line at every width, so a long title wraps beside it rather than over it;
 * the help sits under the title, and on a phone runs the row's full width
 * under the switch too. Reading order is title, help, switch.
 *
 * @param {object}    props
 * @param {string}    props.title
 * @param {string}    [props.help]
 * @param {ReactNode} props.control  The `Switch`.
 * @param {ReactNode} [props.note]   A line under the help (a rule changed from its default).
 */
export function SwitchSettingRow({ title, help, control, note, ...props }) {
    return (
        <li
            {...props}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-ds-4 gap-y-ds-1 md:gap-x-ds-6 ${SETTING_ROW_INSET}`}
        >
            <p className={`col-start-1 row-start-1 max-w-[37.5rem] ${SETTING_TITLE}`}>{title}</p>
            {help && <p className={`col-span-2 md:col-span-1 md:col-start-1 ${SETTING_HELP}`}>{help}</p>}
            {note && <div className="col-span-2 md:col-span-1 md:col-start-1">{note}</div>}
            <div className="col-start-2 row-start-1 flex">{control}</div>
        </li>
    );
}
