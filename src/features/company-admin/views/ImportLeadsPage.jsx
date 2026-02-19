import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { CompanyBulkUpload } from '@features/company-admin/components/CompanyBulkUpload';
import { Upload, ShieldAlert } from 'lucide-react';

export const ImportLeadsPage = () => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const navigate = useNavigate();
    const companyId = currentCompanyProfile?.id;

    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    const handleUploadComplete = () => {
        navigate('/company/drivers/leads/company');
    };

    if (!isCompanyAdmin) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-8">
                <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center border border-gray-200">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <ShieldAlert size={32} className="text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
                    <p className="text-gray-600 mb-6">
                        You do not have permission to import leads. Please contact your Company Admin to request access.
                    </p>
                    <button
                        onClick={() => navigate('/company/dashboard')}
                        className="w-full py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Page Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Upload size={24} className="text-green-600" />
                    Import Leads
                </h1>
                <p className="text-sm text-gray-500">Bulk upload leads from a CSV file.</p>
            </div>

            {/* Upload Content */}
            <div className="flex-1 overflow-auto p-6">
                <div className="max-w-3xl mx-auto">
                    <CompanyBulkUpload
                        companyId={companyId}
                        onClose={() => navigate('/company/dashboard')}
                        onUploadComplete={handleUploadComplete}
                        isEmbedded={true}
                    />
                </div>
            </div>
        </div>
    );
};

export default ImportLeadsPage;
