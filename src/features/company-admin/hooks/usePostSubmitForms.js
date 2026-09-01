/**
 * The Documents workspace's post-application forms: which templates an
 * applicant is offered after submitting, in what order, and whether each is
 * required — initialised from `companies/{id}.postApplicationTemplates`,
 * pruned when a template disappears, and saved back as one mapped array.
 * Extracted verbatim from `views/DocumentsManager.jsx`; the view keeps the
 * delete flow and calls `buildPostSubmitConfig` when a deletion has to prune
 * a configured form.
 */

import { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

export function usePostSubmitForms({ currentCompanyProfile, templates, showSuccess, showError }) {
    const [postSubmitTemplateIds, setPostSubmitTemplateIds] = useState([]);
    // templateId -> boolean. Missing key = required (backward-compatible default:
    // post-application forms are required unless explicitly marked optional).
    const [postSubmitRequiredById, setPostSubmitRequiredById] = useState({});
    const [savingPostSubmitTemplates, setSavingPostSubmitTemplates] = useState(false);

    useEffect(() => {
        const raw = Array.isArray(currentCompanyProfile?.postApplicationTemplates)
            ? currentCompanyProfile.postApplicationTemplates
            : [];
        const ids = [];
        const requiredById = {};
        for (const item of raw) {
            let templateId = '';
            let required = true;
            if (typeof item === 'string') {
                templateId = item.trim();
            } else if (item && typeof item === 'object') {
                templateId = String(item.templateId || item.id || '').trim();
                required = item.required !== false;
            }
            if (!templateId) continue;
            ids.push(templateId);
            requiredById[templateId] = required;
        }
        setPostSubmitTemplateIds(ids);
        setPostSubmitRequiredById(requiredById);
    }, [currentCompanyProfile?.postApplicationTemplates]);

    useEffect(() => {
        if (!templates.length) return;
        setPostSubmitTemplateIds((prev) => prev.filter((id) => templates.some((t) => t.id === id)));
    }, [templates]);

    const buildPostSubmitConfig = (ids, requiredById) => ids
        .map((templateId) => {
            const template = templates.find((item) => item.id === templateId);
            if (!template) return null;
            return {
                templateId,
                title: String(template.title || 'Complete Form').trim(),
                enabled: true,
                required: requiredById[templateId] !== false,
            };
        })
        .filter(Boolean);

    const isTemplateEnabledPostSubmit = (templateId) => postSubmitTemplateIds.includes(templateId);

    const togglePostSubmitTemplate = (templateId) => {
        setPostSubmitTemplateIds((prev) => {
            if (prev.includes(templateId)) return prev.filter((id) => id !== templateId);
            return [...prev, templateId];
        });
    };

    const movePostSubmitTemplate = (templateId, direction) => {
        setPostSubmitTemplateIds((prev) => {
            const index = prev.indexOf(templateId);
            if (index < 0) return prev;
            const target = direction === 'up' ? index - 1 : index + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const togglePostSubmitRequired = (templateId) => {
        setPostSubmitRequiredById((prev) => ({
            ...prev,
            [templateId]: prev[templateId] === false,
        }));
    };

    const handleSavePostSubmitTemplates = async () => {
        try {
            setSavingPostSubmitTemplates(true);
            const mapped = buildPostSubmitConfig(postSubmitTemplateIds, postSubmitRequiredById);

            await updateDoc(doc(db, 'companies', currentCompanyProfile.id), {
                postApplicationTemplates: mapped,
            });
            showSuccess('Post-submission forms updated.');
        } catch (error) {
            console.error('[DocumentsManager] Failed saving post-submission forms:', error);
            showError('Could not save post-submission forms. Please try again.');
        } finally {
            setSavingPostSubmitTemplates(false);
        }
    };

    return {
        postSubmitTemplateIds,
        setPostSubmitTemplateIds,
        postSubmitRequiredById,
        savingPostSubmitTemplates,
        buildPostSubmitConfig,
        isTemplateEnabledPostSubmit,
        togglePostSubmitTemplate,
        movePostSubmitTemplate,
        togglePostSubmitRequired,
        handleSavePostSubmitTemplates,
    };
}
