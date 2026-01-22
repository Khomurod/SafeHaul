import React, { useState, useRef, useEffect } from 'react';
import { Bell, Check, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@shared/hooks/useNotifications';
import { NotificationItem } from './NotificationItem';

export function NotificationBell({ userId }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('general');
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    const { 
        general, 
        callbacks, 
        upcomingCount, 
        markAsRead, 
        markListAsRead 
    } = useNotifications(userId);

    const unreadGeneral = general.filter(n => !n.isRead).length;
    const unreadCallbacks = callbacks.filter(n => !n.isRead).length;
    const totalUnread = unreadGeneral + unreadCallbacks;

    const handleToggle = () => {
        if (!isOpen) {
            if (upcomingCount > 0) {
                setActiveTab('callbacks');
            } else if (callbacks.length > 0 && general.length === 0) {
                setActiveTab('callbacks');
            } else {
                setActiveTab('general');
            }
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleItemClick = (notification) => {
        markAsRead(notification.id);
        if (notification.link) {
            navigate(notification.link);
            setIsOpen(false);
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button 
                onClick={handleToggle}
                className={`p-2 rounded-full transition-all relative ${
                    upcomingCount > 0 
                    ? 'bg-orange-100 text-orange-600 hover:bg-orange-200 animate-pulse' 
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
            >
                {upcomingCount > 0 ? <Phone size={20} className="fill-orange-500"/> : <Bell size={20} />}
                
                {totalUnread > 0 && (
                    <span className={`absolute top-0 right-0 w-4 h-4 text-[10px] font-bold flex items-center justify-center rounded-full shadow-sm ring-2 ring-white ${upcomingCount > 0 ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                        {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-[9999] animate-in fade-in zoom-in-95 duration-100">
                    
                    <div className="bg-gray-50 border-b border-gray-200 flex">
                        <button 
                            onClick={() => setActiveTab('general')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${activeTab === 'general' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                            General {unreadGeneral > 0 && <span className="ml-1 bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full">{unreadGeneral}</span>}
                        </button>
                        <button 
                            onClick={() => setActiveTab('callbacks')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${activeTab === 'callbacks' ? 'border-orange-500 text-orange-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                            Callbacks {unreadCallbacks > 0 && <span className="ml-1 bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">{unreadCallbacks}</span>}
                        </button>
                    </div>

                    <div className="p-2 px-4 bg-white border-b border-gray-50 flex justify-between items-center">
                        <span className="text-xs text-gray-400 font-medium">
                            {activeTab === 'callbacks' ? 'Scheduled Calls' : 'Recent Activity'}
                        </span>
                        {(activeTab === 'callbacks' ? unreadCallbacks : unreadGeneral) > 0 && (
                            <button 
                                onClick={() => markListAsRead(activeTab)} 
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                                <Check size={12} /> Mark read
                            </button>
                        )}
                    </div>

                    <div className="max-h-[400px] overflow-y-auto">
                        {activeTab === 'callbacks' ? (
                            callbacks.length === 0 ? (
                                <div className="p-10 text-center text-gray-400">
                                    <Phone size={32} className="mx-auto mb-2 opacity-20" />
                                    <p className="text-sm">No scheduled callbacks.</p>
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {callbacks.map(note => (
                                        <NotificationItem 
                                            key={note.id} 
                                            notification={note} 
                                            onClick={() => handleItemClick(note)} 
                                        />
                                    ))}
                                </ul>
                            )
                        ) : (
                            general.length === 0 ? (
                                <div className="p-10 text-center text-gray-400">
                                    <Bell size={32} className="mx-auto mb-2 opacity-20" />
                                    <p className="text-sm">No notifications yet.</p>
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {general.map(note => (
                                        <NotificationItem 
                                            key={note.id} 
                                            notification={note} 
                                            onClick={() => handleItemClick(note)} 
                                        />
                                    ))}
                                </ul>
                            )
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
