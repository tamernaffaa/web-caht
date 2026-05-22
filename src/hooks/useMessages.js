import { useState, useEffect, useRef, useMemo } from 'react';
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
  getDoc,
  increment,
  writeBatch
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

export function useMessages(chatId) {
  const { currentUser } = useAuth();
  const [serverMessages, setServerMessages] = useState([]);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef(null);
  const receiptsUpdatingRef = useRef(false);
  const seenUpdatingRef = useRef(false);
  const markAsReadInFlightRef = useRef(false);
  const lastMarkAsReadAtRef = useRef(0);
  
  const MESSAGES_LIMIT = 20;

  const getQueueStorageKey = () => {
    if (!currentUser?.uid || !chatId) return null;
    return `pending_messages:${currentUser.uid}:${chatId}`;
  };

  const toStorablePending = (items) =>
    items.map((m) => ({
      id: m.id,
      clientMessageId: m.clientMessageId,
      text: m.text,
      type: m.type,
      mediaUrl: m.mediaUrl || null,
      replyTo: m.replyTo || null,
      senderId: m.senderId,
      status: m.status,
      error: m.error || null,
      timestampMs: m.timestamp?.toMillis ? m.timestamp.toMillis() : Date.now(),
      _localOnly: true
    }));

  const fromStorablePending = (items) =>
    (items || []).map((m) => ({
      ...m,
      timestamp: {
        toDate: () => new Date(m.timestampMs || Date.now()),
        toMillis: () => m.timestampMs || Date.now(),
        _local: true
      }
    }));

  // Initial load and real-time listener
  useEffect(() => {
    if (!chatId) {
      setServerMessages([]);
      setPendingMessages([]);
      return;
    }

    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(MESSAGES_LIMIT)
    );

    const applyDeliveryReceipts = async (docs) => {
      if (!currentUser?.uid || receiptsUpdatingRef.current) return;

      const batch = writeBatch(db);
      let updatesCount = 0;

      docs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data();
        if (data.senderId === currentUser.uid) return;

        if (!data.deliveredTo || !data.deliveredTo[currentUser.uid]) {
          batch.update(snapshotDoc.ref, {
            [`deliveredTo.${currentUser.uid}`]: serverTimestamp()
          });
          updatesCount += 1;
        }
      });

      if (!updatesCount) return;
      receiptsUpdatingRef.current = true;
      try {
        await batch.commit();
      } catch (error) {
        console.error('Failed to apply delivery receipts:', error);
      } finally {
        receiptsUpdatingRef.current = false;
      }
    };

    const applySeenReceipts = async (docs) => {
      if (!currentUser?.uid || seenUpdatingRef.current || !chatId) return;

      const batch = writeBatch(db);
      let updatesCount = 0;

      docs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data();
        if (data.senderId === currentUser.uid) return;
        if (data.seenTo && data.seenTo[currentUser.uid]) return;

        batch.update(snapshotDoc.ref, {
          [`seenTo.${currentUser.uid}`]: serverTimestamp(),
          [`deliveredTo.${currentUser.uid}`]: data.deliveredTo?.[currentUser.uid] || serverTimestamp()
        });
        updatesCount += 1;
      });

      // Keep unread counter in sync instantly for active chat.
      if (updatesCount > 0) {
        const chatRef = doc(db, 'chats', chatId);
        batch.update(chatRef, {
          [`unreadCount.${currentUser.uid}`]: 0,
          [`lastReadAt.${currentUser.uid}`]: serverTimestamp()
        });
      }

      if (!updatesCount) return;
      seenUpdatingRef.current = true;
      try {
        await batch.commit();
      } catch (error) {
        console.error('Failed to apply seen receipts:', error);
      } finally {
        seenUpdatingRef.current = false;
      }
    };

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
        status: 'sent',
        ...doc.data()
      })).reverse(); // Query is desc; reverse for UI old->new

      setServerMessages(msgs);

      const ackedClientIds = new Set(
        msgs
          .map((m) => m.clientMessageId)
          .filter(Boolean)
      );

      // Remove pending messages that are already acknowledged by Firestore.
      setPendingMessages((prev) => prev.filter((m) => !ackedClientIds.has(m.clientMessageId)));
      setLoading(false);

      applyDeliveryReceipts(snapshot.docs);
      applySeenReceipts(snapshot.docs);
    });

    return () => unsubscribe();
  }, [chatId, currentUser?.uid]);

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
          status: 'sent',
          ...doc.data()
        })).reverse();
        
        // Older chunk should be added before current list in old->new UI.
        setServerMessages(prev => [...oldMsgs, ...prev]);
        
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

  const createLocalTimestamp = () => {
    const now = Date.now();
    return {
      toDate: () => new Date(now),
      toMillis: () => now,
      _local: true
    };
  };

  const createClientMessageId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  };

  const updatePendingMessage = (localId, updates) => {
    setPendingMessages((prev) =>
      prev.map((msg) => (msg.id === localId ? { ...msg, ...updates } : msg))
    );
  };

  const upsertPendingMessage = (message) => {
    setPendingMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === message.id);
      if (idx === -1) return [...prev, message];
      const clone = [...prev];
      clone[idx] = { ...clone[idx], ...message };
      return clone;
    });
  };

  const sendMessageToServer = async ({ chatId, chatRef, currentUser, text, type, mediaUrl, clientMessageId, replyTo = null }) => {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      text,
      type,
      mediaUrl,
      senderId: currentUser.uid,
      clientMessageId,
      replyTo,
      isEdited: false,
      isDeleted: false,
      deliveredTo: {
        [currentUser.uid]: true
      },
      seenTo: {},
      timestamp: serverTimestamp()
    });

    await updateDoc(chatRef, {
      lastMessage: type === 'text' ? text : `[${type}]`,
      lastMessageAt: serverTimestamp()
    });
  };

  const retryMessageItem = async (target) => {
    if (!target || !chatId || !currentUser) return;

    const chatRef = doc(db, 'chats', chatId);
    updatePendingMessage(target.id, {
      status: 'sending',
      error: null,
      timestamp: createLocalTimestamp()
    });

    try {
      await sendMessageToServer({
        chatId,
        chatRef,
        currentUser,
        text: target.text,
        type: target.type,
        mediaUrl: target.mediaUrl || null,
        clientMessageId: target.clientMessageId,
        replyTo: target.replyTo || null
      });
      updatePendingMessage(target.id, { status: 'sent' });
    } catch (error) {
      console.error('Retry failed:', error);
      updatePendingMessage(target.id, { status: 'failed', error: error?.message || 'retry-failed' });
    }
  };

  const sendMessage = async (text, type = 'text', mediaUrl = null, options = {}) => {
    if (!chatId || !currentUser) return;
    const { replyTo = null } = options;

    const chatRef = doc(db, 'chats', chatId);
    const clientMessageId = createClientMessageId();
    const localId = `local-${clientMessageId}`;

    upsertPendingMessage({
      id: localId,
      clientMessageId,
      text,
      type,
      mediaUrl,
      replyTo,
      senderId: currentUser.uid,
      timestamp: createLocalTimestamp(),
      status: 'sending',
      _localOnly: true
    });

    try {
      await sendMessageToServer({
        chatId,
        chatRef,
        currentUser,
        text,
        type,
        mediaUrl,
        clientMessageId,
        replyTo
      });

      // Keep locally as sent until Firestore snapshot arrives and acknowledges it.
      updatePendingMessage(localId, { status: 'sent' });
    } catch (error) {
      console.error('Message send failed:', error);
      updatePendingMessage(localId, { status: 'failed', error: error?.message || 'send-failed' });
      return;
    }

    // 3. Send Push Notification to the other user
    try {
      const chatSnap = await getDoc(chatRef);
      if (chatSnap.exists()) {
        const chatData = chatSnap.data();
        const otherUserId = chatData.participants.find(id => id !== currentUser.uid);

        if (otherUserId) {
          await updateDoc(chatRef, {
            [`unreadCount.${otherUserId}`]: increment(1),
            [`unreadCount.${currentUser.uid}`]: 0
          });
        }
        
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

  const retryMessage = async (localMessageId) => {
    const target = pendingMessages.find((m) => m.id === localMessageId && m.status === 'failed');
    if (!target) return;
    await retryMessageItem(target);
  };

  const markAsRead = async () => {
    if (!chatId || !currentUser) return;
    if (markAsReadInFlightRef.current) return;

    const now = Date.now();
    // Avoid excessive writes during rapid snapshot updates.
    if (now - lastMarkAsReadAtRef.current < 450) return;

    try {
      markAsReadInFlightRef.current = true;
      const chatRef = doc(db, 'chats', chatId);
      await updateDoc(chatRef, {
        [`unreadCount.${currentUser.uid}`]: 0,
        [`lastReadAt.${currentUser.uid}`]: serverTimestamp()
      });

      const msgsQ = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('timestamp', 'desc'),
        limit(MESSAGES_LIMIT)
      );
      const msgSnap = await getDocs(msgsQ);
      const batch = writeBatch(db);
      let updatesCount = 0;

      msgSnap.docs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data();
        if (data.senderId === currentUser.uid) return;
        if (data.seenTo && data.seenTo[currentUser.uid]) return;

        batch.update(snapshotDoc.ref, {
          [`seenTo.${currentUser.uid}`]: serverTimestamp(),
          [`deliveredTo.${currentUser.uid}`]: data.deliveredTo?.[currentUser.uid] || serverTimestamp()
        });
        updatesCount += 1;
      });

      if (updatesCount) {
        await batch.commit();
      }
    } catch (error) {
      console.error('Failed to mark chat as read:', error);
    } finally {
      markAsReadInFlightRef.current = false;
      lastMarkAsReadAtRef.current = Date.now();
    }
  };

  const editMessage = async (messageId, newText) => {
    if (!chatId || !currentUser || !messageId || !newText?.trim()) return;

    const msgRef = doc(db, 'chats', chatId, 'messages', messageId);
    await updateDoc(msgRef, {
      text: newText.trim(),
      isEdited: true,
      editedAt: serverTimestamp()
    });
  };

  const deleteMessage = async (messageId) => {
    if (!chatId || !currentUser || !messageId) return;

    const msgRef = doc(db, 'chats', chatId, 'messages', messageId);
    await updateDoc(msgRef, {
      text: 'رسالة محذوفة',
      mediaUrl: null,
      type: 'text',
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: currentUser.uid
    });
  };

  // Restore pending queue for this user/chat from localStorage.
  useEffect(() => {
    const key = getQueueStorageKey();
    if (!key) return;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setPendingMessages([]);
        return;
      }

      const parsed = JSON.parse(raw);
      const restored = fromStorablePending(parsed);
      setPendingMessages(restored);
    } catch (error) {
      console.error('Failed to restore pending queue:', error);
      setPendingMessages([]);
    }
  }, [chatId, currentUser?.uid]);

  // Persist queue whenever pending messages change.
  useEffect(() => {
    const key = getQueueStorageKey();
    if (!key) return;

    try {
      if (!pendingMessages.length) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify(toStorablePending(pendingMessages)));
    } catch (error) {
      console.error('Failed to persist pending queue:', error);
    }
  }, [pendingMessages, chatId, currentUser?.uid]);

  // Auto-retry failed messages when network comes back.
  useEffect(() => {
    if (!chatId || !currentUser?.uid) return;

    let isRetrying = false;
    const retryFailedBatch = async () => {
      if (isRetrying) return;
      const failed = pendingMessages.filter((m) => m.status === 'failed');
      if (!failed.length) return;

      isRetrying = true;
      for (const msg of failed) {
        await retryMessageItem(msg);
      }
      isRetrying = false;
    };

    const handleOnline = () => {
      retryFailedBatch();
    };

    window.addEventListener('online', handleOnline);

    // Try once on mount if already online.
    if (navigator.onLine) {
      retryFailedBatch();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [pendingMessages, chatId, currentUser?.uid]);

  const messages = useMemo(() => {
    const serverClientIds = new Set(serverMessages.map((m) => m.clientMessageId).filter(Boolean));
    const unresolvedPending = pendingMessages.filter((m) => !serverClientIds.has(m.clientMessageId));
    const combined = [...serverMessages, ...unresolvedPending];

    return combined.sort((a, b) => {
      const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return ta - tb;
    });
  }, [serverMessages, pendingMessages]);

  return {
    messages,
    loading,
    hasMore,
    loadMoreMessages,
    sendMessage,
    retryMessage,
    editMessage,
    deleteMessage,
    markAsRead
  };
}
