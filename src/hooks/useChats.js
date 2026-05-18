import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

export function useChats() {
  const { currentUser } = useAuth();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setChats([]);
      setLoading(false);
      return;
    }

    const chatsRef = collection(db, 'chats');
    const q = query(
      chatsRef, 
      where('participants', 'array-contains', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort by lastMessageAt descending (Firestore sometimes returns unstable order without orderby, 
      // but orderBy needs composite index with array-contains. Client side sorting is fine for small chat list).
      chatsData.sort((a, b) => {
        const timeA = a.lastMessageAt?.toMillis() || 0;
        const timeB = b.lastMessageAt?.toMillis() || 0;
        return timeB - timeA;
      });

      setChats(chatsData);
      setLoading(false);
    });

    return unsubscribe;
  }, [currentUser]);

  const startChat = async (otherUser) => {
    if (!currentUser) return null;

    // Check if chat already exists
    const chatsRef = collection(db, 'chats');
    const q = query(
      chatsRef,
      where('participants', 'array-contains', currentUser.uid)
    );
    const querySnapshot = await getDocs(q);
    
    let existingChat = null;
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.type === 'individual' && data.participants.includes(otherUser.uid)) {
        existingChat = { id: doc.id, ...data };
      }
    });

    if (existingChat) {
      return existingChat.id;
    }

    // Create new chat
    const newChatRef = await addDoc(collection(db, 'chats'), {
      type: 'individual',
      participants: [currentUser.uid, otherUser.uid],
      participantDetails: {
        [currentUser.uid]: { name: currentUser.displayName || 'You', avatar: currentUser.photoURL || '' },
        [otherUser.uid]: { name: otherUser.name, avatar: otherUser.avatar || '' }
      },
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      unreadCount: {
        [currentUser.uid]: 0,
        [otherUser.uid]: 0
      }
    });

    return newChatRef.id;
  };

  return { chats, loading, startChat };
}
