import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';

const PUBLIC_VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const registerPush = async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          console.warn('Push notifications not supported in this browser');
          return;
        }

        // Register Service Worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        
        // Wait until SW is ready
        await navigator.serviceWorker.ready;

        // Ask for permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.warn('Push notification permission denied');
          return;
        }

        // Subscribe to push
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });

        // Save subscription to user profile in Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
          pushSubscription: JSON.stringify(subscription)
        });

        console.log('Push subscription successful and saved.');

      } catch (error) {
        console.error('Error during push subscription:', error);
      }
    };

    registerPush();
  }, [currentUser]);

  return null;
}
