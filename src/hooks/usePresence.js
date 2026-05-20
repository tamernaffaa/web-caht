import { useEffect } from 'react';
import { rtdb } from '../firebase/config';
import { ref, onValue, onDisconnect, set, serverTimestamp } from 'firebase/database';
import { useAuth } from '../context/AuthContext';

export function usePresence() {
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    // Realtime Database references
    const userStatusRef = ref(rtdb, `/status/${currentUser.uid}`);
    const connectedRef = ref(rtdb, '.info/connected');

    const unsubscribe = onValue(connectedRef, (snapshot) => {
      // If we are not connected, don't do anything
      if (snapshot.val() === false) {
        return;
      }

      // If we are connected, set up the onDisconnect mechanism
      onDisconnect(userStatusRef)
        .set({
          isOnline: false,
          lastSeen: serverTimestamp()
        })
        .then(() => {
          // Then immediately set our status to online
          set(userStatusRef, {
            isOnline: true,
            lastSeen: serverTimestamp()
          });
        });
    });

    return () => {
      // Clean up when unmounting
      unsubscribe();
      // Set to offline manually when the component unmounts (e.g. logging out)
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
