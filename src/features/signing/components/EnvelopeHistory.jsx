import React, { useState, useEffect } from 'react';
import { db, storage } from '@lib/firebase'; // Import storage
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage'; // Import getDownloadURL
import { FileText, CheckCircle, Clock, Download, ExternalLink, Loader2, AlertCircle } from 'lucide-react';

export default function EnvelopeHistory({ companyId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocs();
  }, [companyId]);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'companies', companyId, 'signing_requests'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDocs(data);
    } catch (error) {
      console.error("Error loading history:", error);
    } finally {
      setLoading(false);
    }
  };

  // NEW: Function to handle secure downloads
  const handleDownload = async (storagePath) => {
      try {
          // If path is gs://, clean it; otherwise use as is
          // Ideally, save the clean 'storagePath' in your doc, but we can handle gs:// too
          let path = storagePath;
          if (storagePath.startsWith('gs://')) {
              // Extract relative path from gs://bucket/path
              const parts = storagePath.split(storage.app.options.storageBucket);
              if (parts[1]) path = parts[1].substring(1); // Remove leading slash
          }

          const fileRef = ref(storage, path);
          const url = await getDownloadURL(fileRef);
          window.open(url, '_blank');
      } catch (err) {
          console.error("Download Error:", err);
          alert("Could not download file. It may have been deleted or moved.");
      }
  };

  const getStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'signed') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200"><CheckCircle size={12}/> Signed</span>;
    if (s === 'sent') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200"><Clock size={12}/> Sent</span>;
    if (s === 'pending_seal') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800 border border-yellow-200"><Loader2 size={12} className="animate-spin"/> Sealing...</span>;
    return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{status}</span>;
  };

  if (loading) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto text-blue-600"/></div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase border-b border-gray-200">
                    <tr>
                        <th className="px-6 py-3">Document Title</th>
                        <th className="px-6 py-3">Recipient</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 text-right">Sent Date</th>
                        <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {docs.length === 0 ? (
                        <tr>
                            <td colSpan="5" className="p-8 text-center text-gray-400">No documents sent yet.</td>
                        </tr>
                    ) : (
                        docs.map((doc) => (
                            <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-2">
                                    <FileText size={16} className="text-blue-500"/> {doc.title || 'Untitled'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                    <div className="font-medium text-gray-900">{doc.recipientName}</div>
                                    <div className="text-xs text-gray-400">{doc.recipientEmail}</div>
                                </td>
                                <td className="px-6 py-4">
                                    {getStatusBadge(doc.status)}
                                </td>
                                <td className="px-6 py-4 text-right text-sm text-gray-500 font-mono">
                                    {doc.createdAt?.seconds ? new Date(doc.createdAt.seconds * 1000).toLocaleDateString() : '--'}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {doc.status === 'signed' ? (
                                        <button 
                                            onClick={() => handleDownload(doc.signedPdfUrl || doc.storagePath)}
                                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors"
                                        >
                                            <Download size={14}/> Download
                                        </button>
                                    ) : (
                                        <button className="text-gray-300 cursor-not-allowed" disabled><ExternalLink size={16}/></button>
                                    )}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    </div>
  );
}