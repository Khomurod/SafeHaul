import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '@lib/firebase';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useData } from '@/context/DataContext';
import EnvelopeCreator from '@features/signing/EnvelopeCreator';
import EnvelopeHistory from '@features/signing/components/EnvelopeHistory';
import { GlobalLoadingState } from '@shared/components/feedback';
import { FileSignature, History, ArrowLeft, Plus, FileText, Send, Trash2, X, Search, User, Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@shared/components/feedback';

export default function DocumentsManager() {
    const { currentCompanyProfile, loading } = useData();
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();

    const [activeTab, setActiveTab] = useState('list');
    const [viewMode, setViewMode] = useState('view');
    const [creatorInitialMode, setCreatorInitialMode] = useState('request');

    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);

    // Send Flow State
    const [showDriverPicker, setShowDriverPicker] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [drivers, setDrivers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sending, setSending] = useState(false);

    // Fetch Templates
    useEffect(() => {
        if (!currentCompanyProfile?.id) return;
        const q = query(collection(db, 'companies', currentCompanyProfile.id, 'templates'), orderBy('updatedAt', 'desc'));
        return onSnapshot(q, (snap) => {
            setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setTemplatesLoading(false);
        });
    }, [currentCompanyProfile?.id]);

    // Fetch Drivers for Picker
    useEffect(() => {
        if (showDriverPicker && currentCompanyProfile?.id) {
            const fetchDrivers = async () => {
                const q = query(collection(db, 'companies', currentCompanyProfile.id, 'leads'));
                const snap = await getDocs(q);
                setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            };
            fetchDrivers();
        }
    }, [showDriverPicker, currentCompanyProfile?.id]);

    const handleUseTemplate = (template) => {
        setSelectedTemplate(template);
        setShowDriverPicker(true);
    };

    const executeTemplateSend = async (driver) => {
        setSending(true);
        try {
            const accessToken = uuidv4();

            // AUTO-FILL LOGIC: Map profile data to placeholders
            const autoFilledFields = selectedTemplate.fields.map(f => {
                let value = null;
                const label = (f.label || '').toLowerCase();

                if (label.includes('{{full_name}}')) value = `${driver.firstName} ${driver.lastName}`;
                else if (label.includes('{{first_name}}')) value = driver.firstName;
                else if (label.includes('{{last_name}}')) value = driver.lastName;
                else if (label.includes('{{email}}')) value = driver.email;
                else if (label.includes('{{phone}}')) value = driver.phone;
                else if (label.includes('{{date}}')) value = new Date().toLocaleDateString();

                return { ...f, defaultValue: value };
            });

            const docData = {
                companyId: currentCompanyProfile.id,
                recipientEmail: driver.email,
                recipientName: `${driver.firstName} ${driver.lastName}`,
                recipientId: driver.driverId || null,
                title: selectedTemplate.title,
                status: 'sent',
                createdAt: serverTimestamp(),
                storagePath: selectedTemplate.storagePath,
                senderId: auth.currentUser.uid,
                accessToken,
                sendEmail: true,
                fields: autoFilledFields,
                templateId: selectedTemplate.id,
                // Pre-populate the values for the SigningRoom
                fieldValues: autoFilledFields.reduce((acc, f) => {
                    if (f.defaultValue) acc[f.id] = f.defaultValue;
                    return acc;
                }, {})
            };

            await addDoc(collection(db, 'companies', currentCompanyProfile.id, 'signing_requests'), docData);
            showSuccess(`Document sent to ${driver.firstName}!`);
            setShowDriverPicker(false);
            setActiveTab('list');
        } catch (err) {
            console.error(err);
            showError("Failed to send template.");
        } finally {
            setSending(false);
        }
    };

    const handleDeleteTemplate = async (id) => {
        if (!window.confirm("Delete template?")) return;
        await deleteDoc(doc(db, 'companies', currentCompanyProfile.id, 'templates', id));
    };

    if (loading) return <GlobalLoadingState />;
    if (!currentCompanyProfile) { navigate('/company/dashboard'); return null; }

    if (viewMode === 'create') {
        return <EnvelopeCreator companyId={currentCompanyProfile.id} initialMode={creatorInitialMode} onClose={() => setViewMode('view')} />;
    }

    const filteredDrivers = drivers.filter(d =>
        `${d.firstName} ${d.lastName} ${d.email}`.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-gray-50 p-6 sm:p-8">
            <div className="max-w-6xl mx-auto space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <button onClick={() => navigate('/company/dashboard')} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 text-sm font-medium mb-2 transition-colors">
                            <ArrowLeft size={16} /> Back to Dashboard
                        </button>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <FileSignature className="text-blue-600" /> Documents Center
                        </h1>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={() => { setCreatorInitialMode('template'); setViewMode('create'); }} className="flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-200 font-bold rounded-xl shadow-sm hover:bg-gray-50 transition-all">
                            <FileText size={18} className="text-purple-600" /> Create Template
                        </button>
                        <button onClick={() => { setCreatorInitialMode('request'); setViewMode('create'); }} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 hover:shadow-blue-200 transition-all transform hover:-translate-y-0.5">
                            <Plus size={20} /> Send One-off
                        </button>
                    </div>
                </div>

                <div className="flex border-b border-gray-200 bg-white px-4 rounded-t-xl">
                    <button onClick={() => setActiveTab('list')} className={`px-6 py-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${activeTab === 'list' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <History size={16} /> History
                    </button>
                    <button onClick={() => setActiveTab('templates')} className={`px-6 py-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${activeTab === 'templates' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <FileText size={16} /> Templates
                    </button>
                </div>

                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {activeTab === 'list' ? (
                        <EnvelopeHistory companyId={currentCompanyProfile.id} />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {templatesLoading ? <div className="col-span-full flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" /></div> :
                                templates.length === 0 ? <div className="col-span-full bg-white border-2 border-dashed rounded-2xl p-12 text-center text-gray-400">No templates saved yet.</div> :
                                    templates.map(tmp => (
                                        <div key={tmp.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="bg-purple-50 p-3 rounded-xl"><FileText size={24} className="text-purple-600" /></div>
                                                <button onClick={() => handleDeleteTemplate(tmp.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 rounded-lg transition-opacity"><Trash2 size={16} /></button>
                                            </div>
                                            <h3 className="font-bold text-gray-900 mb-1 truncate">{tmp.title}</h3>
                                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-6">{tmp.fields?.length || 0} Fields</p>
                                            <button onClick={() => handleUseTemplate(tmp)} className="w-full py-2.5 bg-purple-600 text-white text-xs font-bold rounded-xl hover:bg-purple-700 flex items-center justify-center gap-2 transition-all shadow-sm">
                                                <Send size={14} /> Use Template
                                            </button>
                                        </div>
                                    ))
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* DRIVER PICKER MODAL */}
            {showDriverPicker && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">Send Template</h2>
                                <p className="text-xs text-gray-500">Select a driver to receive: <b>{selectedTemplate?.title}</b></p>
                            </div>
                            <button onClick={() => setShowDriverPicker(false)} className="p-2 hover:bg-white rounded-full transition-colors"><X size={20} /></button>
                        </div>

                        <div className="p-4 border-b">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text" placeholder="Search by name or email..."
                                    className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-purple-500 transition-all"
                                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="max-h-[400px] overflow-y-auto p-2 space-y-1">
                            {filteredDrivers.length === 0 ? (
                                <div className="py-12 text-center text-gray-400 text-sm italic">No drivers found.</div>
                            ) : (
                                filteredDrivers.map(d => (
                                    <button
                                        key={d.id}
                                        disabled={sending}
                                        onClick={() => executeTemplateSend(d)}
                                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-purple-50 group transition-all text-left"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="bg-gray-100 p-2 rounded-lg group-hover:bg-purple-100 group-hover:text-purple-600 transition-colors">
                                                <User size={18} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">{d.firstName} {d.lastName}</p>
                                                <p className="text-xs text-gray-500">{d.email}</p>
                                            </div>
                                        </div>
                                        <div className="text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}