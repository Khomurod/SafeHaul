/**
 * The empty employer row — the employment step's "+ Add Employer" template and
 * the shape a PSP-report suggestion is poured into. One definition, so an import
 * can never produce a row the step would not have produced itself.
 *
 * A plain module rather than an export of `EmploymentHistoryRows.jsx`, because a
 * component file that also exports a constant loses fast refresh.
 *
 * The two 49 CFR 391.21(b)(10)(iv) answers start empty: nothing is pre-selected.
 */
export const EMPTY_EMPLOYER = Object.freeze({
    companyName: '',
    dotNumber: '',
    address: '',
    city: '',
    state: '',
    phone: '',
    companyEmail: '',
    position: '',
    startDate: '',
    endDate: '',
    reasonForLeaving: '',
    supervisorName: '',
    supervisorPhone: '',
    supervisorEmail: '',
    mayContact: '',
    subjectToFmcsrs: '',
    subjectToDotTesting: '',
});
