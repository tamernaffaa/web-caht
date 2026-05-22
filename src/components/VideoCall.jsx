import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Maximize, Minimize, Camera } from 'lucide-react';
import { useCall } from '../contexts/CallContext';
import { toggleTrack, switchCamera } from '../utils/webrtc-helpers';

function VideoCall() {
  const { callState, activeCallData, localStream, remoteStream, endCall, startCall, answerCall, incomingCallData } = useCall();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timer, setTimer] = useState(0);
  const [videoQuality, setVideoQuality] = useState('auto');
  // Handle quality change and restart stream if needed (future: hot switch)
  // For now, only used at call start/answer

  // Set video sources
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Call timer
  useEffect(() => {
    let interval = null;
    if (callState === 'connected') {
      interval = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callState]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleToggleMute = () => {
    toggleTrack(localStream, 'audio', isMuted); // If currently muted, pass true to enable
    setIsMuted(!isMuted);
  };

  const handleToggleVideo = () => {
    toggleTrack(localStream, 'video', isVideoOff);
    setIsVideoOff(!isVideoOff);
  };

  const handleSwitchCamera = async () => {
    if (!localStream) return;
    await switchCamera(localStream);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.log(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Show quality selector before answering/initiating
  if (callState === 'ringing' && incomingCallData) {
    return (
      <div className="fixed inset-0 bg-gray-900/90 z-40 flex flex-col items-center justify-center text-white dir-rtl" dir="rtl">
        <div className="bg-gray-800 rounded-2xl p-8 flex flex-col items-center gap-6 shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">مكالمة واردة من {incomingCallData.caller?.name || 'مستخدم'}</h2>
          <div className="flex flex-col gap-2 w-full">
            <label className="text-lg font-semibold">جودة الفيديو:</label>
            <select
              className="p-2 rounded bg-gray-700 text-white focus:outline-none"
              value={videoQuality}
              onChange={e => setVideoQuality(e.target.value)}
            >
              <option value="auto">تلقائي (حسب الشبكة)</option>
              <option value="low">منخفضة (أقل استهلاك)</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية (HD)</option>
            </select>
          </div>
          <div className="flex gap-6 mt-4">
            <button
              className="px-6 py-2 rounded bg-green-600 hover:bg-green-700 text-white font-bold text-lg"
              onClick={() => answerCall({ quality: videoQuality })}
            >
              قبول المكالمة
            </button>
            <button
              className="px-6 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-bold text-lg"
              onClick={endCall}
            >
              رفض
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Outgoing call: allow quality selection before connecting
  if (callState === 'calling' && activeCallData && !localStream) {
    return (
      <div className="fixed inset-0 bg-gray-900/90 z-40 flex flex-col items-center justify-center text-white dir-rtl" dir="rtl">
        <div className="bg-gray-800 rounded-2xl p-8 flex flex-col items-center gap-6 shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">بدء مكالمة فيديو مع {activeCallData.otherUserName || 'مستخدم'}</h2>
          <div className="flex flex-col gap-2 w-full">
            <label className="text-lg font-semibold">جودة الفيديو:</label>
            <select
              className="p-2 rounded bg-gray-700 text-white focus:outline-none"
              value={videoQuality}
              onChange={e => setVideoQuality(e.target.value)}
            >
              <option value="auto">تلقائي (حسب الشبكة)</option>
              <option value="low">منخفضة (أقل استهلاك)</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية (HD)</option>
            </select>
          </div>
          <div className="flex gap-6 mt-4">
            <button
              className="px-6 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg"
              onClick={() => startCall(activeCallData.targetUserId, activeCallData.roomId, true, activeCallData.otherUserName, { quality: videoQuality })}
            >
              بدء المكالمة
            </button>
            <button
              className="px-6 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-bold text-lg"
              onClick={endCall}
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (callState !== 'calling' && callState !== 'connected') return null;

  return (
    <div className="fixed inset-0 bg-gray-900 z-40 flex flex-col items-center justify-center text-white dir-rtl" dir="rtl">
      
      {/* Remote Video (Full Screen Base) */}
      <div className="absolute inset-0 bg-black flex items-center justify-center">
        {remoteStream ? (
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center animate-pulse">
            <div className="w-24 h-24 bg-gray-800 rounded-full mb-4"></div>
            <p className="text-xl">{callState === 'calling' ? 'جاري الاتصال...' : 'جاري التوصيل...'}</p>
          </div>
        )}
      </div>

      {/* Header Info */}
      <div className="absolute top-6 left-0 right-0 flex justify-between items-center px-6 z-10 drop-shadow-md">
        <div>
          <h2 className="text-2xl font-bold">{activeCallData?.otherUserName}</h2>
          <p className="text-gray-300">{callState === 'connected' ? formatTime(timer) : 'يرن...'}</p>
        </div>
        <button onClick={toggleFullscreen} className="p-2 bg-black/40 rounded-full hover:bg-black/60 transition">
          {isFullscreen ? <Minimize /> : <Maximize />}
        </button>
      </div>

      {/* Local Video (Picture in Picture) */}
      {localStream && !isVideoOff && (
        <div className="absolute bottom-28 left-6 w-28 h-40 md:w-40 md:h-56 bg-black rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl z-10">
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted // ALWAYS mute local video to prevent echo
            className="w-full h-full object-cover transform scale-x-[-1]" // Mirror effect
          />
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-4 z-10">
        <button 
          onClick={handleToggleMute}
          className={`p-4 rounded-full transition ${isMuted ? 'bg-red-500 text-white' : 'bg-gray-800/80 text-white hover:bg-gray-700'}`}
        >
          {isMuted ? <MicOff /> : <Mic />}
        </button>
        
        {activeCallData?.isVideo && (
          <>
            <button 
              onClick={handleToggleVideo}
              className={`p-4 rounded-full transition ${isVideoOff ? 'bg-red-500 text-white' : 'bg-gray-800/80 text-white hover:bg-gray-700'}`}
            >
              {isVideoOff ? <VideoOff /> : <Video />}
            </button>
            <button 
              onClick={handleSwitchCamera}
              className="p-4 bg-gray-800/80 rounded-full text-white hover:bg-gray-700 transition"
              title="تبديل الكاميرا"
            >
              <Camera />
            </button>
          </>
        )}

        <button 
          onClick={endCall}
          className="p-4 bg-red-600 rounded-full text-white hover:bg-red-700 transition px-8"
        >
          <PhoneOff />
        </button>
      </div>
    </div>
  );
}
export default VideoCall;
