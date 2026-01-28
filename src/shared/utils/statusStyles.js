export const getStatusColor = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('offer') || s.includes('hired') || s.includes('approved')) return 'bg-green-100 text-green-800 border-green-200';
    if (s.includes('rejected') || s.includes('declined')) return 'bg-red-100 text-red-800 border-red-200';
    if (s.includes('new') || s.includes('submitted')) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
};
