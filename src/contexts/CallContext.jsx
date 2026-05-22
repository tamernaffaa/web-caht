import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import Peer from 'simple-peer';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import { getIceServers, getUserMediaStream, stopMediaStream } from '../utils/webrtc-helpers';
import { soundManager } from '../utils/sound-manager';
import { db } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const CallContext = createContext();

export function useCall() {
  return useContext(CallContext);
}

export function CallProvider({ children }) {
  const { currentUser } = useAuth();
  const { socket, isConnected, connectionError } = useSocket();

  const emitIfConnected = (event, payload) => {
    if (!socket || !isConnected) return false;
    socket.emit(event, payload);
    return true;
  };

  // Call States: idle, calling, ringing, connected, ended
  const [callState, setCallState] = useState('idle'); 
  const [incomingCallData, setIncomingCallData] = useState(null);
  const [activeCallData, setActiveCallData] = useState(null); // { roomId, targetUserId, isVideo }
  
  // Media Streams
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const activeCallRef = useRef(null);

  // --------------------------
  // Incoming Call Listeners
  // --------------------------
  useEffect(() => {
    if (!socket || !isConnected) return;

    socket.on('incoming-call', (data) => {
      // If already in a call, ignore or emit busy
      if (callState !== 'idle') {
        socket.emit('reject-call', { targetUserId: data.caller.uid, roomId: data.roomId });
        return;
      }
      soundManager.stopAllRingtones();
      soundManager.startIncomingRingtone();
      setIncomingCallData(data);
      setCallState('ringing');
    });

    socket.on('call-answered', ({ roomId }) => {
      soundManager.stopAllRingtones();
      soundManager.playCallConnected();
      const currentCall = activeCallRef.current;
      const currentStream = localStreamRef.current;
      if (!peerRef.current && currentCall && currentStream) {
        createPeer(currentCall.targetUserId, roomId, currentStream, true);
      }
      setCallState('connected');
    });

    socket.on('call-rejected', ({ roomId }) => {
      soundManager.stopAllRingtones();
      soundManager.playCallEnded();
      cleanupCall();
      alert('تم رفض المكالمة');
    });

    socket.on('call-ended', ({ roomId }) => {
      soundManager.stopAllRingtones();
      soundManager.playCallEnded();
      cleanupCall();
    });

    return () => {
      socket.off('incoming-call');
      socket.off('call-answered');
      socket.off('call-rejected');
      socket.off('call-ended');
    };
  }, [socket, isConnected, callState]);

  // --------------------------
  // Core Actions
  // --------------------------

  const startCall = async (targetUserId, roomId, isVideo = true, otherUserName = 'المستخدم') => {
    try {
      if (!socket || !isConnected) {
        const details = connectionError ? `\nالسبب: ${connectionError}` : '';
        alert(`جاري الاتصال بالخادم، حاول مرة أخرى خلال لحظة.${details}`);
        return;
      }

      setCallState('calling');
      soundManager.stopAllRingtones();
      soundManager.startOutgoingRingback();
      const callData = { roomId, targetUserId, isVideo, otherUserName };
      setActiveCallData(callData);
      activeCallRef.current = callData;

      // 1. Get Local Media
      const stream = await getUserMediaStream(isVideo);
      setLocalStream(stream);
      localStreamRef.current = stream;

      // 2. Notify Server
      emitIfConnected('call-user', {
        targetUserId, 
        roomId, 
        isVideo, 
        caller: { uid: currentUser.uid, name: currentUser.displayName, avatar: currentUser.photoURL } 
      });

    } catch (err) {
      console.error(err);
      alert(err?.message || 'فشل بدء المكالمة.');
      cleanupCall();
    }
  };

  const answerCall = async (acceptVideo = true) => {
    if (!incomingCallData) return;
    if (!socket || !isConnected) {
      alert('الاتصال بالخادم غير متاح حاليًا.');
      return;
    }

    soundManager.stopAllRingtones();

    try {
      const stream = await getUserMediaStream(acceptVideo);
      setLocalStream(stream);
      localStreamRef.current = stream;
      setActiveCallData({
        roomId: incomingCallData.roomId,
        targetUserId: incomingCallData.caller.uid,
        isVideo: acceptVideo,
        otherUserName: incomingCallData.caller.name
      });
      activeCallRef.current = {
        roomId: incomingCallData.roomId,
        targetUserId: incomingCallData.caller.uid,
        isVideo: acceptVideo,
        otherUserName: incomingCallData.caller.name
      };

      // Create Peer (Not Initiator) BEFORE notifying caller to avoid losing first offer.
      createPeer(incomingCallData.caller.uid, incomingCallData.roomId, stream, false);
      setCallState('connected');
      soundManager.playCallConnected();

      // Notify caller
      emitIfConnected('answer-call', {
        targetUserId: incomingCallData.caller.uid, 
        roomId: incomingCallData.roomId 
      });
      setIncomingCallData(null);
    } catch (err) {
      console.error(err);
      alert(err?.message || 'فشل الرد على المكالمة.');
      rejectCall();
    }
  };

  const rejectCall = () => {
    if (incomingCallData) {
      emitIfConnected('reject-call', {
        targetUserId: incomingCallData.caller.uid, 
        roomId: incomingCallData.roomId 
      });
    }
    soundManager.stopAllRingtones();
    soundManager.playCallEnded();
    cleanupCall();
  };

  const endCall = async () => {
    if (activeCallData) {
      emitIfConnected('end-call', { roomId: activeCallData.roomId });
      
      // Save call log to Firestore
      try {
        await addDoc(collection(db, 'chats', activeCallData.roomId, 'messages'), {
          type: 'system',
          text: `📞 انتهت المكالمة`,
          timestamp: serverTimestamp(),
          senderId: currentUser.uid
        });
      } catch (e) {
        console.error("Error saving call log", e);
      }
    }
    soundManager.stopAllRingtones();
    soundManager.playCallEnded();
    cleanupCall();
  };

  // --------------------------
  // WebRTC Peer Management
  // --------------------------
  const createPeer = (targetUserId, roomId, stream, initiator) => {
    if (!socket || !isConnected) {
      cleanupCall();
      return;
    }

    const peer = new Peer({
      initiator,
      trickle: true,
      stream,
      config: {
        iceServers: getIceServers(),
        iceTransportPolicy: import.meta.env.VITE_FORCE_TURN === 'true' ? 'relay' : 'all'
      }
    });

    peer.on('signal', (signal) => {
      emitIfConnected('signal', { roomId, targetUserId, signal });
    });

    peer.on('stream', (remoteStream) => {
      setRemoteStream(remoteStream);
    });

    peer.on('close', () => {
      cleanupCall();
    });

    peer.on('error', (err) => {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('close called') || msg.includes('user-initiated abort')) {
        return;
      }
      console.error("Peer error:", err);
      cleanupCall();
    });

    // Handle incoming signaling data
    const handleSignal = (data) => {
      if (data.senderId === targetUserId) {
        peer.signal(data.signal);
      }
    };
    socket.on('signal', handleSignal);
    
    // Store cleanup function on the peer to remove listener later
    peer._cleanupSignal = () => socket.off('signal', handleSignal);

    peerRef.current = peer;
  };

  const cleanupCall = () => {
    soundManager.stopAllRingtones();
    setCallState('idle');
    setActiveCallData(null);
    activeCallRef.current = null;
    setIncomingCallData(null);
    
    if (localStreamRef.current) {
      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
      setLocalStream(null);
    }
    setRemoteStream(null);

    if (peerRef.current) {
      if (peerRef.current._cleanupSignal) peerRef.current._cleanupSignal();
      peerRef.current.destroy();
      peerRef.current = null;
    }
  };

  const value = {
    callState,
    incomingCallData,
    activeCallData,
    localStream,
    remoteStream,
    startCall,
    answerCall,
    rejectCall,
    endCall
  };

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
}
