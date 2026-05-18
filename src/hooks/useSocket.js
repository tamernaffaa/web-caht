import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

// Use environment variable or default to localhost for development
const SIGNALING_SERVER_URL = import.meta.env.VITE_SIGNALING_SERVER || 'http://localhost:5000';

export function useSocket() {
  const { currentUser } = useAuth();
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      return;
    }

    const connectSocket = async () => {
      // Get Firebase Auth token for security
      const token = await currentUser.getIdToken();

      socketRef.current = io(SIGNALING_SERVER_URL, {
        auth: {
          token,
          userId: currentUser.uid
        },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });

      socketRef.current.on('connect', () => {
        console.log('Connected to signaling server:', socketRef.current.id);
        setIsConnected(true);
      });

      socketRef.current.on('disconnect', () => {
        console.log('Disconnected from signaling server');
        setIsConnected(false);
      });

      socketRef.current.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
      });
    };

    connectSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [currentUser]);

  return { socket: socketRef.current, isConnected };
}
