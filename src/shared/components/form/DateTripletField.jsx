import React from 'react';
import DateSelectField from './DateSelectField';

/**
 * Month / Day / Year dropdowns; the parent gets YYYY-MM-DD once all three are
 * chosen. See `DateSelectField` for the shared behaviour and frozen ids.
 */
export default function DateTripletField(props) {
    return <DateSelectField {...props} precision="day" />;
}
