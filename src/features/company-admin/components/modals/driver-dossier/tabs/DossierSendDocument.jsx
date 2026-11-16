import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Send } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { useToast } from '@shared/components/feedback';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useTemplateSendFlow } from '@features/company-admin/hooks/useTemplateSendFlow';
import { SendTemplateWizard } from '@features/company-admin/components/documents/SendTemplateWizard';
import { ChooseTemplateDialog } from './ChooseTemplateDialog';

/** After a send the dossier stays on Documents to sign, whose live list shows the new document. */
const stayOnDocuments = () => {};

/**
 * **Send a document** in the dossier's Documents to sign: choose one of the
 * company's templates (`ChooseTemplateDialog`), and E-Docs' own send flow takes
 * over (`useTemplateSendFlow`, `SendTemplateWizard`) with this driver already
 * picked as the recipient, as if picked in the wizard's list: name, email and
 * phone filled in, and the document linked to the record and filled from its
 * listed fields (`recordPrefill.js`). The wizard's steps, checks, writes and
 * messages are E-Docs'; nothing else is sent.
 *
 * Rendered only where E-Docs is offered (`useDossierEDocs`), with that company.
 * `record` is the driver as the wizard's list gives one: its data with `id` and
 * `collectionName`.
 */
export function DossierSendDocument({ company, record }) {
    const navigate = useNavigate();
    const { showSuccess, showError, showWarning } = useToast();
    const isE2EEdocMock = isE2ETestMode && getE2EQueryParam('e2eEdoc', '') === 'mock';
    const [choosing, setChoosing] = useState(false);
    const flow = useTemplateSendFlow({
        currentCompanyProfile: company,
        isE2EEdocMock,
        navigate,
        setActiveTab: stayOnDocuments,
        showSuccess,
        showError,
        showWarning,
    });
    const recipientName = `${record.firstName || ''} ${record.lastName || ''}`.trim();

    const sendTemplate = (template) => {
        setChoosing(false);
        flow.handleUseTemplate(template);
        flow.handleQuickSelect(record);
    };

    return (
        <>
            <Button variant="primary" size="sm" onClick={() => setChoosing(true)}>
                <Icon icon={Send} size="sm" /> Send a document
            </Button>

            {choosing && (
                <ChooseTemplateDialog
                    companyId={company.id}
                    isE2EEdocMock={isE2EEdocMock}
                    recipientName={recipientName}
                    onChoose={sendTemplate}
                    onClose={() => setChoosing(false)}
                />
            )}

            {/* Wired as E-Docs wires it (`views/DocumentsManager.jsx`). */}
            {flow.showDriverPicker && (
                <SendTemplateWizard
                    flow={flow}
                    // Closing mid-send is blocked, as in E-Docs.
                    onClose={() => { if (!flow.sending) flow.setShowDriverPicker(false); }}
                />
            )}
        </>
    );
}

export default DossierSendDocument;
