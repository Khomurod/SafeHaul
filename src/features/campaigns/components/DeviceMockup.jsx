import React from 'react';

/**
 * Decorative phone frame used to preview campaign message content.
 *
 * Approved design-system exception, recorded in the roadmap: this is a
 * *simulation* of a physical device, not SafeHaul interface. Two things follow
 * from that, and both are deliberate.
 *
 * **The bezel keeps literal greys.** A `--ds-*` role describes a surface of the
 * SafeHaul interface; a moulded plastic case is not one. Mapping the bezel onto
 * `--ds-color-surface-inverse-subtle` would look identical today and would mean
 * that re-tuning the console surface silently restyles a picture of a phone.
 * The illustration's palette is therefore declared once, here, rather than
 * scattered through the markup as eight anonymous classes.
 *
 * **The status time stays `text-[10px]`.** A real phone status bar is that
 * small, and promoting it to the supported `--ds-*` xs size would make the
 * mockup read as oversized UI rather than as a phone. The 9px/10px ban targets
 * real interface text; nothing here conveys product information.
 *
 * The *screen* is the other way round. What renders inside it is SafeHaul's own
 * preview content, so the screen takes `--ds-color-surface` like any other
 * surface the product draws on.
 *
 * The `dark:` variants this used to carry are gone. They were the only ones in
 * the application, so under an OS dark preference the phone half-inverted while
 * every screen around it stayed light — the mockup was the one element in
 * SafeHaul with an opinion about dark mode.
 */

/** The illustration's own palette. See the note above on why it is not tokenised. */
const DEVICE = {
    body: 'bg-gray-800',
    bodyBorder: 'border-gray-800',
    indicator: 'border-gray-400',
    indicatorFill: 'bg-gray-400',
};

export function DeviceMockup({ children, type = 'sms' }) {
    return (
        <div className={`relative mx-auto h-[600px] w-[300px] rounded-[2.5rem] border-[14px] shadow-ds-lg ${DEVICE.bodyBorder} ${DEVICE.body}`}>
            {/* Side buttons: volume up, volume down, mute, power. */}
            <div className={`absolute -left-[17px] top-[72px] h-[32px] w-[3px] rounded-l-lg ${DEVICE.body}`}></div>
            <div className={`absolute -left-[17px] top-[124px] h-[46px] w-[3px] rounded-l-lg ${DEVICE.body}`}></div>
            <div className={`absolute -left-[17px] top-[178px] h-[46px] w-[3px] rounded-l-lg ${DEVICE.body}`}></div>
            <div className={`absolute -right-[17px] top-[142px] h-[64px] w-[3px] rounded-r-lg ${DEVICE.body}`}></div>

            {/* Screen. This one *is* a SafeHaul surface — the preview draws on it. */}
            <div className="h-full w-full overflow-hidden rounded-[2rem] bg-ds-surface">
                {/* Status Bar. Hidden from assistive technology: a simulated clock
                    read aloud before the message is noise, and the battery shapes
                    say nothing. The message itself stays in the accessibility tree. */}
                <div aria-hidden="true" className="flex h-6 items-center justify-between px-6 pt-2">
                    <span className="text-[10px] font-bold">9:41</span>
                    <div className="flex items-center gap-1">
                        <div className={`h-2 w-3 rounded-sm border ${DEVICE.indicator}`}></div>
                        <div className={`h-2 w-2 rounded-ds-full ${DEVICE.indicatorFill}`}></div>
                    </div>
                </div>

                {/* Content */}
                <div className="h-full overflow-y-auto pb-10">
                    {children}
                </div>
            </div>
        </div>
    );
}
