import React from 'react';
import { Clock, Calendar, ExternalLink, Check, X } from 'lucide-react';
import { updateNotificationStatus } from '@lib/notificationService';

export function NotificationItem({ notification, onClick }) {
    const { 
        id,
        title, 
        message, 
        isRead, 
        status,
        createdAt, 
        scheduledFor, 
        type, 
        link 
    } = notification;

    const isCallback = type === 'callback' && scheduledFor;
    const isCompleted = status === 'completed';

    let scheduledDate, isOverdue, isSoon;
    if (isCallback) {
        scheduledDate = new Date(scheduledFor);
        const now = new Date();
        isOverdue = now > scheduledDate && !isCompleted;
        isSoon = now > new Date(scheduledDate.getTime() - 5 * 60000) && !isCompleted;
    }

    let containerClass = "p-4 hover:bg-gray-50 transition-colors cursor-pointer flex gap-3 group relative border-b border-gray-100 last:border-0";
    
    if (isCompleted) {
        containerClass += " bg-gray-50 opacity-75";
    } else if (!isRead) {
        if (isCallback) containerClass += " bg-orange-50/40";
        else containerClass += " bg-blue-50/40";
    } else {
        containerClass += " bg-white";
    }

    const handleAction = async (e, actionStatus) => {
        e.stopPropagation();
        await updateNotificationStatus(id, actionStatus);
    };

    const renderIcon = () => {
        if (isCompleted) {
            return (
                <div className="mt-1 w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-green-100 text-green-600">
                    <Check size={16} />
                </div>
            );
        }
        if (isCallback) {
            let iconBg = isOverdue ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600';
            return (
                <div className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                    <Clock size={16} />
                </div>
            );
        } else {
            return (
                <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${!isRead ? 'bg-blue-500' : 'bg-gray-300'}`}></div>
            );
        }
    };

    return (
        <li onClick={onClick} className={containerClass}>
            {renderIcon()}
            
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start">
                    <h4 className={`text-sm truncate pr-6 ${!isRead ? 'font-bold text-gray-900' : 'font-medium text-gray-700'} ${isCompleted ? 'line-through text-gray-500' : ''}`}>
                        {title}
                    </h4>
                    
                    {isCallback && !isCompleted && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                            {scheduledDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                    )}
                </div>

                <p className={`text-xs text-gray-500 mt-1 line-clamp-2 ${isCompleted ? 'line-through opacity-70' : ''}`}>{message}</p>

                <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                    {isCallback ? (
                        <>
                            <Calendar size={10}/> {scheduledDate.toLocaleDateString()}
                            {isOverdue && !isCompleted && <span className="text-red-500 font-bold ml-auto">Overdue</span>}
                            {!isOverdue && isSoon && !isCompleted && <span className="text-orange-500 font-bold ml-auto">Due Soon</span>}
                        </>
                    ) : (
                        <span>
                            {createdAt?.seconds 
                                ? new Date(createdAt.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
                                : 'Just now'}
                        </span>
                    )}
                </div>
            </div>

            <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isCompleted && (
                    <button 
                        onClick={(e) => handleAction(e, 'completed')}
                        className="p-1.5 bg-green-100 text-green-600 rounded-full hover:bg-green-200 shadow-sm"
                        title="Mark as Complete"
                    >
                        <Check size={12} />
                    </button>
                )}
                
                <button 
                    onClick={(e) => handleAction(e, 'dismissed')}
                    className="p-1.5 bg-gray-100 text-gray-500 rounded-full hover:bg-red-100 hover:text-red-600 shadow-sm"
                    title="Dismiss"
                >
                    <X size={12} />
                </button>
            </div>

            {link && <div className="absolute bottom-2 right-2 opacity-50"><ExternalLink size={12} /></div>}
        </li>
    );
}
