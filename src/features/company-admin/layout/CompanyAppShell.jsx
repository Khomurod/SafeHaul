import React from 'react';
import { Outlet } from 'react-router-dom';
import { CompanySidebar } from './CompanySidebar';
import { CompanyTopbar } from './CompanyTopbar';

export const CompanyAppShell = () => {
    return (
        <div className="flex h-screen bg-gray-100 overflow-hidden">
            {/* Sidebar */}
            <CompanySidebar />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <CompanyTopbar />

                <main className="flex-1 overflow-auto bg-gray-50 relative">
                    <div className="min-h-full">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};
