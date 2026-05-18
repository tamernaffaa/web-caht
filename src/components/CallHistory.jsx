import React from 'react';
import { Phone, PhoneMissed, Video } from 'lucide-react';

export default function CallHistory({ calls }) {
  if (!calls || calls.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-4">
      <h3 className="font-semibold text-gray-800 border-b pb-2 mb-3">سجل المكالمات</h3>
      <div className="space-y-3">
        {calls.map((call, idx) => (
          <div key={idx} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${call.type === 'missed' ? 'bg-red-100 text-red-500' : 'bg-green-100 text-green-500'}`}>
                {call.type === 'missed' ? <PhoneMissed size={16} /> : (call.isVideo ? <Video size={16} /> : <Phone size={16} />)}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">{call.callerName}</p>
                <p className="text-xs text-gray-500">{call.time}</p>
              </div>
            </div>
            <span className="text-xs text-gray-400">{call.duration}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
