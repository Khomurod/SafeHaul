import React from 'react';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';

export function GlobalLoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-600">
      <SafeHaulLoader size="h-16 w-16" className="mb-4" />
      <p className="text-xl font-semibold">Loading...</p>
    </div>
  );
}

export default GlobalLoadingState;
