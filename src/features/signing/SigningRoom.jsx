import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { initializeSignatureCanvas, clearCanvas, isCanvasEmpty, getSignatureDataUrl } from '@lib/signature';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2, CheckCircle, PenTool, X, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// FIX PDF WORKER FOR VITE
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function SigningRoom() {
  const { companyId, requestId } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get('token'); 
  
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(null);
  
  // Data State
  const [fieldValues, setFieldValues] = useState({}); 
  const [activeSignatureField, setActiveSignatureField] = useState(null); 
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // 1. Load Document
  useEffect(() => {
    async function load() {
      if (!accessToken) {
          setError("Invalid Link: No access token provided.");
          setLoading(false);
          return;
      }

      try {
        const getEnvelopeFn = httpsCallable(functions, 'getPublicEnvelope');
        const result = await getEnvelopeFn({ 
            companyId, 
            requestId, 
            accessToken 
        });
        
        const data = result.data;
        if (data.status === 'signed') {
            setSuccess(true);
            setLoading(false);
            return;
        }
        setRequest(data);
        
        // Initialize fields if needed
        const initial = {};
        if (data.fields) {
            data.fields.forEach(f => {
                initial[f.id] = f.type === 'checkbox' ? false : '';
            });
        }
        setFieldValues(initial);

      } catch (err) {
        console.error("Load Error:", err);
        setError("Document not found or link expired.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [companyId, requestId, accessToken]);

  // Init signature pad when modal opens
  useEffect(() => {
    if (activeSignatureField) setTimeout(initializeSignatureCanvas, 100);
  }, [activeSignatureField]);

  const handleFieldChange = (id, value) => {
      setFieldValues(prev => ({ ...prev, [id]: value }));
  };

  const handleSaveSignature = async () => {
    if (isCanvasEmpty()) return alert("Please sign first.");
    const sigData = getSignatureDataUrl();
    handleFieldChange(activeSignatureField, sigData);
    setActiveSignatureField(null);
  };

  const handleFinishSigning = async () => {
    // Basic validation
    const missing = request.fields?.filter(f => f.required && !fieldValues[f.id]);
    if (missing && missing.length > 0) {
        alert("Please complete all required fields (Signature, etc).");
        return;
    }

    setSubmitting(true);
    try {
        const auditData = {
            ip: '127.0.0.1', 
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
        };

        const submitFn = httpsCallable(functions, 'submitPublicEnvelope');
        await submitFn({
            companyId,
            requestId,
            accessToken,
            fieldValues, 
            auditData
        });

        setSuccess(true);
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

    } catch (e) {
        console.error("Submission Error:", e);
        alert("Error saving document: " + e.message);
    } finally {
        setSubmitting(false);
    }
  };

  if (loading) return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="animate-spin text-blue-600 mb-2" size={40}/>
          <p className="text-gray-500 font-medium ml-3">Loading secure document...</p>
      </div>
  );

  if (error) return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-lg border border-red-100 text-center max-w-md">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle size={32}/>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h3>
              <p className="text-gray-600">{error}</p>
          </div>
      </div>
  );

  if (success) return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-xl border border-green-100 text-center max-w-md animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle size={48}/>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Document Signed!</h2>
              <p className="text-gray-600 mb-6">
                  Thank you. The document has been securely sealed and sent to the sender.
              </p>
              <button onClick={() => window.close()} className="text-blue-600 font-semibold hover:underline">
                  Close Window
              </button>
          </div>
      </div>
  );

  // Helper: Render individual field
  const renderField = (field) => {
     // Use percentages for perfect scaling
     const style = {
        left: `${field.xPosition}%`,
        top: `${field.yPosition}%`,
        width: `${field.width}%`,
        height: `${field.height}%`,
        position: 'absolute',
        transform: 'translate(0, 0)',
        zIndex: 20
     };

     // Render based on type
     if (field.type === 'signature') {
         const isSigned = !!fieldValues[field.id];
         return (
            <div 
                style={style}
                onClick={() => setActiveSignatureField(field.id)}
                className={`cursor-pointer border-2 border-dashed rounded flex flex-col items-center justify-center shadow-sm transition-all
                    ${isSigned 
                        ? 'bg-yellow-100/90 border-yellow-600' 
                        : 'bg-yellow-400/80 border-yellow-600 animate-pulse hover:bg-yellow-300'
                    }`}
            >
                {isSigned ? (
                    <>
                        <CheckCircle size={16} className="text-yellow-800"/>
                        <span className="text-[8px] font-bold text-yellow-900 uppercase">Signed</span>
                    </>
                ) : (
                    <>
                        <PenTool size={16} className="text-yellow-900"/>
                        <span className="text-[8px] font-bold text-yellow-900 uppercase">Sign</span>
                    </>
                )}
            </div>
         );
     }

     if (field.type === 'checkbox') {
         return (
             <div style={style} className="flex items-center justify-center">
                 <input 
                    type="checkbox" 
                    className="w-full h-full cursor-pointer accent-purple-600"
                    checked={!!fieldValues[field.id]}
                    onChange={(e) => handleFieldChange(field.id, e.target.checked)}
                 />
             </div>
         );
     }

     if (field.type === 'date') {
         return (
             <input 
                type="date"
                style={style}
                className="border-2 border-green-500 bg-green-50/90 text-xs px-1 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={fieldValues[field.id] || ''}
                onChange={(e) => handleFieldChange(field.id, e.target.value)}
             />
         );
     }

     // Default: Text
     return (
         <input 
            type="text"
            style={style}
            className="border-2 border-blue-500 bg-blue-50/90 text-sm px-2 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-blue-300"
            placeholder="Type here..."
            value={fieldValues[field.id] || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
         />
     );
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
        <header className="bg-white p-4 shadow-sm flex justify-between items-center sticky top-0 z-30">
            <div>
                <h1 className="font-bold text-gray-800 text-sm sm:text-base">{request?.title || 'Document'}</h1>
                <p className="text-xs text-gray-500">Recipient: {request?.recipientEmail}</p>
            </div>
            
            <button 
                onClick={handleFinishSigning} 
                disabled={submitting} 
                className="px-4 py-2 bg-green-600 text-white font-bold rounded-lg shadow hover:bg-green-700 transition flex items-center gap-2 disabled:opacity-50 text-sm"
            >
                {submitting ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle size={16}/>} 
                Finish & Submit
            </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center bg-gray-200/50">
            <Document 
                file={request.pdfUrl} 
                onLoadSuccess={({numPages}) => setNumPages(numPages)} 
                className="flex flex-col gap-6"
                loading={<Loader2 className="animate-spin text-gray-400 mt-20" size={40} />}
            >
                {Array.from(new Array(numPages), (el, index) => (
                    <div key={index} className="relative shadow-xl border border-gray-300 bg-white">
                        <Page 
                            pageNumber={index + 1} 
                            // DYNAMIC WIDTH: Fits mobile screens, maxes out at 800px
                            width={Math.min(window.innerWidth - 32, 800)} 
                            renderAnnotationLayer={false} 
                            renderTextLayer={false}
                        />
                        {/* Render fields for this page */}
                        {request?.fields?.filter(f => f.pageNumber === index + 1).map(field => (
                            <React.Fragment key={field.id}>
                                {renderField(field)}
                            </React.Fragment>
                        ))}
                    </div>
                ))}
            </Document>
        </main>

        {/* Signature Modal */}
        {activeSignatureField && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                    <div className="bg-gray-50 p-4 border-b flex justify-between items-center"><h3 className="font-bold text-gray-700">Draw Your Signature</h3><button onClick={() => setActiveSignatureField(null)}><X size={20}/></button></div>
                    <div className="p-6 text-center">
                         <div className="border-2 border-dashed border-gray-300 rounded bg-white mb-4 relative"><canvas id="signature-canvas" className="w-full h-40 touch-none cursor-crosshair"></canvas><button id="clear-signature" onClick={clearCanvas} className="absolute bottom-2 right-2 text-xs text-red-500 bg-white border border-gray-200 px-2 py-1 rounded">Clear</button></div>
                         <p className="text-xs text-gray-400">By clicking "Adopt", I agree this is my legal signature.</p>
                    </div>
                    <div className="p-4 bg-gray-50 flex justify-end gap-2 border-t"><button onClick={() => setActiveSignatureField(null)} className="px-4 py-2 text-gray-600 font-medium">Cancel</button><button onClick={handleSaveSignature} className="px-6 py-2 bg-blue-600 text-white font-bold rounded shadow hover:bg-blue-700">Adopt Signature</button></div>
                </div>
            </div>
        )}
    </div>
  );
}