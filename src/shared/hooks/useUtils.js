import { useMemo } from "react";
// One list for every state picker and for the writers that fill them, so a
// value a document produced is always one a picker can show. See usStates.js.
import { US_STATE_NAMES } from "@shared/utils/usStates";

/** The static lists the application's forms share. */
export const useUtils = () => {
    // Static data list of states
    const states = useMemo(() => US_STATE_NAMES, []);

    return { states };
};
