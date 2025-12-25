import React, { useState, useRef, useEffect } from 'react';
import { db, storage, auth } from '@lib/firebase';
import { ref, uploadBytes } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Document, Page, pdfjs } from 'react-pdf';
import Draggable from 'react-draggable';
import { Loader2, UploadCloud, Save, X, Plus, Type, CheckSquare, Calendar, PenTool, Scaling } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Fix: Use local worker to avoid CORS and 404s
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// --- SUB-COMPONENT: Resizable & Draggable Field ---
const ResizableDraggableField = ({ field, pageNum, pageWidth, pageHeight, onStop, onResize, onRemove, getIcon }) => {
    const nodeRef = useRef(null); 
    const [size, setSize] = useState({ width: field.width, height: field.height });

    // Calculate initial pixel position from percentage so it doesn't jump
    const initialX = (field.x / 100) * pageWidth;
    const initialY = (field.y / 100) * pageHeight;

    // Handle resizing logic locally for performance
    const handleMouseDown = (e) => {
        e.stopPropagation(); // Prevent drag
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = size.width;
        const startHeight = size.height;

        const doDrag = (dragEvent) => {
            setSize({
                width: Math.max(30, startWidth + dragEvent.clientX - startX),
                height: Math.max(30, startHeight + dragEvent.clientY - startY)
            });
        };

        const stopDrag = () => {
            window.removeEventListener('mousemove', doDrag);
            window.removeEventListener('mouseup', stopDrag);
            // Save final size to parent
            onResize(field.id, size.width, size.height);
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    };

    return (
        <Draggable
            nodeRef={nodeRef}
            bounds="parent"
            defaultPosition={{ x: initialX, y: initialY }}
            onStop={(e, data) => onStop(field.id, pageNum, data)}
            cancel=".resize-handle" // Prevent dragging when clicking resize handle
        >
            <div 
                ref={nodeRef} 
                className={`absolute cursor-move pointer-events-auto border-2 rounded flex flex-col shadow-lg transition z-50 group
                    ${field.type === 'signature' ? 'bg-yellow-400/80 border-yellow-600' : 
                      field.type === 'text' ? 'bg-blue-100/90 border-blue-500' :
                      field.type === 'date' ? 'bg-green-100/90 border-green-500' :
                      'bg-purple-100/90 border-purple-500' }`
                }
                style={{ width: size.width, height: size.height }}
            >
                {/* Header / Icon Area */}
                <div className="flex items-center gap-1 p-1 overflow-hidden">
                    {getIcon(field.type)}
                    {size.width > 60 && <span className="text-[10px] font-bold uppercase truncate">{field.type}</span>}
                </div>
                
                {/* Remove Button */}
                <button 
                    onMouseDown={(e) => { e.stopPropagation(); onRemove(field.id); }}
                    onTouchStart={(e) => { e.stopPropagation(); onRemove(field.id); }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-700 z-50"
                >
                    <X size={10} />
                </button>

                {/* Resize Handle */}
                <div 
                    className="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 opacity-0 group-hover:opacity-100 transition"
                    onMouseDown={handleMouseDown}
                >
                    <Scaling size={12} className="text-gray-600" />
                </div>
            </div>
        </Draggable>
    );
};

export default function EnvelopeCreator({ companyId, onClose }) {
  const [file, setFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [title, setTitle] = useState('');
  
  const [fields, setFields] = useState([]); 
  const pageRefs = useRef({});

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.type === 'application/pdf') {
      setFile(selected);
      setTitle(selected.name.replace('.pdf', ''));
    } else {
      alert("Please upload a valid PDF.");
    }
  };

  const addField = (type) => {
    if (!file) return;
    
    // Default Sizes based on type
    let w = 160, h = 50;
    if (type === 'checkbox') { w = 30; h = 30; }
    if (type === 'text') { w = 200; h = 40; }
    if (type === 'date') { w = 140; h = 40; }

    const newField = {
        id: uuidv4(),
        type, 
        page: 1, 
        x: 40, y: 40, // % position
        width: w, height: h, // px size
        label: type
    };
    setFields(prev => [...prev, newField]);
  };

  const removeField = (id) => {
      setFields(prev => prev.filter(f => f.id !== id));
  };

  const updateFieldPosition = (id, pageNum, data) => {
     const node = data.node;
     const parent = node.offsetParent;
     if (!parent) return;

     const xPercent = (node.offsetLeft / parent.offsetWidth) * 100;
     const yPercent = (node.offsetTop / parent.offsetHeight) * 100;

     setFields(prev => prev.map(f => 
        f.id === id ? { ...f, x: xPercent, y: yPercent, page: pageNum } : f
     ));
  };

  const updateFieldSize = (id, width, height) => {
      setFields(prev => prev.map(f =>
          f.id === id ? { ...f, width, height } : f
      ));
  };

  const handleSend = async () => {
    if (!file || !recipientEmail || fields.length === 0) {
        alert("Please upload a file, set a recipient, and place at least one field.");
        return;
    }

    setLoading(true);
    try {
        const storagePath = `secure_documents/${companyId}/originals/${Date.now()}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);

        // Generate Secure Token for Public Access
        const accessToken = uuidv4();

        const docData = {
            companyId,
            recipientEmail,
            recipientName,
            title,
            status: 'sent',
            createdAt: serverTimestamp(),
            storagePath, 
            senderId: auth.currentUser.uid,
            recipientId: null,
            // Trigger Email flag for Backend
            sendEmail: true, 
            // Save the secure token
            accessToken: accessToken,
            fields: fields.map(f => ({
                id: f.id,
                type: f.type,
                pageNumber: f.page,
                xPosition: f.x,
                yPosition: f.y,
                width: f.width, 
                height: f.height, 
                required: true 
            }))
        };

        await addDoc(collection(db, 'companies', companyId, 'signing_requests'), docData);
        
        alert("Document sent! Signer will be notified.");
        if(onClose) onClose();

    } catch (err) {
        console.error("Error sending:", err);
        alert("Failed to send.");
    } finally {
        setLoading(false);
    }
  };

  const getIcon = (type) => {
      switch(type) {
          case 'signature': return <PenTool size={16} />;
          case 'text': return <Type size={16} />;
          case 'checkbox': return <CheckSquare size={16} />;
          case 'date': return <Calendar size={16} />;
          default: return <Plus size={16} />;
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
        <div className="w-80 bg-white border-r flex flex-col z-10 shadow-lg">
            <div className="p-6 border-b">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">1. Recipient</label>
                <input 
                    type="text" placeholder="Name" 
                    className="w-full mb-2 p-2 text-sm border rounded bg-gray-50"
                    value={recipientName} onChange={e => setRecipientName(e.target.value)}
                />
                <input 
                    type="email" placeholder="Email" 
                    className="w-full p-2 text-sm border rounded bg-gray-50"
                    value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                />
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-4">2. Drag & Resize Fields</label>
                {!file ? (
                    <div className="text-center p-6 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50">
                        <p className="text-sm text-gray-400 mb-2">Upload a PDF first</p>
                        <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" id="pdf-upload"/>
                        <label htmlFor="pdf-upload" className="px-4 py-2 bg-white border border-gray-300 rounded text-sm font-medium cursor-pointer hover:bg-gray-50">Choose File</label>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { id: 'signature', label: 'Signature', icon: <PenTool size={18}/>, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
                            { id: 'text', label: 'Text Box', icon: <Type size={18}/>, color: 'bg-blue-50 text-blue-700 border-blue-200' },
                            { id: 'date', label: 'Date', icon: <Calendar size={18}/>, color: 'bg-green-50 text-green-700 border-green-200' },
                            { id: 'checkbox', label: 'Checkbox', icon: <CheckSquare size={18}/>, color: 'bg-purple-50 text-purple-700 border-purple-200' },
                        ].map((tool) => (
                            <button
                                key={tool.id}
                                onClick={() => addField(tool.id)}
                                className={`flex flex-col items-center justify-center p-3 border rounded-xl transition hover:shadow-md ${tool.color}`}
                            >
                                <div className="mb-1">{tool.icon}</div>
                                <span className="text-xs font-bold">{tool.label}</span>
                            </button>
                        ))}
                    </div>
                )}
                
                <div className="mt-8">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Placed Fields ({fields.length})</label>
                    <div className="space-y-2">
                        {fields.map((f) => (
                            <div key={f.id} className="flex justify-between items-center p-2 bg-gray-50 border rounded text-xs">
                                <div className="flex items-center gap-2">
                                    {getIcon(f.type)}
                                    <span>{f.type}</span>
                                </div>
                                <button onClick={() => removeField(f.id)} className="text-red-500 hover:bg-red-50 p-1 rounded"><X size={12}/></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-200 p-8 flex justify-center relative">
            {file && (
                <Document
                    file={file}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    className="flex flex-col gap-6"
                >
                    {Array.from(new Array(numPages), (el, index) => {
                        const pageNum = index + 1;
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
                                    {fields.filter(f => f.page === pageNum).map((field) => (
                                        <ResizableDraggableField
                                            key={field.id}
                                            field={field}
                                            pageNum={pageNum}
                                            // Pass dimensions to calculate initial position
                                            pageWidth={700}
                                            pageHeight={pageRefs.current[index]?.offsetHeight || 900}
                                            onStop={updateFieldPosition}
                                            onResize={updateFieldSize}
                                            onRemove={removeField}
                                            getIcon={getIcon}
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