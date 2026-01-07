import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext();

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((type, message, duration = 4000) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);

    if (duration) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const showSuccess = (msg) => addToast('success', msg);
  const showError = (msg) => addToast('error', msg);
  const showInfo = (msg) => addToast('info', msg);
  const showWarning = (msg) => addToast('warning', msg);

  return (
    <ToastContext.Provider value={{ showSuccess, showError, showInfo, showWarning }}>
      {children}

      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in slide-in-from-right-full duration-300
              ${toast.type === 'success' ? 'bg-white border-green-200 text-gray-800' : ''}
              ${toast.type === 'error' ? 'bg-white border-red-200 text-gray-800' : ''}
              ${toast.type === 'info' ? 'bg-white border-blue-200 text-gray-800' : ''}
              ${toast.type === 'warning' ? 'bg-white border-yellow-200 text-gray-800' : ''}
            `}
            role="alert"
          >
            <div className={`
              shrink-0 rounded-full p-1
              ${toast.type === 'success' ? 'text-green-600 bg-green-50' : ''}
              ${toast.type === 'error' ? 'text-red-600 bg-red-50' : ''}
              ${toast.type === 'info' ? 'text-blue-600 bg-blue-50' : ''}
              ${toast.type === 'warning' ? 'text-yellow-600 bg-yellow-50' : ''}
            `}>
              {toast.type === 'success' && <CheckCircle size={18} />}
              {toast.type === 'error' && <AlertCircle size={18} />}
              {toast.type === 'info' && <Info size={18} />}
              {toast.type === 'warning' && <AlertTriangle size={18} />}
            </div>

            <p className="text-sm font-medium pr-4">{toast.message}</p>

            <button
              onClick={() => removeToast(toast.id)}
              className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
