import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    addEdge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { X, Send, Rocket, Zap } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';

// Custom Nodes
import AudienceNode from './nodes/AudienceNode';
import MessageNode from './nodes/MessageNode';
import LaunchSequence from '../components/LaunchSequence';

// Node types registration
const nodeTypes = {
    audienceNode: AudienceNode,
    messageNode: MessageNode,
};

/**
 * CampaignBuilder - Full visual campaign builder with custom nodes
 */
const CampaignBuilder = ({ companyId, onClose, onSuccess }) => {
    const [showLaunch, setShowLaunch] = useState(false);
    const [audienceData, setAudienceData] = useState({ filters: {}, targetCount: 0 });
    const [messageData, setMessageData] = useState({ method: 'sms', message: '', subject: '' });
    const [isExecuting, setIsExecuting] = useState(false);

    // Initial nodes with custom types
    const initialNodes = useMemo(() => [
        {
            id: 'audience',
            type: 'audienceNode',
            position: { x: 50, y: 120 },
            data: {
                companyId,
                onUpdate: (data) => setAudienceData(data),
            },
        },
        {
            id: 'message',
            type: 'messageNode',
            position: { x: 450, y: 120 },
            data: {
                companyId,
                onUpdate: (data) => setMessageData(data),
            },
        },
        {
            id: 'launch',
            type: 'output',
            position: { x: 850, y: 180 },
            data: { label: '🚀 Launch Mission' },
            style: {
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.1))',
                border: '2px solid rgba(16, 185, 129, 0.5)',
                borderRadius: '16px',
                padding: '20px 32px',
                color: '#f8fafc',
                fontWeight: 'bold',
                fontSize: '14px',
                boxShadow: '0 0 30px rgba(16, 185, 129, 0.2)',
            },
        },
    ], [companyId]);

    const initialEdges = useMemo(() => [
        {
            id: 'e1',
            source: 'audience',
            target: 'message',
            animated: true,
            style: { stroke: 'rgba(59, 130, 246, 0.6)', strokeWidth: 2 },
        },
        {
            id: 'e2',
            source: 'message',
            target: 'launch',
            animated: true,
            style: { stroke: 'rgba(139, 92, 246, 0.6)', strokeWidth: 2 },
        },
    ], []);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const onConnect = useCallback((params) => {
        setEdges((eds) => addEdge({ ...params, animated: true }, eds));
    }, [setEdges]);

    const handleLaunch = async () => {
        setIsExecuting(true);
        try {
            const initBulkSession = httpsCallable(functions, 'initBulkSession');
            const result = await initBulkSession({
                companyId,
                filters: {
                    leadType: audienceData.filters?.source || 'applications',
                    status: audienceData.filters?.statuses || [],
                    recruiterId: audienceData.filters?.recruiterId || 'all',
                },
                messageConfig: {
                    method: messageData.method,
                    message: messageData.message,
                    subject: messageData.subject,
                },
            });

            if (result.data.success) {
                console.log('Campaign launched:', result.data);
                if (onSuccess) {
                    onSuccess(result.data);
                }
            } else {
                throw new Error(result.data.message || 'Launch failed');
            }
        } catch (err) {
            console.error('Launch error:', err);
            // Provide user-friendly error message
            const friendlyMsg = err.message?.includes('bulk-actions-queue')
                ? 'Campaign infrastructure not ready. Please contact support.'
                : (err.message || 'Failed to launch campaign');
            throw new Error(friendlyMsg);
        } finally {
            setIsExecuting(false);
        }
    };


    const canLaunch = audienceData.targetCount > 0 && messageData.message.length > 0;

    return (
        <motion.div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div
                className="absolute inset-4 bg-slate-900 rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex flex-col"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', duration: 0.5 }}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Zap className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white">Campaign Builder</h2>
                            <p className="text-slate-400">Connect nodes to build your campaign flow</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Summary Pills */}
                        <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-xl">
                            <span className="text-slate-400 text-sm">Targets:</span>
                            <span className="text-white font-bold">{audienceData.targetCount?.toLocaleString() || 0}</span>
                        </div>
                        <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-xl">
                            <span className="text-slate-400 text-sm">Method:</span>
                            <span className="text-white font-bold">{messageData.method === 'sms' ? '📱 SMS' : '📧 Email'}</span>
                        </div>

                        <motion.button
                            className="px-6 py-3 rounded-xl bg-white/5 text-white font-bold border border-white/10"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={onClose}
                        >
                            Cancel
                        </motion.button>
                        <motion.button
                            className={`
                px-6 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2
                ${canLaunch
                                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-emerald-500/25'
                                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                }
              `}
                            whileHover={canLaunch ? { scale: 1.02 } : {}}
                            whileTap={canLaunch ? { scale: 0.98 } : {}}
                            onClick={() => canLaunch && setShowLaunch(true)}
                            disabled={!canLaunch}
                        >
                            <Rocket className="w-5 h-5" />
                            Launch Mission
                        </motion.button>
                    </div>
                </div>

                {/* Flow Canvas */}
                <div className="flex-1">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        nodeTypes={nodeTypes}
                        fitView
                        fitViewOptions={{ padding: 0.3 }}
                        style={{ background: '#0A0E17' }}
                    >
                        <Background color="#1e293b" gap={20} size={1} />
                        <Controls
                            style={{
                                button: {
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: '8px',
                                }
                            }}
                        />
                        <MiniMap
                            style={{
                                background: '#131A2B',
                                maskColor: 'rgba(0,0,0,0.6)',
                            }}
                            nodeColor={(node) => {
                                if (node.type === 'audienceNode') return 'rgba(59, 130, 246, 0.6)';
                                if (node.type === 'messageNode') return 'rgba(139, 92, 246, 0.6)';
                                return 'rgba(16, 185, 129, 0.6)';
                            }}
                        />
                    </ReactFlow>
                </div>

                {/* Instructions */}
                <div className="p-4 border-t border-white/10 bg-slate-900/50 flex-shrink-0">
                    <div className="flex items-center justify-center gap-8 text-sm text-slate-400">
                        <span>💡 Click on nodes to expand and configure</span>
                        <span>🔗 Drag from handles to connect nodes</span>
                        <span>🚀 Set targets and message, then launch!</span>
                    </div>
                </div>
            </motion.div>

            {/* Launch Modal */}
            <LaunchSequence
                isOpen={showLaunch}
                onClose={() => setShowLaunch(false)}
                onLaunch={handleLaunch}
                targetCount={audienceData.targetCount}
                method={messageData.method}
                isExecuting={isExecuting}
            />
        </motion.div>
    );
};

export default CampaignBuilder;
