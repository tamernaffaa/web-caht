import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import Peer from 'simple-peer';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import { getIceServers, getUserMediaStream, stopMediaStream } from '../utils/webrtc-helpers';
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
  const audioRef = useRef(null);

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
      setIncomingCallData(data);
      setCallState('ringing');
    });

    socket.on('call-answered', ({ roomId }) => {
      if (!peerRef.current && activeCallData && localStream) {
        createPeer(activeCallData.targetUserId, roomId, localStream, true);
      }
      setCallState('connected');
    });

    socket.on('call-rejected', ({ roomId }) => {
      cleanupCall();
      alert('تم رفض المكالمة');
    });

    socket.on('call-ended', ({ roomId }) => {
      cleanupCall();
    });

    return () => {
      socket.off('incoming-call');
      socket.off('call-answered');
      socket.off('call-rejected');
      socket.off('call-ended');
    };
  }, [socket, isConnected, callState, activeCallData, localStream]);

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
      setActiveCallData({ roomId, targetUserId, isVideo, otherUserName });

      // 1. Get Local Media
      const stream = await getUserMediaStream(isVideo);
      setLocalStream(stream);

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

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    try {
      const stream = await getUserMediaStream(acceptVideo);
      setLocalStream(stream);
      setActiveCallData({
        roomId: incomingCallData.roomId,
        targetUserId: incomingCallData.caller.uid,
        isVideo: acceptVideo,
        otherUserName: incomingCallData.caller.name
      });

      // Create Peer (Not Initiator) BEFORE notifying caller to avoid losing first offer.
      createPeer(incomingCallData.caller.uid, incomingCallData.roomId, stream, false);
      setCallState('connected');

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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
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
        iceServers: getIceServers()
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
    setCallState('idle');
    setActiveCallData(null);
    setIncomingCallData(null);
    
    if (localStream) {
      stopMediaStream(localStream);
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
