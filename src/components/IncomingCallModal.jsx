import React from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useCall } from '../contexts/CallContext';

export default function IncomingCallModal() {
  const { callState, incomingCallData, answerCall, rejectCall } = useCall();

  if (callState !== 'ringing' || !incomingCallData) return null;

  const { caller, isVideo } = incomingCallData;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm dir-rtl" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 text-center animate-bounce-short">
        <div className="w-24 h-24 mx-auto bg-gray-200 rounded-full overflow-hidden mb-4 relative">
          <img 
            src={caller.avatar || `https://ui-avatars.com/api/?name=${caller.name}`} 
            alt={caller.name} 
            className="w-full h-full object-cover"
          />
          {/* Ringing animation effect */}
          <div className="absolute inset-0 rounded-full border-4 border-green-500 animate-ping opacity-50"></div>
        </div>
        
        <h2 className="text-xl font-bold text-gray-800 mb-1">{caller.name}</h2>
        <p className="text-gray-500 mb-8">
          {isVideo ? 'مكالمة فيديو واردة...' : 'مكالمة صوتية واردة...'}
        </p>

        <div className="flex justify-center gap-6">
          <button 
            onClick={rejectCall}
            className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition shadow-lg shadow-red-500/30"
            title="رفض"
          >
            <PhoneOff size={24} />
          </button>
          
          <button 
            onClick={() => answerCall(false)}
            className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center text-white hover:bg-green-600 transition shadow-lg shadow-green-500/30"
            title="رد بصوت"
          >
            <Phone size={24} />
          </button>

          {isVideo && (
            <button 
              onClick={() => answerCall(true)}
              className="w-14 h-14 bg-blue-500 rounded-full flex items-center justify-center text-white hover:bg-blue-600 transition shadow-lg shadow-blue-500/30"
              title="رد بفيديو"
            >
              <Video size={24} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
