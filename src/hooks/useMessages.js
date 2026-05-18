import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  startAfter,
  getDocs,
  updateDoc,
  doc,
  getDoc
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

export function useMessages(chatId) {
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef(null);
  
  const MESSAGES_LIMIT = 20;

  // Initial load and real-time listener
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(MESSAGES_LIMIT)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.docs.length > 0) {
        lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < MESSAGES_LIMIT) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
      } else {
        setHasMore(false);
      }

      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).reverse(); // Reverse because we ordered by desc, but we want old->new visually

      setMessages(msgs);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [chatId]);

  // Load more old messages (Pagination)
  const loadMoreMessages = async () => {
    if (!hasMore || !lastDocRef.current || !chatId) return;
    
    setLoading(true);
    try {
      const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('timestamp', 'desc'),
        startAfter(lastDocRef.current),
        limit(MESSAGES_LIMIT)
      );
      
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
        const oldMsgs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })).reverse();
        
        setMessages(prev => [...oldMsgs, ...prev]);
        
        if (snapshot.docs.length < MESSAGES_LIMIT) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error loading more messages", error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text, type = 'text', mediaUrl = null) => {
    if (!chatId || !currentUser) return;

    const chatRef = doc(db, 'chats', chatId);

    // 1. Add message
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      text,
      type,
      mediaUrl,
      senderId: currentUser.uid,
      timestamp: serverTimestamp()
    });

    // 2. Update chat's last message
    await updateDoc(chatRef, {
      lastMessage: type === 'text' ? text : `[${type}]`,
      lastMessageAt: serverTimestamp()
    });

    // 3. Send Push Notification to the other user
    try {
      const chatSnap = await getDoc(chatRef);
      if (chatSnap.exists()) {
        const chatData = chatSnap.data();
        const otherUserId = chatData.participants.find(id => id !== currentUser.uid);
        
        if (otherUserId) {
          const userSnap = await getDoc(doc(db, 'users', otherUserId));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.pushSubscription && !userData.isOnline) {
              // Send request to Vercel Serverless Function
              fetch('/api/sendPush', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subscription: JSON.parse(userData.pushSubscription),
                  payload: {
                    title: currentUser.displayName || 'رسالة جديدة',
                    body: type === 'text' ? text : `أرسل لك [${type}]`,
                    url: '/'
                  }
                })
              }).catch(e => console.error('Push request error', e));
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to trigger push notification:', e);
    }
  };

  return { messages, loading, hasMore, loadMoreMessages, sendMessage };
}
