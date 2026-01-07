import React from 'react';
import { MapPin, Phone, Mail } from 'lucide-react';
import { getFieldValue, formatPhoneNumber, normalizePhone } from '@shared/utils/helpers';

function TelegramLogo({ className }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
        </svg>
    );
}

export function DriverIdentity({ driver, onCallStart }) {
    const pi = driver.personalInfo || {};
    const dp = driver.driverProfile || {};

    const getTelegramLink = (phone) => {
        if (!phone) return '#';
        let cleaned = normalizePhone(phone);
        if (cleaned.length === 10) cleaned = '1' + cleaned;
        return `https://t.me/+${cleaned}`;
    };

    const handleTelegramClick = () => {
        onCallStart();

        const link = getTelegramLink(pi.phone);
        if (link && link !== '#') {
            window.open(link, '_blank');
        }
    };

    return (
        <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-2xl font-bold shrink-0 border-4 border-white shadow-sm">
                {getFieldValue(pi.firstName).charAt(0)}
            </div>

            <div className="flex-1 space-y-2">
                <div className="flex flex-wrap gap-2 mb-1">
                    <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide">
                        {dp.type || 'Unidentified'}
                    </span>
                    <span className="bg-green-100 text-green-800 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide">
                        {dp.availability ? dp.availability.replace('_', ' ') : 'Available'}
                    </span>
                </div>

                <div className="flex items-center gap-2 text-gray-600">
                    <MapPin size={16} className="text-gray-400" />
                    <span>{getFieldValue(pi.city)}, {getFieldValue(pi.state)}</span>
                </div>

                <div className="flex flex-wrap gap-3 mt-3">
                    {pi.phone && (
                        <>
                            <a
                                href={`tel:${pi.phone}`}
                                onClick={onCallStart}
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition"
                            >
                                <Phone size={14} /> {formatPhoneNumber(pi.phone)}
                            </a>
                            <button
                                onClick={handleTelegramClick}
                                className="flex items-center gap-2 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-sm font-medium transition"
                            >
                                <TelegramLogo className="w-4 h-4" /> Telegram
                            </button>
                        </>
                    )}
                    {pi.email && !pi.email.includes('placeholder.com') && (
                        <a
                            href={`mailto:${pi.email}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition"
                        >
                            <Mail size={14} /> Email
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
