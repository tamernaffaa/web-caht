// src/utils/webrtc-helpers.js

/**
 * Get ICE Servers configuration from self-hosted coturn on EC2.
 */
export const getIceServers = () => {
  const turnHost = import.meta.env.VITE_TURN_HOST || window.location.hostname;
  const turnPort = import.meta.env.VITE_TURN_PORT || '3478';
  const turnsPort = import.meta.env.VITE_TURNS_PORT || '5349';
  const turnUrl = import.meta.env.VITE_TURN_URL || `turn:${turnHost}:${turnPort}`;
  const turnTcpUrl = import.meta.env.VITE_TURN_TCP_URL || `turn:${turnHost}:${turnPort}?transport=tcp`;
  const turnsUrl = import.meta.env.VITE_TURNS_URL || `turns:${turnHost}:${turnsPort}?transport=tcp`;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME || 'turnuser';
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || 'turnpassword';

  return [
    {
      urls: [`stun:${turnHost}:${turnPort}`]
    },
    {
      urls: [turnUrl],
      username: turnUsername,
      credential: turnCredential
    },
    // TCP relay fallback helps in restrictive networks.
    {
      urls: [turnTcpUrl],
      username: turnUsername,
      credential: turnCredential
    },
    // TLS TURN endpoint if enabled in coturn.
    {
      urls: [turnsUrl],
      username: turnUsername,
      credential: turnCredential
    }
  ];
};

/**
 * Get user media (camera and microphone)
 */
/**
 * @param {boolean|object} videoOptions - true/false, or { quality: 'auto'|'low'|'medium'|'high'|{width,height}, facingMode }
 */
export const getUserMediaStream = async (videoOptions = true) => {
  const host = window.location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  const isSecure = window.isSecureContext || isLocalhost;

  if (!isSecure) {
    throw new Error('المكالمات على الهاتف تحتاج HTTPS. افتح التطبيق عبر رابط https وليس عنوان IP عادي.');
  }

  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('المتصفح الحالي لا يدعم getUserMedia. استخدم Chrome أو Safari وافتح الرابط خارج المتصفح الداخلي للتطبيقات.');
  }

  let videoConstraint = false;
  if (typeof videoOptions === 'boolean') {
    videoConstraint = videoOptions ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false;
  } else if (typeof videoOptions === 'object') {
    let quality = videoOptions.quality || 'auto';
    let facingMode = videoOptions.facingMode || 'user';
    if (quality === 'auto') {
      // Use network info if available
      let downlink = 2.5, effectiveType = '4g';
      if (navigator.connection) {
        downlink = navigator.connection.downlink || downlink;
        effectiveType = navigator.connection.effectiveType || effectiveType;
      }
      if (downlink < 0.7 || effectiveType === '2g') {
        quality = 'low';
      } else if (downlink < 1.5 || effectiveType === '3g') {
        quality = 'medium';
      } else {
        quality = 'high';
      }
    }
    if (quality === 'low') {
      videoConstraint = { width: { ideal: 320 }, height: { ideal: 240 }, facingMode };
    } else if (quality === 'medium') {
      videoConstraint = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode };
    } else if (quality === 'high') {
      videoConstraint = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode };
    } else if (typeof quality === 'object' && quality.width && quality.height) {
      videoConstraint = { width: { ideal: quality.width }, height: { ideal: quality.height }, facingMode };
    } else {
      videoConstraint = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode };
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraint,
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
    
    // Remove all old video tracks (Safari needs this)
    currentStream.getVideoTracks().forEach(track => {
      currentStream.removeTrack(track);
      track.stop();
    });
    currentStream.addTrack(newVideoTrack);
    return { newStream: currentStream, newVideoTrack, oldVideoTrack: currentVideoTrack };
  } catch (error) {
    console.error("Error switching camera:", error);
    return null;
  }
};
