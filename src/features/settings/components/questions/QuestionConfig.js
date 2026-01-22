import {
    AlignLeft, AlignJustify, CheckSquare, List, Circle,
    UploadCloud, Calendar, Clock, Hash, Grid
} from 'lucide-react';

export const QUESTION_TYPES = [
    {
        id: 'shortAnswer',
        label: 'Short Answer',
        icon: AlignLeft,
        description: 'Single line text input for simple responses.'
    },
    {
        id: 'paragraph',
        label: 'Paragraph',
        icon: AlignJustify,
        description: 'Multi-line text area for detailed explanations.'
    },
    {
        id: 'multipleChoice',
        label: 'Multiple Choice',
        icon: Circle,
        description: 'Select one option from a list (Radio buttons).'
    },
    {
        id: 'checkboxes',
        label: 'Checkboxes',
        icon: CheckSquare,
        description: 'Select multiple options from a list.'
    },
    {
        id: 'dropdown',
        label: 'Dropdown',
        icon: List,
        description: 'Select one option from a dropdown menu.'
    },
    {
        id: 'number',
        label: 'Number',
        icon: Hash,
        description: 'Numeric input for quantities, ages, etc.'
    },
    {
        id: 'fileUpload',
        label: 'File Upload',
        icon: UploadCloud,
        description: 'Allow applicants to upload documents or images.'
    },
    {
        id: 'date',
        label: 'Date',
        icon: Calendar,
        description: 'Date picker input.'
    },
    {
        id: 'time',
        label: 'Time',
        icon: Clock,
        description: 'Time picker input.'
    },
    {
        id: 'linearScale',
        label: 'Linear Scale',
        icon: Grid,
        description: 'Rating scale (e.g., 1 to 5).'
    }
];

export const INITIAL_QUESTION_STATE = {
    id: '',
    type: 'shortAnswer',
    label: '',
    required: false,
    options: ['Option 1'],
    helpText: '',
    min: 1,
    max: 5,
    minLabel: 'Poor',
    maxLabel: 'Excellent',
    // DOT/FMCSA Compliance Fields
    dotRequired: false,
    fmcsaReference: '',
    canCompanyHide: true,
    canCompanyModify: true
};

export const hasOptions = (type) => {
    return ['multipleChoice', 'checkboxes', 'dropdown'].includes(type);
};
