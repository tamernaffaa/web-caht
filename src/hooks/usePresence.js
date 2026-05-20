import { useEffect, useRef } from 'react';
import { rtdb } from '../firebase/config';
import { ref, onValue, onDisconnect, set, serverTimestamp } from 'firebase/database';
import { useAuth } from '../context/AuthContext';

export function usePresence() {
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const userStatusRef = ref(rtdb, `/status/${currentUser.uid}`);
    const connectedRef = ref(rtdb, '.info/connected');
    let heartbeatTimer = null;

    // Always set online immediately on mount
    set(userStatusRef, {
      isOnline: true,
      lastSeen: serverTimestamp()
    });

    // Heartbeat every 20 seconds to keep online status fresh
    const startHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        set(userStatusRef, {
          isOnline: true,
          lastSeen: serverTimestamp()
        });
      }, 20000);
    };

    const unsubscribe = onValue(connectedRef, (snapshot) => {
      if (snapshot.val() === false) {
        return;
      }
      onDisconnect(userStatusRef)
        .set({
          isOnline: false,
          lastSeen: serverTimestamp()
        })
        .then(() => {
          set(userStatusRef, {
            isOnline: true,
            lastSeen: serverTimestamp()
          });
          startHeartbeat();
        });
    });

    // Fallback: start heartbeat even if .info/connected is slow
    startHeartbeat();

    return () => {
      unsubscribe();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      set(userStatusRef, {
        isOnline: false,
        lastSeen: serverTimestamp()
      });
    };
  }, [currentUser]);

  return null;
}

// Helper to get another user's presence (can be used in ChatInterface)
export function listenToUserPresence(userId, callback) {
  if (!userId) return () => {};
  const userStatusRef = ref(rtdb, `/status/${userId}`);
  const unsubscribe = onValue(userStatusRef, (snapshot) => {
    callback(snapshot.val() || null);
  });
  return unsubscribe;
}

export async function setTypingStatus(chatId, userId, isTyping) {
  if (!chatId || !userId) return;
  const typingRef = ref(rtdb, `/typing/${chatId}/${userId}`);
  await set(typingRef, {
    isTyping: !!isTyping,
    updatedAt: Date.now()
  });
}

export function listenToTyping(chatId, userId, callback) {
  if (!chatId || !userId) return () => {};
  const typingRef = ref(rtdb, `/typing/${chatId}/${userId}`);
  const unsubscribe = onValue(typingRef, (snapshot) => {
    callback(Boolean(snapshot.val()?.isTyping));
  });
  return unsubscribe;
}
