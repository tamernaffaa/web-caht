import React from 'react';
import { Phone, Video } from 'lucide-react';
import { useCall } from '../contexts/CallContext';

export default function CallButton({ targetUserId, roomId, targetUserName }) {
  const { startCall, callState } = useCall();

  const handleCall = (isVideo) => {
    if (callState !== 'idle') {
      alert("أنت بالفعل في مكالمة حالياً");
      return;
    }
    startCall(targetUserId, roomId, isVideo, targetUserName);
  };

  return (
    <div className="flex gap-2">
      <button 
        onClick={() => handleCall(true)}
        className="p-2 text-gray-600 hover:text-blue-500 hover:bg-gray-200 rounded-full transition"
        title="مكالمة فيديو"
      >
        <Video size={20} />
      </button>
      <button 
        onClick={() => handleCall(false)}
        className="p-2 text-gray-600 hover:text-green-500 hover:bg-gray-200 rounded-full transition"
        title="مكالمة صوتية"
      >
        <Phone size={20} />
      </button>
    </div>
  );
}
