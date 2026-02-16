import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { DriverSearchModal } from '@features/drivers/components/DriverSearchModal';
import { Search, Lock } from 'lucide-react';

export const SearchDriversPage = () => {
    const { currentCompanyProfile } = useData();
    const navigate = useNavigate();
    const [showSearch, setShowSearch] = React.useState(false);

    const hasAccess = currentCompanyProfile?.features?.searchDB === true;

    React.useEffect(() => {
        if (hasAccess) {
            setShowSearch(true);
        }
    }, [hasAccess]);

    if (!hasAccess) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-8">
                <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center border border-gray-200">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Lock size={32} className="text-amber-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Feature Locked</h2>
                    <p className="text-gray-600 mb-6">
                        The "Search for Drivers" feature is not enabled for your company.
                        Please contact your account representative to unlock this feature.
                    </p>
                    <button
                        onClick={() => navigate('/company/drivers/leads/safehaul')}
                        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                    >
                        Browse SafeHaul Leads Instead
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
                    <Search size={24} className="text-blue-600" />
                    Search for Drivers
                </h1>
                <p className="text-sm text-gray-500">Search the SafeHaul database for qualified driver candidates.</p>
            </div>

            {/* Search Content */}
            <div className="flex-1 overflow-auto p-6">
                {showSearch && (
                    <DriverSearchModal
                        onClose={() => navigate('/company/dashboard')}
                        isEmbedded={true}
                    />
                )}
            </div>
        </div>
    );
};

export default SearchDriversPage;
