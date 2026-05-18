import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, limit, getDocs, where } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

export function useUsers() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // For a real app, you would want server-side search (like Algolia or Typesense) 
  // because Firestore doesn't support native partial text search efficiently.
  // Here we just fetch a batch of users to show in a "New Chat" list.
  const fetchUsers = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      // Fetch up to 50 users who are not the current user
      const q = query(usersRef, where('uid', '!=', currentUser.uid), limit(50));
      const snapshot = await getDocs(q);
      
      const usersList = [];
      snapshot.forEach(doc => {
        usersList.push(doc.data());
      });
      setUsers(usersList);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [currentUser]);

  return { users, loading, refetch: fetchUsers };
}
