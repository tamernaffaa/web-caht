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
  const { socket, isConnected } = useSocket();

  // Call States: idle, calling, ringing, connected, ended
  const [callState, setCallState] = useState('idle'); 
  const [incomingCallData, setIncomingCallData] = useState(null);
  const [activeCallData, setActiveCallData] = useState(null); // { roomId, targetUserId, isVideo }
  
  // Media Streams
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const peerRef = useRef(null);
  const audioRef = useRef(new Audio('/ringtone.mp3')); // Make sure to add a ringtone.mp3 in public folder

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
      audioRef.current.loop = true;
      audioRef.current.play().catch(e => console.log('Audio play failed (browser autoplay policy)', e));
    });

    socket.on('call-answered', ({ roomId }) => {
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
  }, [socket, isConnected, callState]);

  // --------------------------
  // Core Actions
  // --------------------------

  const startCall = async (targetUserId, roomId, isVideo = true, otherUserName = 'المستخدم') => {
    try {
      setCallState('calling');
      setActiveCallData({ roomId, targetUserId, isVideo, otherUserName });

      // 1. Get Local Media
      const stream = await getUserMediaStream(isVideo);
      setLocalStream(stream);

      // 2. Notify Server
      socket.emit('call-user', { 
        targetUserId, 
        roomId, 
        isVideo, 
        caller: { uid: currentUser.uid, name: currentUser.displayName, avatar: currentUser.photoURL } 
      });

      // 3. Create Peer (Initiator)
      createPeer(targetUserId, roomId, stream, true);

    } catch (err) {
      console.error(err);
      cleanupCall();
    }
  };

  const answerCall = async (acceptVideo = true) => {
    if (!incomingCallData) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;

    try {
      const stream = await getUserMediaStream(acceptVideo);
      setLocalStream(stream);
      setCallState('connected');
      setActiveCallData({
        roomId: incomingCallData.roomId,
        targetUserId: incomingCallData.caller.uid,
        isVideo: acceptVideo,
        otherUserName: incomingCallData.caller.name
      });

      // Notify caller
      socket.emit('answer-call', { 
        targetUserId: incomingCallData.caller.uid, 
        roomId: incomingCallData.roomId 
      });

      // Create Peer (Not Initiator)
      createPeer(incomingCallData.caller.uid, incomingCallData.roomId, stream, false);
      setIncomingCallData(null);
    } catch (err) {
      console.error(err);
      rejectCall();
    }
  };

  const rejectCall = () => {
    if (incomingCallData) {
      socket.emit('reject-call', { 
        targetUserId: incomingCallData.caller.uid, 
        roomId: incomingCallData.roomId 
      });
    }
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    cleanupCall();
  };

  const endCall = async () => {
    if (activeCallData) {
      socket.emit('end-call', { roomId: activeCallData.roomId });
      
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
    const peer = new Peer({
      initiator,
      trickle: true,
      stream,
      config: {
        iceServers: getIceServers()
      }
    });

    peer.on('signal', (signal) => {
      socket.emit('signal', { roomId, targetUserId, signal });
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
