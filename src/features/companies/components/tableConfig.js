export const ALL_COLUMNS = [
    {
        key: 'name',
        label: 'Driver / Contact',
        className: 'text-left align-middle',
        widthClass: 'w-[30%] min-w-[220px]'
    },
    {
        key: 'status',
        label: 'Status',
        className: 'text-center align-middle',
        widthClass: 'w-[12%] min-w-[100px]'
    },
    {
        key: 'lastCall',
        label: 'Last Call',
        className: 'text-center align-middle',
        widthClass: 'w-[15%] min-w-[130px]'
    },
    {
        key: 'qualifications',
        label: 'Position / Type',
        className: 'text-left align-middle',
        widthClass: 'w-[19%] min-w-[180px]'
    },
    {
        key: 'assignee',
        label: 'Recruiter',
        className: 'text-left align-middle',
        widthClass: 'w-[13%] min-w-[120px]'
    },
    {
        key: 'date',
        label: 'Application Date',
        className: 'text-right align-middle',
        widthClass: 'w-[11%] min-w-[110px]'
    }
];

export const DEFAULT_VISIBLE_COLUMNS = ALL_COLUMNS.map(col => col.key);
