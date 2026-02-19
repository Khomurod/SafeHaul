import React from 'react';

export function DeviceMockup({ children, type = 'sms' }) {
    return (
        <div className="relative mx-auto border-gray-800 dark:border-gray-800 bg-gray-800 border-[14px] rounded-[2.5rem] h-[600px] w-[300px] shadow-xl">
            <div className="h-[32px] w-[3px] bg-gray-800 absolute -left-[17px] top-[72px] rounded-l-lg"></div>
            <div className="h-[46px] w-[3px] bg-gray-800 absolute -left-[17px] top-[124px] rounded-l-lg"></div>
            <div className="h-[46px] w-[3px] bg-gray-800 absolute -left-[17px] top-[178px] rounded-l-lg"></div>
            <div className="h-[64px] w-[3px] bg-gray-800 absolute -right-[17px] top-[142px] rounded-r-lg"></div>
            <div className="rounded-[2rem] overflow-hidden w-full h-full bg-white dark:bg-gray-900">
                {/* Status Bar */}
                <div className="h-6 flex justify-between items-center px-6 pt-2">
                    <span className="text-[10px] font-bold dark:text-white">9:41</span>
                    <div className="flex gap-1 items-center">
                        <div className="w-3 h-2 border border-gray-400 rounded-sm"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                    </div>
                </div>

                {/* Content */}
                <div className="h-full overflow-y-auto pb-10">
                    {children}
                </div>
            </div>
        </div>
    );
}
