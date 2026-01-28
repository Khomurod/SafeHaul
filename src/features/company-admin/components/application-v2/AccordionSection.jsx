import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * AccordionSection - A collapsible section with smooth animations
 * 
 * @param {string} title - Section title
 * @param {string} preview - Preview text shown when collapsed
 * @param {React.ReactNode} icon - Optional icon to display
 * @param {boolean} defaultOpen - Whether to start expanded
 * @param {string} variant - 'default' | 'bordered' | 'filled'
 * @param {React.ReactNode} children - Content to render when expanded
 */
export function AccordionSection({
    title,
    preview,
    icon,
    defaultOpen = false,
    variant = 'default',
    badge,
    children
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const contentRef = useRef(null);
    const [contentHeight, setContentHeight] = useState(defaultOpen ? 'auto' : 0);

    useEffect(() => {
        if (contentRef.current) {
            setContentHeight(isOpen ? contentRef.current.scrollHeight : 0);
        }
    }, [isOpen, children]);

    const variantStyles = {
        default: 'border-b border-gray-100 border-l-4 border-l-gray-200 hover:border-l-blue-400 transition-colors',
        bordered: 'border border-gray-200 rounded-xl mb-3',
        filled: 'bg-gray-50 rounded-xl mb-3 border border-gray-100'
    };

    const headerStyles = {
        default: 'py-4 px-4',
        bordered: 'p-4',
        filled: 'p-4'
    };

    return (
        <div className={variantStyles[variant]}>
            {/* Header - Always Visible */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between gap-4 text-left group transition-colors hover:bg-gray-50/50 ${headerStyles[variant]}`}
                aria-expanded={isOpen}
            >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    {icon && (
                        <span className={`shrink-0 ${isOpen ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'} transition-colors`}>
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <h3 className={`font-semibold ${isOpen ? 'text-gray-900' : 'text-gray-700'} transition-colors`}>
                            {title}
                        </h3>
                        {!isOpen && preview && (
                            <p className="text-sm text-gray-500 truncate mt-0.5">
                                {preview}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {badge && !isOpen && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {badge}
                        </span>
                    )}
                    <ChevronDown
                        size={20}
                        className={`text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                    />
                </div>
            </button>

            {/* Content - Collapsible */}
            <div
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{ maxHeight: isOpen ? contentHeight : 0, opacity: isOpen ? 1 : 0 }}
            >
                <div ref={contentRef} className={variant === 'default' ? 'pb-4' : 'px-4 pb-4'}>
                    {children}
                </div>
            </div>
        </div>
    );
}

export default AccordionSection;
