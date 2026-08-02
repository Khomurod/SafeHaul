import React, { useCallback, useMemo } from 'react';
import { MinusCircle, PlusCircle } from 'lucide-react';
import { Button, IconButton } from '@/design-system/components';

/**
 * Repeating row list for the driver application (violations, accidents,
 * employers, addresses, schools, military service, employment gaps).
 *
 * Presentation is migrated to the approved `Button` / `IconButton` primitives
 * and `--ds-*` tokens. Every data contract is unchanged: the functional
 * `updateFormData(listKey, updater)` writes, the `Date.now()` row `id`, the
 * `${listKey}-container` element id, the `renderRow(index, item, handleChange)`
 * signature, and the "Remove <label> #<n>" accessible action name.
 *
 * The heading is `<h3>` because the wizard's step title is the page `<h1>` and
 * each step's `FormSection` heading is `<h2>`.
 */
const DynamicRow = ({ listKey, formData, updateFormData, renderRow, initialItemState, addButtonLabel, title }) => {
    const list = useMemo(() => {
        const data = formData[listKey];
        return Array.isArray(data) ? data : [];
    }, [formData, listKey]);

    // Functional updates avoid stale `list` when children fire several onChange calls in one tick
    // (e.g. FMCSA employer pick applies companyName, dotNumber, address, city, state in sequence).
    const handleChange = useCallback((index, fieldName, value) => {
        updateFormData(listKey, (currentList) => {
            const base = Array.isArray(currentList) ? currentList : [];
            const newList = [...base];
            newList[index] = {
                ...newList[index],
                [fieldName]: value,
            };
            return newList;
        });
    }, [updateFormData, listKey]);

    const handleDelete = useCallback((index) => {
        updateFormData(listKey, (currentList) => {
            const base = Array.isArray(currentList) ? currentList : [];
            return base.filter((_, i) => i !== index);
        });
    }, [updateFormData, listKey]);

    const handleAdd = useCallback(() => {
        const newItem = { ...initialItemState, id: Date.now() }; // Add unique ID for React keys
        updateFormData(listKey, (currentList) => {
            const base = Array.isArray(currentList) ? currentList : [];
            return [...base, newItem];
        });
    }, [updateFormData, listKey, initialItemState]);

    const itemNoun = (addButtonLabel || 'Item').replace('Add', '').replace('+', '').trim() || 'Item';

    return (
        <div className="space-y-ds-4">
            {title && <h3 className="text-ds-body-lg font-semibold text-ds-content">{title}</h3>}
            <div id={listKey + '-container'} className="space-y-ds-4">
                {list.map((item, index) => (
                    <div
                        key={item.id || index}
                        className="dynamic-row relative space-y-ds-3 rounded-ds-lg border border-ds-border-subtle bg-ds-surface p-ds-4 pr-ds-12 shadow-ds-xs"
                    >
                        {renderRow(index, item, (fieldName, value) => handleChange(index, fieldName, value))}
                        <IconButton
                            variant="ghost"
                            size="md"
                            className="absolute right-ds-2 top-ds-2"
                            label={'Remove ' + itemNoun + ' #' + (index + 1)}
                            onClick={() => handleDelete(index)}
                        >
                            <MinusCircle size={20} aria-hidden="true" />
                        </IconButton>
                    </div>
                ))}
            </div>
            <Button variant="ghost" size="md" onClick={handleAdd}>
                <PlusCircle size={16} aria-hidden="true" />
                <span>{addButtonLabel}</span>
            </Button>
        </div>
    );
};

export default DynamicRow;
