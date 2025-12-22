import React from 'react';

const RadioGroup = ({ label, name, options, value, onChange, required = false, horizontal = true }) => {
    const handleChange = (e) => {
        onChange(name, e.target.value);
    };
    return (
        <fieldset className="space-y-2">
            <legend className="block text-sm font-medium text-gray-900">
                {label} {required && <span className="text-red-500">*</span>}
            </legend>
            <div className={'flex ' + (horizontal ? 'space-x-4' : 'flex-col space-y-2')}>
                {options.map(option => (
                    <div key={option.value} className="flex items-center">
                        <input
                            type="radio"
                            id={name + '-' + option.value}
                            name={name}
                            value={option.value}
                            checked={value === option.value}
                            onChange={handleChange}
                            required={required}
                            className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <label htmlFor={name + '-' + option.value} className="ml-2 text-gray-700">
                            {option.label}
                        </label>
                    </div>
                ))}
            </div>
        </fieldset>
    );
};

export default RadioGroup;