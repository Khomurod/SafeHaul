import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

/**
 * ResizableColumn - Table column header with resize functionality
 * 
 * @param {string} columnKey - Unique key for localStorage persistence
 * @param {React.ReactNode} children - Header content
 * @param {number} minWidth - Minimum column width (default: 80px)
 * @param {number} defaultWidth - Default column width (default: 150px)
 * @param {number} maxWidth - Maximum column width (default: 400px)
 * @param {'asc' | 'desc' | null} sortDirection - Current sort direction
 * @param {function} onSort - Sort handler
 * @param {function} onWidthChange - Width change handler
 * @param {string} className - Additional CSS classes
 */
export function ResizableColumn({
    columnKey,
    children,
    minWidth = 80,
    defaultWidth = 150,
    maxWidth = 400,
    sortDirection = null,
    onSort,
    onWidthChange,
    className = ''
}) {
    const storageKey = `column-width-${columnKey}`;
    const [width, setWidth] = useState(() => {
        const stored = localStorage.getItem(storageKey);
        return stored ? parseInt(stored, 10) : defaultWidth;
    });
    const [isResizing, setIsResizing] = useState(false);
    const headerRef = useRef(null);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    // Persist width to localStorage
    useEffect(() => {
        localStorage.setItem(storageKey, width.toString());
        onWidthChange?.(columnKey, width);
    }, [width, storageKey, columnKey, onWidthChange]);

    const handleMouseDown = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = width;
    }, [width]);

    const handleMouseMove = useCallback((e) => {
        if (!isResizing) return;
        const delta = e.clientX - startXRef.current;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
        setWidth(newWidth);
    }, [isResizing, minWidth, maxWidth]);

    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
    }, []);

    // Double-click to reset to default
    const handleDoubleClick = useCallback((e) => {
        e.stopPropagation();
        setWidth(defaultWidth);
    }, [defaultWidth]);

    // Attach global mouse events when resizing
    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing, handleMouseMove, handleMouseUp]);

    return (
        <th
            ref={headerRef}
            className={`relative px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200 select-none ${className}`}
            style={{ width: `${width}px`, minWidth: `${minWidth}px`, maxWidth: `${maxWidth}px` }}
        >
            <div
                className={`flex items-center gap-1.5 ${onSort ? 'cursor-pointer hover:text-gray-700' : ''}`}
                onClick={onSort}
            >
                {children}
                {sortDirection && (
                    <span className="text-blue-600">
                        {sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                )}
            </div>

            {/* Resize Handle */}
            <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 hover:opacity-100 hover:bg-blue-400 transition-opacity group"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
                title="Drag to resize, double-click to reset"
            >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
            </div>
        </th>
    );
}

export default ResizableColumn;
