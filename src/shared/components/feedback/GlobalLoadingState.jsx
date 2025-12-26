import React from 'react';
import { Loader2 } from 'lucide-react';

export function GlobalLoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-600">
      <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
      <p className="text-xl font-semibold">Loading...</p>
    </div>
  );
}

export default GlobalLoadingState;
