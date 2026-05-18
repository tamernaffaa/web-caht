import { useState } from 'react';
import { storage } from '../firebase/config';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { useAuth } from '../context/AuthContext';

export function useMediaStorage() {
  const { currentUser } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Helper to compress image
  const compressImage = async (file) => {
    const options = {
      maxSizeMB: 0.5, // Max size in MB (500 KB) to save Firebase Storage
      maxWidthOrHeight: 1280, // Max dimension
      useWebWorker: true
    };
    try {
      return await imageCompression(file, options);
    } catch (error) {
      console.error("Error compressing image:", error);
      return file; // Return original if compression fails
    }
  };

  // Upload file to Firebase Storage
  const uploadFile = async (file, chatId, type) => {
    if (!currentUser || !file || !chatId) return null;

    setUploading(true);
    setProgress(0);

    let fileToUpload = file;
    // Only compress if it's an image
    if (type === 'image' && file.type.startsWith('image/')) {
      fileToUpload = await compressImage(file);
    }

    const fileExtension = fileToUpload.name ? fileToUpload.name.split('.').pop() : (type === 'audio' ? 'webm' : 'bin');
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExtension}`;
    const storageRef = ref(storage, `chats/${chatId}/${type}s/${fileName}`);

    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, fileToUpload);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const prog = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setProgress(prog);
        },
        (error) => {
          console.error("Upload error:", error);
          setUploading(false);
          reject(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setUploading(false);
          setProgress(0);
          resolve(downloadURL);
        }
      );
    });
  };

  return { uploadFile, uploading, progress };
}
