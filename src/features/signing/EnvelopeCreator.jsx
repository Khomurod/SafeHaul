import React, { useState, useRef } from 'react';
import { db, storage, auth } from '@lib/firebase';
import { ref, uploadBytes } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Document, Page, pdfjs } from 'react-pdf';
import Draggable from 'react-draggable';
import { Loader2, UploadCloud, Save, X, Plus, Type, Calendar, CheckSquare, PenTool, Copy } from 'lucide-react';

// Fix PDF Worker for Vite
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function EnvelopeCreator({ companyId, onClose }) {
  const [file, setFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [title, setTitle] = useState('');
  
  // Fields State
  const [fields, setFields] = useState([]);
  const pageRefs = useRef({});

  // 1. File Selection
  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.type === 'application/pdf') {
      setFile(selected);
      setTitle(selected.name.replace('.pdf', ''));
    } else {
      alert("Please upload a valid PDF.");
    }
  };

  // 2. Add Field Helper
  const addField = (type) => {
    if (!file) return;
    
    // Default Dimensions (Approximate % for initial placement)
    let w = 20, h = 5;
    if (type === 'checkbox') { w = 3; h = 2; }
    if (type === 'text') { w = 25; h = 4; }

    const newField = {
        id: Date.now().toString(),
        type,
        page: 1, 
        x: 40, y: 40, 
        w, h
    };

    setFields([...fields, newField]);
  };

  const removeField = (id) => {
      setFields(fields.filter(f => f.id !== id));
  };

  // 3. Handle Drag Stop - Passed to Child
  const onFieldStop = (e, data, fieldId, pageNumber) => {
     const node = data.node; 
     const parent = node.offsetParent; 
     if (!parent) return;

     const parentWidth = parent.offsetWidth;
     const parentHeight = parent.offsetHeight;
     
     const xPercent = (data.x / parentWidth) * 100;
     const yPercent = (data.y / parentHeight) * 100;

     const wPercent = (node.offsetWidth / parentWidth) * 100;
     const hPercent = (node.offsetHeight / parentHeight) * 100;

     setFields(prev => prev.map(f => {
         if (f.id === fieldId) {
             return { ...f, page: pageNumber, x: xPercent, y: yPercent, w: wPercent, h: hPercent };
         }
         return f;
     }));
  };

  // 4. Submit
  const handleSend = async () => {
    if (!file || !recipientEmail || fields.length === 0) {
        alert("Please add at least one field and set a recipient.");
        return;
    }

    setLoading(true);
    try {
        // Upload Original PDF
        const storagePath = `secure_documents/${companyId}/originals/${Date.now()}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);

        // Generate Secure Token
        const accessToken = crypto.randomUUID();

        const docData = {
            companyId,
            recipientEmail,
            recipientName,
            title,
            status: 'sent',
            createdAt: serverTimestamp(),
            storagePath, 
            accessToken, // <--- CRITICAL FIX: SAVING THE TOKEN
            fields: fields.map(f => ({
                id: f.id,
                type: f.type,
                pageNumber: f.page,
                xPosition: f.x, 
                yPosition: f.y, 
                width: f.w,
                height: f.h,
                required: true 
            })),
            senderId: auth.currentUser.uid,
            recipientId: null 
        };

        const docRef = await addDoc(collection(db, 'companies', companyId, 'signing_requests'), docData);
        
        // Show Success & Link
        const link = `${window.location.origin}/sign/${companyId}/${docRef.id}?token=${accessToken}`;
        
        // We use a prompt so you can easily copy it
        prompt("Document Sent! Here is the direct signing link for testing:", link);
        
        if(onClose) onClose();

    } catch (err) {
        console.error("Error sending:", err);
        alert("Failed to send.");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      <div className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm z-20">
        <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
            <UploadCloud className="text-blue-600" /> New Envelope
        </h2>
        <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button 
                onClick={handleSend}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
            >
                {loading ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                Send Document
            </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 bg-white border-r p-6 overflow-y-auto z-10 shadow-lg flex flex-col gap-6">
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">1. Upload PDF</label>
                <div className="flex items-center gap-2">
                     <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition w-full text-center border border-gray-300">
                        {file ? 'Change File' : 'Choose PDF'}
                        <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
                     </label>
                </div>
                {file && <p className="text-xs text-green-600 mt-2 font-medium truncate">{file.name}</p>}
            </div>

            {file && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500 space-y-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">2. Recipient</label>
                        <input 
                            type="text" placeholder="Driver Name" 
                            className="w-full mb-2 p-2 text-sm border rounded bg-gray-50 focus:bg-white transition"
                            value={recipientName} onChange={e => setRecipientName(e.target.value)}
                        />
                        <input 
                            type="email" placeholder="driver@email.com" 
                            className="w-full p-2 text-sm border rounded bg-gray-50 focus:bg-white transition"
                            value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">3. Place Fields</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => addField('signature')} className="flex items-center justify-center gap-2 py-3 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg text-xs font-bold hover:bg-yellow-100">
                                <PenTool size={16}/> Signature
                            </button>
                            <button onClick={() => addField('text')} className="flex items-center justify-center gap-2 py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100">
                                <Type size={16}/> Text
                            </button>
                            <button onClick={() => addField('date')} className="flex items-center justify-center gap-2 py-3 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-bold hover:bg-green-100">
                                <Calendar size={16}/> Date
                            </button>
                            <button onClick={() => addField('checkbox')} className="flex items-center justify-center gap-2 py-3 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-bold hover:bg-purple-100">
                                <CheckSquare size={16}/> Checkbox
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2 text-center">Drag fields to position them.</p>
                    </div>
                </div>
            )}
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-200 p-8 flex justify-center relative">
            {!file && (
                <div className="flex flex-col items-center justify-center text-gray-400 mt-20">
                    <UploadCloud size={64} className="mb-4 opacity-50"/>
                    <p className="text-lg font-medium">Upload a PDF to begin</p>
                </div>
            )}

            {file && (
                <Document
                    file={file}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    className="flex flex-col gap-6"
                    loading={<Loader2 className="animate-spin text-gray-400 mt-10" />}
                >
                    {Array.from(new Array(numPages), (el, index) => {
                        const pageNum = index + 1;
                        const pageFields = fields.filter(f => f.page === pageNum);

                        return (
                            <div 
                                key={pageNum} 
                                className="relative shadow-xl border border-gray-300 bg-white"
                                ref={el => pageRefs.current[index] = el}
                                style={{ width: 'fit-content' }} 
                            >
                                <Page 
                                    pageNumber={pageNum} 
                                    width={700} 
                                    renderAnnotationLayer={false}
                                    renderTextLayer={false}
                                />
                                
                                <div className="absolute inset-0 z-10 pointer-events-none">
                                    {pageFields.map(field => (
                                        <DraggableField
                                            key={field.id}
                                            field={field}
                                            pageNum={pageNum}
                                            pageWidth={700}
                                            pageHeight={pageRefs.current[index]?.offsetHeight || 900}
                                            onStop={onFieldStop}
                                            onRemove={removeField}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </Document>
            )}
        </div>
      </div>
    </div>
  );
}

// --- DRAGGABLE COMPONENT (Fixes React 19 "findDOMNode" Error) ---
const DraggableField = ({ field, pageNum, pageWidth, pageHeight, onStop, onRemove }) => {
    const nodeRef = useRef(null);

    // Calculate initial pixel position from percentage
    const initialX = (field.x / 100) * pageWidth;
    const initialY = (field.y / 100) * pageHeight;

    const getFieldIcon = (type) => {
        switch(type) {
            case 'text': return <Type size={14}/>;
            case 'date': return <Calendar size={14}/>;
            case 'checkbox': return <CheckSquare size={14}/>;
            default: return <PenTool size={14}/>;
        }
    };

    const getFieldLabel = (type) => {
        switch(type) {
            case 'text': return 'Text';
            case 'date': return 'Date';
            case 'checkbox': return 'Check';
            default: return 'Sign';
        }
    };

    return (
        <Draggable
            nodeRef={nodeRef}
            bounds="parent"
            defaultPosition={{ x: initialX, y: initialY }}
            onStop={(e, data) => onStop(e, data, field.id, pageNum)}
        >
            <div 
                ref={nodeRef}
                className={`absolute cursor-move pointer-events-auto border-2 rounded flex items-center justify-center shadow-md transition group
                    ${field.type === 'signature' ? 'bg-yellow-400/80 border-yellow-600 text-yellow-900' : 
                      field.type === 'checkbox' ? 'bg-purple-200/80 border-purple-600 text-purple-900' : 
                      'bg-blue-200/80 border-blue-600 text-blue-900'}`}
                style={{ 
                    width: `${field.w}%`, 
                    height: `${field.h}%`,
                    minWidth: '20px', minHeight: '20px'
                }}
            >
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider overflow-hidden px-1">
                    {getFieldIcon(field.type)}
                    {field.type !== 'checkbox' && <span>{getFieldLabel(field.type)}</span>}
                </div>
                
                <button 
                    onMouseDown={(e) => { e.stopPropagation(); onRemove(field.id); }}
                    onTouchStart={(e) => { e.stopPropagation(); onRemove(field.id); }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-sm hover:bg-red-700 opacity-0 group-hover:opacity-100 transition-opacity z-50"
                >
                    <X size={10} />
                </button>
            </div>
        </Draggable>
    );
};