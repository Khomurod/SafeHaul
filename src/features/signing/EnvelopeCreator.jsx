import React, { useState, useRef, useEffect } from 'react';
import { db, storage, auth } from '@lib/firebase';
import { ref, uploadBytes } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Document, Page, pdfjs } from 'react-pdf';
import Draggable from 'react-draggable';
import { Loader2, UploadCloud, Save, X, Plus, Type, CheckSquare, Calendar, PenTool, Scaling, FileText } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

// --- SUB-COMPONENT: Resizable & Draggable Field ---
const ResizableDraggableField = ({ field, pageNum, pageWidth, pageHeight, onStop, onResize, onRemove, getIcon, onLabelChange }) => {
    const nodeRef = useRef(null);
    const safePageHeight = pageHeight || 800;
    const wPx = (field.width / 100) * pageWidth;
    const hPx = (field.height / 100) * safePageHeight;
    const xPx = (field.x / 100) * pageWidth;
    const yPx = (field.y / 100) * safePageHeight;

    const [size, setSize] = useState({ width: wPx, height: hPx });

    useEffect(() => {
        setSize({ width: wPx, height: hPx });
    }, [wPx, hPx]);

    const handleMouseDown = (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = size.width;
        const startHeight = size.height;

        const doDrag = (dragEvent) => {
            setSize({
                // PRECISION FIX: Minimum size reduced to 8px
                width: Math.max(8, startWidth + dragEvent.clientX - startX),
                height: Math.max(8, startHeight + dragEvent.clientY - startY)
            });
        };

        const stopDrag = () => {
            window.removeEventListener('mousemove', doDrag);
            window.removeEventListener('mouseup', stopDrag);
            onResize(field.id, (size.width / pageWidth) * 100, (size.height / safePageHeight) * 100);
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    };

    const handleDragStop = (e, data) => {
        onStop(field.id, pageNum, (data.x / pageWidth) * 100, (data.y / safePageHeight) * 100);
    };

    return (
        <Draggable
            nodeRef={nodeRef}
            bounds="parent"
            position={{ x: xPx, y: yPx }}
            onStop={handleDragStop}
            cancel=".resize-handle, .label-input"
        >
            <div
                ref={nodeRef}
                className={`absolute cursor-move pointer-events-auto border-2 rounded flex flex-col shadow-lg transition z-50 group
                    ${field.type === 'signature' ? 'bg-yellow-400/80 border-yellow-600' :
                        field.type === 'text' ? 'bg-blue-100/90 border-blue-500' :
                            field.type === 'date' ? 'bg-green-100/90 border-green-500' :
                                'bg-purple-100/90 border-purple-500'}`
                }
                style={{ width: size.width, height: size.height }}
            >
                <div className="flex items-center gap-1 p-1 overflow-hidden shrink-0">
                    {getIcon(field.type)}
                    {size.width > 40 && (
                        <input
                            className="label-input bg-transparent border-none text-[9px] font-bold uppercase w-full focus:ring-0 p-0 truncate cursor-text"
                            value={field.label}
                            onChange={(e) => onLabelChange(field.id, e.target.value)}
                            onMouseDown={(e) => e.stopPropagation()}
                        />
                    )}
                </div>

                <button
                    onMouseDown={(e) => { e.stopPropagation(); onRemove(field.id); }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-700 z-50"
                >
                    <X size={10} />
                </button>

                <div
                    className="resize-handle absolute bottom-0 right-0 w-3 h-3 cursor-se-resize flex items-end justify-end p-0.5 opacity-0 group-hover:opacity-100 transition"
                    onMouseDown={handleMouseDown}
                >
                    <Scaling size={10} className="text-gray-600" />
                </div>
            </div>
        </Draggable>
    );
};

export default function EnvelopeCreator({ companyId, onClose, initialMode = 'request' }) {
    const [file, setFile] = useState(null);
    const [numPages, setNumPages] = useState(null);
    const [loading, setLoading] = useState(false);
    const [creatorMode, setCreatorMode] = useState(initialMode); // 'request' or 'template'

    // Recipient details only needed for 'request' mode
    const [recipientEmail, setRecipientEmail] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [title, setTitle] = useState('');

    const [fields, setFields] = useState([]);
    const [pageDimensions, setPageDimensions] = useState({});

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

        let w = 25, h = 5;
        if (type === 'checkbox') { w = 4; h = 3; }
        if (type === 'text') { w = 30; h = 5; }
        if (type === 'date') { w = 20; h = 5; }

        const newField = {
            id: uuidv4(),
            type,
            page: 1,
            x: 10, y: 10,
            width: w, height: h,
            label: type === 'text' ? 'Label' : type
        };
        setFields(prev => [...prev, newField]);
    };

    const removeField = (id) => setFields(prev => prev.filter(f => f.id !== id));

    const updateFieldPosition = (id, pageNum, xPercent, yPercent) => {
        setFields(prev => prev.map(f => f.id === id ? { ...f, x: xPercent, y: yPercent, page: pageNum } : f));
    };

    const updateFieldSize = (id, widthPercent, heightPercent) => {
        setFields(prev => prev.map(f => f.id === id ? { ...f, width: widthPercent, height: heightPercent } : f));
    };

    const updateFieldLabel = (id, newLabel) => {
        setFields(prev => prev.map(f => f.id === id ? { ...f, label: newLabel } : f));
    };

    const onPageLoadSuccess = (page) => {
        setPageDimensions(prev => ({ ...prev, [page.pageNumber]: { width: page.width, height: page.height } }));
    };

    const handleSave = async () => {
        if (!file || fields.length === 0) {
            alert("Please upload a file and place fields.");
            return;
        }

        if (creatorMode === 'request' && (!recipientEmail || !recipientName)) {
            alert("Please provide recipient details for a direct request.");
            return;
        }

        setLoading(true);
        const placeholderMap = {
            '{{full_name}}': recipientName,
            '{{email}}': recipientEmail
        };

        const processedFields = fields.map(f => {
            if (f.type === 'text' && placeholderMap[f.label]) {
                return {
                    ...f,
                    defaultValue: placeholderMap[f.label],
                    readOnly: true
                };
            }
            return f;
        });

        try {
            const folder = creatorMode === 'template' ? 'templates' : 'originals';
            const storagePath = `secure_documents/${companyId}/${folder}/${Date.now()}_${file.name}`;
            const fileRef = ref(storage, storagePath);
            await uploadBytes(fileRef, file);

            const commonData = {
                companyId,
                title,
                storagePath,
                fields: processedFields.map(f => ({
                    id: f.id,
                    type: f.type,
                    label: f.label,
                    pageNumber: f.page,
                    xPosition: f.x,
                    yPosition: f.y,
                    width: f.width,
                    height: f.height,
                    required: true,
                    defaultValue: f.defaultValue || null,
                    readOnly: f.readOnly || false
                })),
                updatedAt: serverTimestamp()
            };

            if (creatorMode === 'template') {
                await addDoc(collection(db, 'companies', companyId, 'templates'), {
                    ...commonData,
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid
                });
                alert("Template saved successfully!");
            } else {
                const accessToken = uuidv4();
                await addDoc(collection(db, 'companies', companyId, 'signing_requests'), {
                    ...commonData,
                    recipientEmail,
                    recipientName,
                    status: 'sent',
                    createdAt: serverTimestamp(),
                    senderId: auth.currentUser.uid,
                    accessToken: accessToken,
                    sendEmail: true
                });
                alert("Document sent to recipient!");
            }

            if (onClose) onClose();
        } catch (err) {
            console.error("Error saving:", err);
            alert("Action failed. Check console for details.");
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (type) => {
        switch (type) {
            case 'signature': return <PenTool size={14} />;
            case 'text': return <Type size={14} />;
            case 'checkbox': return <CheckSquare size={14} />;
            case 'date': return <Calendar size={14} />;
            default: return <Plus size={14} />;
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-100 font-sans">
            <div className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm z-20 shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
                        {creatorMode === 'template' ? <FileText className="text-purple-600" /> : <UploadCloud className="text-blue-600" />}
                        {creatorMode === 'template' ? 'Create Template' : 'New Envelope'}
                    </h2>
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setCreatorMode('request')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition ${creatorMode === 'request' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            One-off Send
                        </button>
                        <button
                            onClick={() => setCreatorMode('template')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition ${creatorMode === 'template' ? 'bg-white shadow text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Save Template
                        </button>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className={`px-6 py-2 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50 transition-all shadow-md
                    ${creatorMode === 'template' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                        {creatorMode === 'template' ? 'Save Template' : 'Send Document'}
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                <div className="w-80 bg-white border-r flex flex-col z-10 shadow-lg shrink-0">
                    {creatorMode === 'request' && (
                        <div className="p-6 border-b animate-in fade-in slide-in-from-top-2">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">1. Recipient</label>
                            <input
                                type="text" placeholder="Recipient Name"
                                className="w-full mb-2 p-2 text-sm border rounded bg-gray-50 focus:bg-white transition-colors"
                                value={recipientName} onChange={e => setRecipientName(e.target.value)}
                            />
                            <input
                                type="email" placeholder="Recipient Email"
                                className="w-full p-2 text-sm border rounded bg-gray-50 focus:bg-white transition-colors"
                                value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="p-6 flex-1 overflow-y-auto">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-4">
                            {creatorMode === 'request' ? '2. Setup Fields' : '1. Setup Fields'}
                        </label>
                        {!file ? (
                            <div className="text-center p-6 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:border-blue-400 transition-colors">
                                <p className="text-sm text-gray-400 mb-2 font-medium">Upload a PDF first</p>
                                <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" id="pdf-upload" />
                                <label htmlFor="pdf-upload" className="px-4 py-2 bg-white border border-gray-300 rounded shadow-sm text-sm font-bold cursor-pointer hover:bg-gray-50 active:scale-95 transition-transform inline-block">Choose File</label>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3 mb-6">
                                    {[
                                        { id: 'signature', label: 'Signature', icon: <PenTool size={18} />, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
                                        { id: 'text', label: 'Text/Placeholder', icon: <Type size={18} />, color: 'bg-blue-50 text-blue-700 border-blue-200' },
                                        { id: 'date', label: 'Date', icon: <Calendar size={18} />, color: 'bg-green-50 text-green-700 border-green-200' },
                                        { id: 'checkbox', label: 'Checkbox', icon: <CheckSquare size={18} />, color: 'bg-purple-50 text-purple-700 border-purple-200' },
                                    ].map((tool) => (
                                        <button
                                            key={tool.id}
                                            onClick={() => addField(tool.id)}
                                            className={`flex flex-col items-center justify-center p-3 border rounded-xl transition hover:shadow-md active:scale-95 ${tool.color}`}
                                        >
                                            <div className="mb-1">{tool.icon}</div>
                                            <span className="text-[10px] font-bold uppercase">{tool.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {fields.some(f => f.type === 'text') && (
                                    <div className="mb-6 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                        <p className="text-[10px] text-blue-700 leading-relaxed font-medium">
                                            <strong>Tip:</strong> Use labels like <code className="bg-blue-100 px-1 rounded">{"{{full_name}}"}</code> to auto-fill driver data when sending.
                                        </p>
                                    </div>
                                )}
                            </>
                        )}

                        {fields.length > 0 && (
                            <div className="mt-4">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Placed Fields ({fields.length})</label>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {fields.map((f) => (
                                        <div key={f.id} className="flex justify-between items-center p-2 bg-gray-50 border rounded-lg text-xs group">
                                            <div className="flex items-center gap-2 truncate">
                                                <div className="text-gray-400 shrink-0">{getIcon(f.type)}</div>
                                                <span className="font-bold truncate">{f.label}</span>
                                            </div>
                                            <button onClick={() => removeField(f.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors"><X size={14} /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-200 p-8 flex justify-center relative scroll-smooth">
                    {file && (
                        <Document
                            file={file}
                            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                            className="flex flex-col gap-8 pb-16"
                        >
                            {Array.from(new Array(numPages), (el, index) => {
                                const pageNum = index + 1;
                                const dims = pageDimensions[pageNum];

                                return (
                                    <div key={pageNum} className="relative shadow-2xl border border-gray-400 bg-white inline-block ring-1 ring-black/5">
                                        <Page
                                            pageNumber={pageNum}
                                            width={700}
                                            onLoadSuccess={onPageLoadSuccess}
                                            renderAnnotationLayer={false}
                                            renderTextLayer={false}
                                        />
                                        <div className="absolute inset-0 z-10 pointer-events-none">
                                            {fields.filter(f => f.page === pageNum).map((field) => (
                                                <ResizableDraggableField
                                                    key={field.id}
                                                    field={field}
                                                    pageNum={pageNum}
                                                    pageWidth={700}
                                                    pageHeight={dims ? dims.height : 900}
                                                    onStop={updateFieldPosition}
                                                    onResize={updateFieldSize}
                                                    onRemove={removeField}
                                                    getIcon={getIcon}
                                                    onLabelChange={updateFieldLabel}
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