import { create } from 'zustand';

const useCallStore = create((set) => ({
  // Call States
  isCallActive: false,
  isRinging: false,
  callDirection: null, // 'incoming' | 'outgoing' | null
  
  // Caller / Callee Data
  caller: null, // { uid, name, avatar }
  callee: null,
  
  // Call Data (WebRTC & Firestore Signaling)
  callId: null,
  localStream: null,
  remoteStream: null,
  
  // Actions
  setIncomingCall: (callId, caller) => set({
    isRinging: true,
    callDirection: 'incoming',
    callId,
    caller
  }),

  setOutgoingCall: (callee) => set({
    isRinging: true,
    callDirection: 'outgoing',
    callee
  }),

  acceptCall: (localStream) => set({
    isRinging: false,
    isCallActive: true,
    localStream
  }),

  setRemoteStream: (remoteStream) => set({
    remoteStream
  }),

  endCall: () => set((state) => {
    // Stop local media tracks before resetting
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
    }
    return {
      isCallActive: false,
      isRinging: false,
      callDirection: null,
      caller: null,
      callee: null,
      callId: null,
      localStream: null,
      remoteStream: null,
    };
  }),
}));

export default useCallStore;
