import React from 'react';
import { Notice } from '@/design-system/components';

/**
 * What "Finish later" tells the driver about coming back, under the step's
 * buttons until they leave the step.
 *
 * Only what is true of this save. The same browser restores its own copy, at the
 * page it recorded, when the link is opened again, so that is always said.
 * Another device finds the application only through the server copy, by the
 * last name, date of birth, SSN and a contact detail on record, within the 30 days a
 * server copy is kept after its last save — so that line waits for
 * `anotherDevice`, which `useDraftLifecycle.handlePartialSubmit` sets only once
 * the server has confirmed this copy and those facts are on the page.
 */
export function FinishLaterNotice({ anotherDevice = false, className = '' }) {
    return (
        <Notice tone="success" title="Saved. You can finish later." className={className} data-testid="finish-later-notice">
            <p>
                To continue, open the link to this application again on this device and browser.
                You will pick up where you left off.
            </p>
            {anotherDevice && (
                <p className="mt-ds-2">
                    On another phone or computer, open the link and enter the same last name, date of
                    birth, Social Security number and email or phone within 30 days. We will offer to
                    continue this application.
                </p>
            )}
        </Notice>
    );
}

export default FinishLaterNotice;
