import React, { useCallback, useMemo } from 'react';
import { MinusCircle, PlusCircle } from 'lucide-react';

const DynamicRow = ({ listKey, formData, updateFormData, renderRow, initialItemState, addButtonLabel }) => {
    const list = useMemo(() => {
        const data = formData[listKey];
        return Array.isArray(data) ? data : [];
    }, [formData, listKey]);

    const handleChange = useCallback((index, fieldName, value) => {
        const newList = [...list];
        newList[index] = {
            ...newList[index],
            [fieldName]: value,
        };
        updateFormData(listKey, newList);
    }, [list, updateFormData, listKey]);

    const handleDelete = useCallback((index) => {
        const newList = list.filter((_, i) => i !== index);
        updateFormData(listKey, newList);
    }, [list, updateFormData, listKey]);

    const handleAdd = useCallback(() => {
        const newItem = { ...initialItemState, id: Date.now() }; // Add unique ID for React keys
        updateFormData(listKey, [...list, newItem]);
    }, [list, updateFormData, listKey, initialItemState]);

    return (
        <div className="space-y-4">
            <div id={listKey + '-container'} className="space-y-4">
                {list.map((item, index) => (
                    <div key={item.id || index} className="dynamic-row border border-gray-200 rounded-lg p-4 space-y-3 relative shadow-sm">
                        {renderRow(index, item, (fieldName, value) => handleChange(index, fieldName, value))}
                        <button 
                            type="button" 
                            onClick={() => handleDelete(index)}
                            className="absolute top-2 right-2 text-red-500 hover:text-red-700 p-1 rounded-full bg-white transition duration-150"
                            aria-label={'Remove ' + addButtonLabel.replace('Add', '') + ' #' + (index + 1)}
                        >
                            <MinusCircle size={20} />
                        </button>
                    </div>
                ))}
            </div>
            <button 
                type="button" 
                onClick={handleAdd}
                className="flex items-center space-x-2 text-sm font-medium text-blue-600 hover:text-blue-800 transition duration-150"
            >
                <PlusCircle size={16} />
                <span>{addButtonLabel}</span>
            </button>
        </div>
    );
};

export default DynamicRow;