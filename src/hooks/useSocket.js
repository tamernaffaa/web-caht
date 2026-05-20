import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { auth } from '../firebase/config';

// Prefer explicit env URL. Fallback to current host (useful for mobile on same Wi-Fi).
const SIGNALING_SERVER_URL =
  import.meta.env.VITE_SIGNALING_SERVER ||
  `http://${window.location.hostname}:5000`;

export function useSocket() {
  const { currentUser } = useAuth();
  const userId = currentUser?.uid;
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    if (!userId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      setIsConnected(false);
      setConnectionError(null);
      return;
    }

    const connectSocket = async () => {
      try {
        // Get Firebase Auth token for security
        const firebaseUser = auth.currentUser;
        const tokenSource =
          firebaseUser && typeof firebaseUser.getIdToken === 'function'
            ? firebaseUser
            : (currentUser && typeof currentUser.getIdToken === 'function' ? currentUser : null);

        if (!tokenSource) {
          throw new Error('Firebase auth user is not ready');
        }

        const token = await tokenSource.getIdToken();

        const nextSocket = io(SIGNALING_SERVER_URL, {
          auth: {
            token,
            userId
          },
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          transports: ['websocket', 'polling']
        });

        socketRef.current = nextSocket;
        setSocket(nextSocket);

        nextSocket.on('connect', () => {
          console.log('Connected to signaling server:', nextSocket.id);
          setIsConnected(true);
          setConnectionError(null);
        });

        nextSocket.on('disconnect', () => {
          console.log('Disconnected from signaling server');
          setIsConnected(false);
        });

        nextSocket.on('connect_error', (err) => {
          console.error('Socket connection error:', err.message);
          setConnectionError(err.message || 'Socket connection failed');
          setIsConnected(false);
        });
      } catch (err) {
        console.error('Failed to initialize socket:', err);
        setConnectionError(err?.message || 'Failed to initialize socket');
        setIsConnected(false);
      }
    };

    connectSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      setIsConnected(false);
    };
  }, [userId]);

  return { socket, isConnected, connectionError };
}
