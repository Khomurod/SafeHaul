import React from 'react';
import DateSelectField from './DateSelectField';

/**
 * Month + year dropdowns; the parent gets YYYY-MM once both are chosen. See
 * `DateSelectField` for the shared behaviour and frozen ids.
 */
export default function MonthYearField(props) {
    return <DateSelectField {...props} precision="month" />;
}
