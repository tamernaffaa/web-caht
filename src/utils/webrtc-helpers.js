// src/utils/webrtc-helpers.js

/**
 * Get ICE Servers configuration including STUN and fallback TURN servers.
 */
export const getIceServers = () => {
  return [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.services.mozilla.com'
      ]
    },
    // Optional Free TURN Server (e.g. metered.ca open relay)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];
};

/**
 * Get user media (camera and microphone)
 */
export const getUserMediaStream = async (isVideoEnabled = true) => {
  const host = window.location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  const isSecure = window.isSecureContext || isLocalhost;

  if (!isSecure) {
    throw new Error('المكالمات على الهاتف تحتاج HTTPS. افتح التطبيق عبر رابط https وليس عنوان IP عادي.');
  }

  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('المتصفح الحالي لا يدعم getUserMedia. استخدم Chrome أو Safari وافتح الرابط خارج المتصفح الداخلي للتطبيقات.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: isVideoEnabled ? {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      } : false,
      audio: true
    });
    return stream;
  } catch (error) {
    console.error("Error accessing media devices:", error);
    if (error?.name === 'NotAllowedError') {
      throw new Error('تم رفض صلاحية الكاميرا/الميكروفون. اسمح بالصلاحيات ثم أعد المحاولة.');
    }
    if (error?.name === 'NotFoundError') {
      throw new Error('لا توجد كاميرا أو ميكروفون متاحان على هذا الجهاز.');
    }
    if (error?.name === 'NotReadableError') {
      throw new Error('تعذر تشغيل الكاميرا/الميكروفون. قد يكون مستخدما في تطبيق آخر.');
    }
    throw new Error('تعذر بدء المكالمة بسبب مشكلة في الكاميرا/الميكروفون.');
  }
};

/**
 * Stop all tracks in a media stream
 */
export const stopMediaStream = (stream) => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
};

/**
 * Toggle track enabled state (mute/unmute or video on/off)
 */
export const toggleTrack = (stream, type, state) => {
  if (!stream) return;
  const tracks = type === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  tracks.forEach(track => {
    track.enabled = state !== undefined ? state : !track.enabled;
  });
};

/**
 * Switch camera (front/back on mobile)
 */
export const switchCamera = async (currentStream) => {
  // Check if we have multiple cameras
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  
  if (videoDevices.length <= 1) {
    return currentStream; // Can't switch
  }

  const currentVideoTrack = currentStream.getVideoTracks()[0];
  const currentSettings = currentVideoTrack.getSettings();
  const newFacingMode = currentSettings.facingMode === 'user' ? 'environment' : 'user';
  
  // Stop current video track
  currentVideoTrack.stop();

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacingMode },
      audio: false // keep existing audio
    });

    const newVideoTrack = newStream.getVideoTracks()[0];
    
    // Remove old video track and add new one
    currentStream.removeTrack(currentVideoTrack);
    currentStream.addTrack(newVideoTrack);
    
    return { newStream: currentStream, newVideoTrack };
  } catch (error) {
    console.error("Error switching camera:", error);
    return null;
  }
};
