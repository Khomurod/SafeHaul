import React, { useEffect, useRef } from 'react';
import { 
  Activity, CheckCircle, AlertTriangle, Play, Pause, 
  RotateCcw, Terminal, Server, Database, HardDrive, ShieldCheck
} from 'lucide-react';
import { useSystemHealth } from '../hooks/useSystemHealth';

export function SystemHealthView() {
  const { 
    runDiagnostics, 
    pauseDiagnostics,
    runMigrationTool,
    status, 
    progress, 
    logs, 
    currentStepName 
  } = useSystemHealth();

  const logsEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const getStatusColor = () => {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-50 border-green-200';
      case 'error': return 'text-red-600 bg-red-50 border-red-200';
      case 'running': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'paused': return 'text-orange-600 bg-orange-50 border-orange-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="text-blue-600" /> System Health & Diagnostics
          </h1>
          <p className="text-gray-500">
            Deep inspection of Storage, Database, and Cloud Function integrity.
          </p>
        </div>

        <div className="flex gap-3">
            {/* NEW MIGRATION BUTTON */}
            <button
                onClick={runMigrationTool}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow-md transition-all flex items-center gap-2"
                title="Fix missing Daily Quotas for existing companies"
            >
                <Database size={18} /> Run Data Migration
            </button>
        </div>
      </header>

      {/* Main Diagnostic Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Controls & Status */}
        <div className="lg:col-span-1 space-y-6">
            <div className={`p-6 rounded-xl border-2 ${getStatusColor()} transition-colors`}>
                <h2 className="text-lg font-bold mb-2 uppercase tracking-wide">Status</h2>
                <div className="text-3xl font-black mb-4 capitalize">
                    {status === 'idle' ? 'Ready' : status}
                </div>

                <div className="relative w-full h-4 bg-gray-200 rounded-full overflow-hidden mb-2">
                    <div 
                        className="absolute top-0 left-0 h-full bg-current transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="flex justify-between text-xs font-semibold opacity-75">
                    <span>{progress}% Complete</span>
                    <span>{currentStepName || 'Waiting...'}</span>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                    <ShieldCheck size={20} /> Control Center
                </h3>

                <div className="grid grid-cols-1 gap-3">
                    {status === 'running' ? (
                        <button 
                            onClick={pauseDiagnostics}
                            className="w-full py-3 bg-orange-100 text-orange-700 font-bold rounded-lg hover:bg-orange-200 flex items-center justify-center gap-2"
                        >
                            <Pause size={20} /> Pause Test
                        </button>
                    ) : status === 'paused' ? (
                        <button 
                            onClick={() => runDiagnostics(true)}
                            className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                        >
                            <Play size={20} /> Resume Test
                        </button>
                    ) : (
                        <button 
                            onClick={() => runDiagnostics(false)}
                            className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg hover:shadow-blue-200"
                        >
                            <Play size={20} /> Start Deep Diagnostic
                        </button>
                    )}

                    {(status === 'paused' || status === 'error') && (
                        <button 
                            onClick={() => {
                                if(window.confirm("This will clear saved test progress. Continue?")) {
                                    runDiagnostics(false);
                                }
                            }}
                            className="w-full py-2 bg-gray-100 text-gray-600 font-semibold rounded-lg hover:bg-gray-200 flex items-center justify-center gap-2"
                        >
                            <RotateCcw size={16} /> Restart Fresh
                        </button>
                    )}
                </div>
            </div>

            {/* Capability Badges */}
            <div className="flex flex-wrap gap-2">
                <Badge icon={<HardDrive size={14}/>} label="Storage Write/Read" />
                <Badge icon={<Database size={14}/>} label="Firestore CRUD" />
                <Badge icon={<Server size={14}/>} label="Cloud Functions" />
                <Badge icon={<Activity size={14}/>} label="Latency Check" />
            </div>
        </div>

        {/* Right: Terminal Logs */}
        <div className="lg:col-span-2">
            <div className="bg-gray-900 rounded-xl shadow-lg overflow-hidden flex flex-col h-[500px]">
                <div className="bg-gray-800 p-3 flex items-center gap-2 border-b border-gray-700">
                    <Terminal size={18} className="text-gray-400" />
                    <span className="text-sm font-mono text-gray-300">System Output Log</span>
                </div>

                <div className="flex-1 p-4 overflow-y-auto font-mono text-sm space-y-2">
                    {logs.length === 0 && (
                        <div className="text-gray-600 text-center mt-20">
                            Waiting for diagnostic start...
                        </div>
                    )}
                    {logs.map((log) => (
                        <div key={log.id} className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                            <span className="text-gray-500 shrink-0">
                                {log.time.split('T')[1].split('.')[0]}
                            </span>
                            <span className={`break-all ${
                                log.type === 'error' ? 'text-red-400 font-bold' : 
                                log.type === 'success' ? 'text-green-400' : 
                                log.type === 'warning' ? 'text-orange-300' : 'text-gray-300'
                            }`}>
                                {log.message}
                            </span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>

      </div>
    </div>
  );
}

function Badge({ icon, label }) {
    return (
        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-md flex items-center gap-1.5 border border-gray-200">
            {icon} {label}
        </span>
    );
}