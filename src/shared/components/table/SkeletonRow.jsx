import React from 'react';

/**
 * SkeletonRow - Table loading skeleton with column-width-aware placeholders
 * 
 * @param {number} columns - Number of columns to render
 * @param {number[]} columnWidths - Array of column widths for accurate sizing
 */
export function SkeletonRow({ columns = 6, columnWidths = [] }) {
    const getWidthClass = (index) => {
        // Vary skeleton widths for more realistic appearance
        const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-full', 'w-1/3'];
        return widths[index % widths.length];
    };

    return (
        <tr className="animate-pulse">
            {[...Array(columns)].map((_, index) => (
                <td
                    key={index}
                    className="px-4 py-4"
                    style={columnWidths[index] ? { width: columnWidths[index] } : {}}
                >
                    <div className={`h-4 bg-gray-200 rounded ${getWidthClass(index)}`} />
                    {/* Show second line for name column (first column) */}
                    {index === 0 && (
                        <div className="h-3 bg-gray-100 rounded w-1/2 mt-2" />
                    )}
                </td>
            ))}
        </tr>
    );
}

/**
 * SkeletonTable - Multiple skeleton rows for loading state
 * 
 * @param {number} rows - Number of rows to render
 * @param {number} columns - Number of columns per row
 * @param {number[]} columnWidths - Array of column widths
 */
export function SkeletonTable({ rows = 5, columns = 6, columnWidths = [] }) {
    return (
        <>
            {[...Array(rows)].map((_, index) => (
                <SkeletonRow
                    key={index}
                    columns={columns}
                    columnWidths={columnWidths}
                />
            ))}
        </>
    );
}

export default SkeletonRow;
