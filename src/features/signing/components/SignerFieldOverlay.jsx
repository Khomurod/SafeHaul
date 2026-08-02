import React from 'react';
import { getSignerFieldBoxStyle } from '@features/signing/utils/signerFieldStyle';

const TOUCH_HIT_PX = 44;

/**
 * Positions a field at stored % geometry; expands tap target without changing layout size.
 */
export function SignerFieldOverlay({ field, children, className = '', interactive = true }) {
    const boxStyle = getSignerFieldBoxStyle(field);

    return (
        <div
            data-testid="field-overlay"
            data-field-id={field.id}
            data-field-type={field.type}
            className={`relative ${className}`.trim()}
            style={boxStyle}
        >
            {interactive && (
                <span
                    aria-hidden
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                    style={{
                        minWidth: TOUCH_HIT_PX,
                        minHeight: TOUCH_HIT_PX,
                        width: 'max(100%, 44px)',
                        height: 'max(100%, 44px)',
                    }}
                />
            )}
            <div className="relative z-10 w-full h-full min-w-0 min-h-0">{children}</div>
        </div>
    );
}
