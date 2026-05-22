import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../hooks/useChats';
import { useMessages } from '../hooks/useMessages';
import { useUsers } from '../hooks/useUsers';
import { useMediaStorage } from '../hooks/useMediaStorage';
import { listenToUserPresence, listenToTyping, setTypingStatus } from '../hooks/usePresence';
import { buildNewestMessageKey, shouldIncrementNewMessageCount } from '../utils/chat-behavior';
import { soundManager } from '../utils/sound-manager';
import { LogOut, Plus, Search, Send, User, Paperclip, Image as ImageIcon, FileText, MapPin, Mic, Square, Loader, ArrowRight, Reply, Pencil, Trash2, X, ArrowDown, SlidersHorizontal } from 'lucide-react';

// Call Components
import CallButton from '../components/CallButton';
import IncomingCallModal from '../components/IncomingCallModal';
import VideoCall from '../components/VideoCall';
import MessageBubble from '../components/MessageBubble';

export default function ChatInterface() {
  const { currentUser, logout } = useAuth();
  const { chats, startChat } = useChats();
  const { users } = useUsers();
  const { uploadFile, uploading, progress } = useMediaStorage();
  
  const [activeChatId, setActiveChatId] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [showUsersList, setShowUsersList] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [otherUserStatus, setOtherUserStatus] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [actionMenuMessage, setActionMenuMessage] = useState(null);
  const [swipePreview, setSwipePreview] = useState({ messageId: null, offsetX: 0 });
  const [swipeToast, setSwipeToast] = useState('');
  const [swipeToastVisible, setSwipeToastVisible] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);

  const fallbackAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239ca3af'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
  const handleImageError = useCallback((e) => {
    e.target.onerror = null;
    e.target.src = fallbackAvatar;
  }, [fallbackAvatar]);

  const updateSoundSettings = useCallback((partial) => {
    const next = soundManager.updateSettings(partial);
    setSoundSettings(next);
  }, []);

  const setVolumeLevel = useCallback((level) => {
    updateSoundSettings({ volumeLevel: level });
  }, [updateSoundSettings]);

  const {
    messages,
    loading: msgsLoading,
    hasMore,
    loadMoreMessages,
    sendMessage,
    retryMessage,
    editMessage,
    deleteMessage,
    markAsRead
  } = useMessages(activeChatId);
  
  const virtuosoRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const previousUnreadByChatRef = useRef({});
  const unreadTrackerInitializedRef = useRef(false);
  const lastReadSyncKeyRef = useRef('');
  const initialScrollDoneRef = useRef(false);
  const userBrowsingHistoryRef = useRef(false);
  const lastNewestMessageKeyRef = useRef('');
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [newMsgWhileAway, setNewMsgWhileAway] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [soundSettings, setSoundSettings] = useState(() => soundManager.getSettings());
  const imageInputRef = useRef(null);
  const docInputRef = useRef(null);
  
  // Audio Recording Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const typingTimeoutRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const swipeGestureRef = useRef({ messageId: null, startX: 0, startY: 0, triggered: false });

  // Scroll to and highlight a message by id
  // Scroll to a message by id, loading more if needed
  const scrollToMessage = useCallback(async (msgId, tryCount = 0) => {
    if (!msgId) return;

    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex >= 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: msgIndex, align: 'center', behavior: 'smooth' });
      setHighlightedMsgId(msgId);
      setTimeout(() => setHighlightedMsgId(null), 1400);
      return;
    }

    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMsgId(msgId);
      setTimeout(() => setHighlightedMsgId(null), 1400);
      return;
    }

    // If not found, try loading more messages (pagination)
    if (tryCount < 5 && hasMore && typeof loadMoreMessages === 'function') {
      await loadMoreMessages();
      setTimeout(() => {
        scrollToMessage(msgId, tryCount + 1);
      }, 350);
    }
  }, [messages, hasMore, loadMoreMessages]);

  // Scroll to bottom helper (direct container scroll is more reliable than scrollIntoView).
  const scrollToBottom = useCallback((smooth = true) => {
    userBrowsingHistoryRef.current = false;
    if (!messages.length || !virtuosoRef.current) return;
    virtuosoRef.current.scrollToIndex({
      index: messages.length - 1,
      align: 'end',
      behavior: smooth ? 'smooth' : 'auto'
    });

    // Ensure the flag stays in sync after layout settles.
    requestAnimationFrame(() => {
      const latestEl = messagesContainerRef.current;
      if (!latestEl) return;
      const atBottom = latestEl.scrollHeight - latestEl.scrollTop - latestEl.clientHeight < 100;
      userBrowsingHistoryRef.current = !atBottom;
      if (atBottom) {
        setNewMsgWhileAway(false);
        setNewMsgCount(0);
      }
    });
  }, [messages.length]);

  // Auto scroll on genuinely new latest message unless user is browsing old messages.
  useEffect(() => {
    if (!messagesContainerRef.current) return;
    if (!messages.length) return;

    const newest = messages[messages.length - 1];
    const newestKey = buildNewestMessageKey(newest);
    const prevKey = lastNewestMessageKeyRef.current;
    lastNewestMessageKeyRef.current = newestKey;

    if (!prevKey || prevKey === newestKey) return;

    if (!userBrowsingHistoryRef.current) {
      if (newest?.senderId !== currentUser?.uid) {
        soundManager.playMessageReceived();
      }
      scrollToBottom(false);
      setNewMsgWhileAway(false);
      setNewMsgCount(0);
    } else {
      setNewMsgWhileAway(true);
      if (shouldIncrementNewMessageCount({
        isBrowsingHistory: userBrowsingHistoryRef.current,
        isIncomingMessage: newest?.senderId !== currentUser?.uid
      })) {
        soundManager.playMessageReceived();
        setNewMsgCount((prev) => prev + 1);
      }
    }
  }, [messages, currentUser?.uid]);

  // Non-active chats: play one receive sound when unread count increases.
  useEffect(() => {
    if (!currentUser?.uid) return;

    const nextUnreadByChat = {};
    let hasIncrease = false;

    chats.forEach((chat) => {
      const unread = chat.unreadCount?.[currentUser.uid] || 0;
      nextUnreadByChat[chat.id] = unread;

      if (!unreadTrackerInitializedRef.current) return;
      if (chat.id === activeChatId) return;

      const prevUnread = previousUnreadByChatRef.current[chat.id] || 0;
      if (unread > prevUnread) {
        hasIncrease = true;
      }
    });

    if (unreadTrackerInitializedRef.current && hasIncrease) {
      soundManager.playMessageReceived();
    }

    previousUnreadByChatRef.current = nextUnreadByChat;
    unreadTrackerInitializedRef.current = true;
  }, [chats, activeChatId, currentUser?.uid]);

  // On first open of a chat, jump to latest messages (bottom), like WhatsApp.
  useEffect(() => {
    initialScrollDoneRef.current = false;
    userBrowsingHistoryRef.current = false;
    lastNewestMessageKeyRef.current = '';
    setNewMsgCount(0);
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) return;
    if (initialScrollDoneRef.current) return;
    if (msgsLoading) return;
    if (!messages.length) return;

    scrollToBottom(false);
    userBrowsingHistoryRef.current = false;
    const newest = messages[messages.length - 1];
    lastNewestMessageKeyRef.current = buildNewestMessageKey(newest);
    setNewMsgWhileAway(false);
    setNewMsgCount(0);
    initialScrollDoneRef.current = true;
  }, [activeChatId, msgsLoading, messages.length]);

  const handleAtBottomStateChange = useCallback((atBottom) => {
    userBrowsingHistoryRef.current = !atBottom;
    setShowScrollToBottom(!atBottom);
    if (atBottom) {
      setNewMsgWhileAway(false);
      setNewMsgCount(0);
    }
  }, []);

  const handleStartReached = useCallback(() => {
    if (hasMore && !msgsLoading) {
      loadMoreMessages();
    }
  }, [hasMore, msgsLoading, loadMoreMessages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const trimmedText = messageText.trim();
    if (!trimmedText) return;

    if (editingMessageId) {
      const editTargetId = editingMessageId;
      const editedText = trimmedText;

      // Clear immediately in edit mode as well.
      setMessageText('');
      setEditingMessageId(null);
      setReplyingTo(null);
      if (activeChatId && currentUser?.uid) {
        setTypingStatus(activeChatId, currentUser.uid, false).catch(() => {});
      }

      editMessage(editTargetId, editedText).catch((error) => {
        console.error('Edit message failed:', error);
      });
      return;
    }

    const textToSend = trimmedText;
    const replyToMessage = replyingTo;

    // Optimistic clear: don't keep text in input while waiting on slow network.
    setMessageText('');
    setReplyingTo(null);
    if (activeChatId && currentUser?.uid) {
      setTypingStatus(activeChatId, currentUser.uid, false).catch(() => {});
    }

    soundManager.playMessageSent();

    sendMessage(textToSend, 'text', null, { replyTo: replyToMessage }).catch((error) => {
      console.error('Send message failed:', error);
    });
  };

  const handleMessageInputChange = useCallback((value) => {
    setMessageText(value);
    if (!activeChatId || !currentUser?.uid) return;

    setTypingStatus(activeChatId, currentUser.uid, value.trim().length > 0).catch(() => {});

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setTypingStatus(activeChatId, currentUser.uid, false).catch(() => {});
    }, 1200);
  }, [activeChatId, currentUser?.uid]);

  const toReplyPreview = useCallback((msg) => ({
    messageId: msg.id,
    senderId: msg.senderId,
    textPreview: msg.isDeleted ? 'تم حذف هذه الرسالة' : (msg.text || '[مرفق]'),
    type: msg.type || 'text'
  }), []);

  const handleReplyToMessage = useCallback((msg) => {
    setEditingMessageId(null);
    setReplyingTo(toReplyPreview(msg));
    setActionMenuMessage(null);
  }, [toReplyPreview]);

  const handleEditMessage = useCallback((msg) => {
    setReplyingTo(null);
    setEditingMessageId(msg.id);
    setMessageText(msg.text || '');
    setActionMenuMessage(null);
  }, []);

  const handleDeleteMessage = useCallback(async (msg) => {
    await deleteMessage(msg.id);
    if (editingMessageId === msg.id) {
      setEditingMessageId(null);
      setMessageText('');
    }
    setActionMenuMessage(null);
  }, [deleteMessage, editingMessageId]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleMessageTouchStart = useCallback((msg) => {
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      setActionMenuMessage(msg);
    }, 450);
  }, [clearLongPressTimer]);

  const handleMessageTouchEnd = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  const handleSwipeStart = useCallback((event, msg) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    setSwipePreview({ messageId: msg.id, offsetX: 0 });
    swipeGestureRef.current = {
      messageId: msg.id,
      startX: touch.clientX,
      startY: touch.clientY,
      triggered: false
    };
  }, []);

  const handleSwipeMove = useCallback((event, msg) => {
    const touch = event.touches?.[0];
    if (!touch) return;

    const gesture = swipeGestureRef.current;
    if (!gesture || gesture.messageId !== msg.id || gesture.triggered) return;

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const horizontal = Math.abs(deltaX);
    const vertical = Math.abs(deltaY);
    const limitedOffset = Math.max(-72, Math.min(72, deltaX));

    if (horizontal > vertical) {
      setSwipePreview({ messageId: msg.id, offsetX: limitedOffset });
    }

    // If user is swiping horizontally, prevent long-press from opening.
    if (horizontal > 18 && horizontal > vertical) {
      clearLongPressTimer();
    }

    if (horizontal > 90 && horizontal > vertical) {
      swipeGestureRef.current.triggered = true;
      handleReplyToMessage(msg);
      setActionMenuMessage(null);
      setSwipePreview({ messageId: null, offsetX: 0 });
      setSwipeToast('تم اختيار الرسالة للرد');
      if (navigator.vibrate) navigator.vibrate(10);
    }
  }, [clearLongPressTimer, handleReplyToMessage]);

  const handleSwipeEnd = useCallback(() => {
    setSwipePreview({ messageId: null, offsetX: 0 });
    swipeGestureRef.current = { messageId: null, startX: 0, startY: 0, triggered: false };
    handleMessageTouchEnd();
  }, [handleMessageTouchEnd]);

  const handleStartChat = useCallback(async (otherUser) => {
    const chatId = await startChat(otherUser);
    if (chatId) {
      setActiveChatId(chatId);
      setShowUsersList(false);
    }
  }, [startChat]);

  // ----- MEDIA HANDLING -----
  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file || !activeChatId) return;
    setShowAttachMenu(false);
    
    try {
      const url = await uploadFile(file, activeChatId, type);
      if (url) {
        await sendMessage(file.name || 'ملف مرفق', type, url);
      }
    } catch (error) {
      alert("فشل رفع الملف");
    }
    e.target.value = ''; // reset input
  };

  const sendLocation = () => {
    setShowAttachMenu(false);
    if (!navigator.geolocation) {
      alert("المتصفح لا يدعم تحديد الموقع");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
        await sendMessage(mapsUrl, 'location', mapsUrl);
      },
      () => alert("فشل الحصول على الموقع")
    );
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
        
        try {
          // File constructor is not supported in all older browsers, but Blob is fine for Firebase
          const file = new File([audioBlob], 'voice-note.webm', { type: 'audio/webm' });
          const url = await uploadFile(file, activeChatId, 'audio');
          if (url) {
            await sendMessage('ملاحظة صوتية', 'audio', url);
          }
        } catch (err) {
          alert("فشل إرسال الصوت");
        }
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("الرجاء السماح بصلاحية المايكروفون");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // ----- RENDER HELPERS -----
  const getOtherParticipant = (chat) => {
    if (!chat || !chat.participantDetails) return null;
    const otherId = chat.participants.find(id => id !== currentUser.uid);
    return chat.participantDetails[otherId];
  };

  const renderMessageContent = useCallback((msg, isMe) => {
    if (msg.isDeleted) {
      return <p className="text-sm italic opacity-80">{isMe ? 'حذفت هذه الرسالة' : 'رسالة محذوفة'}</p>;
    }

    switch (msg.type) {
      case 'image':
        return (
          <div className="space-y-1">
            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
              <img src={msg.mediaUrl} alt="attachment" className="max-w-[200px] sm:max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition" />
            </a>
            <p className="text-sm px-1">{msg.text !== msg.mediaUrl ? msg.text : ''}</p>
          </div>
        );
      case 'audio':
        return (
          <div className="flex flex-col">
            <p className="text-xs mb-1 opacity-80">🎤 ملاحظة صوتية</p>
            <audio src={msg.mediaUrl} controls className="h-8 max-w-[200px]" />
          </div>
        );
      case 'document':
        return (
          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline">
            <FileText size={20} />
            <span className="text-sm truncate max-w-[150px]">{msg.text}</span>
          </a>
        );
      case 'location':
        return (
          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline text-blue-100">
            <MapPin size={20} className={!isMe ? 'text-blue-500' : ''} />
            <span className="text-sm">موقعي الجغرافي</span>
          </a>
        );
      default:
        return <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>;
    }
  }, []);

  const activeChatDetails = chats.find(c => c.id === activeChatId);
  const activeChatOtherUser = getOtherParticipant(activeChatDetails);

  useEffect(() => {
    if (activeChatOtherUser?.uid) {
      const unsubscribe = listenToUserPresence(activeChatOtherUser.uid, (status) => {
        setOtherUserStatus(status);
      });
      return () => unsubscribe();
    } else {
      setOtherUserStatus(null);
    }
  }, [activeChatOtherUser?.uid]);

  useEffect(() => {
    if (!activeChatId || !activeChatOtherUser?.uid) {
      setOtherUserTyping(false);
      return;
    }

    const unsubscribe = listenToTyping(activeChatId, activeChatOtherUser.uid, (isTyping) => {
      setOtherUserTyping(isTyping);
    });

    return () => unsubscribe();
  }, [activeChatId, activeChatOtherUser?.uid]);

  useEffect(() => {
    if (!activeChatId || !currentUser?.uid || !messages.length) return;

    const latestUnreadIncoming = [...messages]
      .reverse()
      .find((m) => m.senderId !== currentUser.uid && !m._localOnly && !m.seenTo?.[currentUser.uid]);

    if (!latestUnreadIncoming) return;

    const ts = latestUnreadIncoming.timestamp?.toMillis ? latestUnreadIncoming.timestamp.toMillis() : 0;
    const syncKey = `${activeChatId}:${latestUnreadIncoming.id || latestUnreadIncoming.clientMessageId || 'unknown'}:${ts}`;
    if (lastReadSyncKeyRef.current === syncKey) return;
    lastReadSyncKeyRef.current = syncKey;

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(() => {
        markAsRead();
      });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = setTimeout(() => {
      markAsRead();
    }, 80);
    return () => clearTimeout(timeoutId);
  }, [activeChatId, currentUser?.uid, messages, markAsRead]);

  useEffect(() => {
    lastReadSyncKeyRef.current = '';
  }, [activeChatId]);

  useEffect(() => {
    if (!swipeToast) return;

    setSwipeToastVisible(true);

    const hideTimer = setTimeout(() => {
      setSwipeToastVisible(false);
    }, 1200);

    const clearTimer = setTimeout(() => {
      setSwipeToast('');
    }, 1450);

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(clearTimer);
    };
  }, [swipeToast]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      setSwipePreview({ messageId: null, offsetX: 0 });
      swipeGestureRef.current = { messageId: null, startX: 0, startY: 0, triggered: false };
      if (activeChatId && currentUser?.uid) {
        setTypingStatus(activeChatId, currentUser.uid, false).catch(() => {});
      }
    };
  }, [activeChatId, currentUser?.uid]);

  const renderStatus = () => {
    if (otherUserTyping) return <p className="text-xs text-blue-500">يكتب الآن...</p>;
    if (!otherUserStatus) return <p className="text-xs text-gray-400">غير متصل</p>;
    if (otherUserStatus.isOnline) return <p className="text-xs text-green-500">متصل الآن</p>;
    
    // Format last seen
    const date = new Date(otherUserStatus.lastSeen);
    const now = new Date();
    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return <p className="text-xs text-gray-500">آخر ظهور: {isToday ? 'اليوم' : date.toLocaleDateString()} {timeStr}</p>;
  };

  const getMessageDeliveryState = useCallback((msg, isMe) => {
    if (!isMe) return null;

    if (msg.status === 'sending') return 'sending';
    if (msg.status === 'failed') return 'failed';

    const otherUserId = activeChatOtherUser?.uid || activeChatDetails?.participants?.find((id) => id !== currentUser.uid);
    if (!otherUserId) return 'sent';

    if (msg.seenTo?.[otherUserId]) return 'seen';
    if (msg.deliveredTo?.[otherUserId]) return 'delivered';
    return 'sent';
  }, [activeChatOtherUser?.uid, activeChatDetails?.participants, currentUser?.uid]);

  const formatReceiptTime = useCallback((ts) => {
    if (!ts?.toDate) return '';
    const d = ts.toDate();
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }, []);

  const getDeliveryTitle = useCallback((msg, state, isMe) => {
    if (!isMe) return '';
    const otherUserId = activeChatOtherUser?.uid || activeChatDetails?.participants?.find((id) => id !== currentUser.uid);
    if (!otherUserId) return '';

    if (state === 'seen') {
      const seenAt = formatReceiptTime(msg.seenTo?.[otherUserId]);
      return seenAt ? `تمت القراءة: ${seenAt}` : 'تمت القراءة';
    }
    if (state === 'delivered') {
      const deliveredAt = formatReceiptTime(msg.deliveredTo?.[otherUserId]);
      return deliveredAt ? `تم التسليم: ${deliveredAt}` : 'تم التسليم';
    }
    return '';
  }, [activeChatOtherUser?.uid, activeChatDetails?.participants, currentUser?.uid, formatReceiptTime]);

  const handleBubbleContextMenu = useCallback((e, targetMsg, allowed) => {
    e.preventDefault();
    if (allowed) {
      setActionMenuMessage(targetMsg);
    }
  }, []);

  const handleBubbleTouchStart = useCallback((e, targetMsg, allowed) => {
    if (!allowed) return;
    handleSwipeStart(e, targetMsg);
    handleMessageTouchStart(targetMsg);
  }, [handleMessageTouchStart, handleSwipeStart]);

  const handleBubbleTouchMove = useCallback((e, targetMsg, allowed) => {
    if (!allowed) return;
    handleSwipeMove(e, targetMsg);
  }, [handleSwipeMove]);

  const setMessagesScrollerRef = useCallback((ref) => {
    if (ref) {
      messagesContainerRef.current = ref;
    }
  }, []);

  const virtuosoComponents = useMemo(() => ({
    Header: () => (
      hasMore ? (
        <div className="text-center py-2">
          <span className="text-xs bg-white text-gray-500 px-3 py-1 rounded-full shadow-sm cursor-pointer hover:bg-gray-50" onClick={loadMoreMessages}>
            {msgsLoading ? 'جاري التحميل...' : 'تحميل رسائل أقدم'}
          </span>
        </div>
      ) : null
    ),
    Footer: () => (
      uploading ? (
        <div className="flex justify-end py-2">
          <div className="p-3 rounded-lg bg-blue-100 text-blue-800 rounded-tr-none flex items-center gap-2">
            <Loader size={16} className="animate-spin" />
            <span className="text-sm">جاري الإرسال ({Math.round(progress)}%)</span>
          </div>
        </div>
      ) : <div className="h-2" />
    )
  }), [hasMore, loadMoreMessages, msgsLoading, progress, uploading]);

  const renderVirtualMessage = useCallback((index, msg) => {
    const isMe = msg.senderId === currentUser.uid;
    const timeString = msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
    const deliveryState = getMessageDeliveryState(msg, isMe);
    const deliveryTitle = getDeliveryTitle(msg, deliveryState, isMe);
    const canShowActions = !msg._localOnly && !msg.isDeleted;
    const isSwipingThis = swipePreview.messageId === msg.id;
    const swipeOffset = isSwipingThis ? swipePreview.offsetX : 0;
    const swipeStrength = Math.min(1, Math.abs(swipeOffset) / 72);

    return (
      <MessageBubble
        key={msg.id || index}
        msg={msg}
        isMe={isMe}
        timeString={timeString}
        deliveryState={deliveryState}
        deliveryTitle={deliveryTitle}
        highlighted={highlightedMsgId === msg.id}
        swipeOffset={swipeOffset}
        swipeStrength={swipeStrength}
        canShowActions={canShowActions}
        renderMessageContent={renderMessageContent}
        onContextMenu={handleBubbleContextMenu}
        onTouchStart={handleBubbleTouchStart}
        onTouchMove={handleBubbleTouchMove}
        onTouchEnd={handleSwipeEnd}
        onReply={handleReplyToMessage}
        onEdit={handleEditMessage}
        onDelete={handleDeleteMessage}
        onRetry={retryMessage}
        onJumpToReply={scrollToMessage}
      />
    );
  }, [
    currentUser.uid,
    getDeliveryTitle,
    getMessageDeliveryState,
    handleBubbleContextMenu,
    handleBubbleTouchMove,
    handleBubbleTouchStart,
    handleDeleteMessage,
    handleEditMessage,
    handleReplyToMessage,
    handleSwipeEnd,
    highlightedMsgId,
    renderMessageContent,
    retryMessage,
    scrollToMessage,
    swipePreview.messageId,
    swipePreview.offsetX
  ]);

  return (
    <div className="flex h-dvh md:h-screen overflow-hidden bg-gray-100 font-sans dir-rtl text-right" dir="rtl">
      
      {/* Hidden File Inputs */}
      <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'image')} />
      <input type="file" ref={docInputRef} className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={(e) => handleFileUpload(e, 'document')} />

      {/* Call Modals & Overlays */}
      <IncomingCallModal />
      <VideoCall />

      {/* Sidebar */}
      <aside className={`w-full md:w-1/3 md:max-w-sm min-h-0 bg-white border-l border-gray-200 flex-col relative z-20 ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-gray-100 transition"
            title="الملف الشخصي والإعدادات"
          >
            <img 
              src={currentUser?.avatar || currentUser?.photoURL || `https://ui-avatars.com/api/?name=${currentUser?.name || currentUser?.displayName || currentUser?.email?.charAt(0) || 'U'}&background=random`} 
              alt="avatar" 
              className="w-10 h-10 rounded-full object-cover bg-gray-200"
              onError={handleImageError}
            />
            <h2 className="text-xl font-semibold text-gray-800">المحادثات</h2>
          </button>
          <div className="flex gap-2">
            <button onClick={() => setShowProfileModal(true)} className="p-2 text-gray-600 hover:bg-gray-200 rounded-full transition" title="الملف الشخصي والإعدادات">
              <SlidersHorizontal size={20} />
            </button>
            <button onClick={() => setShowUsersList(!showUsersList)} className="p-2 text-gray-600 hover:bg-gray-200 rounded-full transition" title="محادثة جديدة">
              <Plus size={20} />
            </button>
            <button onClick={logout} className="p-2 text-red-500 hover:bg-red-50 rounded-full transition" title="تسجيل الخروج">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {showUsersList ? (
          <div className="flex-1 overflow-y-auto bg-white absolute inset-0 top-[73px] z-10 w-full h-full">
            <div className="p-4 bg-gray-50 border-b">
              <div className="relative">
                <Search className="absolute right-3 top-3 text-gray-400" size={18} />
                <input type="text" placeholder="ابحث عن مستخدم..." className="w-full bg-white border border-gray-300 rounded-full py-2 pr-10 pl-4 focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="p-2">
              <h3 className="text-sm font-semibold text-gray-500 px-2 py-2">المستخدمون المتاحون</h3>
              {users.map(u => (
                <div key={u.uid} onClick={() => handleStartChat(u)} className="flex items-center p-3 hover:bg-gray-100 rounded-lg cursor-pointer transition">
                  <img src={u.avatar} alt={u.name} className="w-12 h-12 rounded-full object-cover bg-gray-200" onError={handleImageError} />
                  <div className="mr-4 flex-1">
                    <h3 className="font-semibold text-gray-900">{u.name}</h3>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {chats.map(chat => {
              const otherUser = getOtherParticipant(chat);
              const isActive = chat.id === activeChatId;
              const timeString = chat.lastMessageAt?.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) || '';
              const unreadCount = chat.unreadCount?.[currentUser.uid] || 0;
              return (
                <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`flex items-center p-3 rounded-lg cursor-pointer transition ${isActive ? 'bg-blue-50' : 'hover:bg-gray-100'}`}>
                  <img src={otherUser?.avatar || `https://ui-avatars.com/api/?name=${otherUser?.name || 'U'}&background=random`} alt="avatar" className="w-12 h-12 rounded-full object-cover flex-shrink-0 bg-gray-200" onError={handleImageError} />
                  <div className="mr-4 flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">{otherUser?.name || 'مستخدم'}</h3>
                      <div className="flex items-center gap-2">
                        {!isActive && unreadCount > 0 && (
                          <span className="text-[10px] bg-blue-600 text-white rounded-full min-w-5 h-5 px-1 inline-flex items-center justify-center">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                        <span className="text-xs text-gray-500 flex-shrink-0 mr-2">{timeString}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{chat.lastMessage || 'بدأ محادثة جديدة'}</p>
                  </div>
                </div>
              )
            })}
            {chats.length === 0 && (
              <div className="text-center p-8 text-gray-500">
                <p>لا توجد محادثات.</p>
                <button onClick={() => setShowUsersList(true)} className="mt-2 text-blue-500 hover:underline">ابدأ محادثة جديدة</button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Chat Area */}
      <main className={`flex-1 min-h-0 flex-col bg-[#efeae2] relative overflow-hidden ${!activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {activeChatId ? (
          <>
            <header className="sticky top-0 p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between z-20">
              <div className="flex items-center">
                <button onClick={() => setActiveChatId(null)} className="md:hidden ml-2 p-2 -mr-2 text-gray-600 hover:bg-gray-200 rounded-full transition" aria-label="العودة">
                  <ArrowRight size={24} />
                </button>
                <img src={activeChatOtherUser?.avatar || `https://ui-avatars.com/api/?name=${activeChatOtherUser?.name || 'U'}&background=random`} alt="avatar" className="w-10 h-10 rounded-full object-cover bg-gray-200" onError={handleImageError} />
                <div className="mr-4">
                  <h2 className="font-semibold text-gray-800">{activeChatOtherUser?.name}</h2>
                  {renderStatus()}
                </div>
              </div>
              
              {/* Call Buttons */}
              <CallButton 
                targetUserId={activeChatOtherUser?.uid || activeChatDetails.participants.find(id => id !== currentUser.uid)}
                roomId={activeChatId}
                targetUserName={activeChatOtherUser?.name}
              />
            </header>

            <div className="flex-1 min-h-0 relative overflow-x-hidden">
              <Virtuoso
                ref={virtuosoRef}
                data={messages}
                style={{ height: '100%' }}
                className="overscroll-contain overflow-x-hidden px-4 py-2"
                atBottomStateChange={handleAtBottomStateChange}
                startReached={handleStartReached}
                scrollerRef={setMessagesScrollerRef}
                components={virtuosoComponents}
                itemContent={renderVirtualMessage}
              />
            </div>

            <footer className="sticky bottom-0 p-4 bg-gray-50 flex items-center z-20 border-t border-gray-200">
              {(replyingTo || editingMessageId) && (
                <div className="absolute bottom-16 right-4 left-4 bg-white border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between z-30">
                  <div className="text-sm text-gray-700 truncate ml-3">
                    {editingMessageId ? `تعديل الرسالة: ${messageText}` : `رد على: ${replyingTo?.textPreview || ''}`}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingTo(null);
                      setEditingMessageId(null);
                      setMessageText('');
                    }}
                    className="p-1 text-gray-500 hover:text-gray-700"
                    aria-label="إلغاء"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {showAttachMenu && (
                <div className="absolute bottom-16 right-4 bg-white border border-gray-200 shadow-xl rounded-2xl p-2 flex flex-col gap-2 z-30 w-48">
                  <button onClick={() => imageInputRef.current.click()} className="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-lg transition text-gray-700 w-full">
                    <div className="bg-purple-100 p-2 rounded-full text-purple-600"><ImageIcon size={18} /></div>
                    <span>صورة</span>
                  </button>
                  <button onClick={() => docInputRef.current.click()} className="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-lg transition text-gray-700 w-full">
                    <div className="bg-blue-100 p-2 rounded-full text-blue-600"><FileText size={18} /></div>
                    <span>مستند</span>
                  </button>
                  <button onClick={sendLocation} className="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-lg transition text-gray-700 w-full">
                    <div className="bg-green-100 p-2 rounded-full text-green-600"><MapPin size={18} /></div>
                    <span>موقع جغرافي</span>
                  </button>
                </div>
              )}

              <button 
                type="button" 
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                className={`p-2 transition rounded-full ${showAttachMenu ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
              >
                <Paperclip size={24} />
              </button>
              
              <form onSubmit={handleSendMessage} className="flex-1 flex items-center mx-2 relative">
                <input 
                  type="text" 
                  value={messageText}
                  onChange={(e) => handleMessageInputChange(e.target.value)}
                  placeholder={editingMessageId ? 'عدل الرسالة...' : 'اكتب رسالة...'} 
                  className="flex-1 border border-gray-300 rounded-full py-2.5 px-4 pr-12 focus:outline-none focus:border-blue-500 bg-white"
                  disabled={isRecording || uploading}
                />
                
                {/* Voice Record Button - Inside input if text is empty */}
                {!messageText.trim() && (
                  <button 
                    type="button"
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    className={`absolute right-2 p-1.5 rounded-full transition ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    {isRecording ? <Square size={20} /> : <Mic size={20} />}
                  </button>
                )}
                
                {messageText.trim() && (
                  <button 
                    type="submit" 
                    className="absolute right-1 bg-blue-600 text-white rounded-full p-2 w-9 h-9 flex items-center justify-center hover:bg-blue-700 transition rtl:-scale-x-100"
                  >
                    <Send size={16} />
                  </button>
                )}
              </form>
            </footer>

            {/* Floating scroll-to-bottom button (anchored to main, above footer) */}
            {showScrollToBottom && (
              <button
                type="button"
                onClick={() => {
                  scrollToBottom();
                }}
                className="absolute bottom-[88px] left-4 md:left-auto md:right-6 z-40 bg-blue-600 text-white rounded-full shadow-lg p-3 hover:bg-blue-700 transition flex items-center gap-1 animate-fade-in"
                style={{ minWidth: 48, minHeight: 48 }}
                aria-label="الانتقال لآخر المحادثة"
              >
                <ArrowDown size={26} />
                {newMsgWhileAway && (
                  <span className="ml-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold inline-flex items-center justify-center animate-pulse">
                    {newMsgCount > 99 ? '99+' : newMsgCount || 1}
                  </span>
                )}
              </button>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <div className="w-32 h-32 bg-gray-200 rounded-full flex items-center justify-center mb-6">
               <User size={64} className="text-gray-400" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-700 mb-2">تطبيق الدردشة</h2>
            <p>اختر محادثة من القائمة للبدء</p>
          </div>
        )}
      </main>
      
      {/* Click outside attachment menu overlay */}
      {showAttachMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setShowAttachMenu(false)}></div>
      )}

      {actionMenuMessage && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setActionMenuMessage(null)}></div>
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl p-4 space-y-2">
            <button
              type="button"
              onClick={() => handleReplyToMessage(actionMenuMessage)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 text-right"
            >
              <Reply size={18} />
              <span>رد</span>
            </button>
            {actionMenuMessage.senderId === currentUser.uid && actionMenuMessage.type === 'text' && (
              <button
                type="button"
                onClick={() => handleEditMessage(actionMenuMessage)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 text-right"
              >
                <Pencil size={18} />
                <span>تعديل</span>
              </button>
            )}
            {actionMenuMessage.senderId === currentUser.uid && (
              <button
                type="button"
                onClick={() => handleDeleteMessage(actionMenuMessage)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-red-50 text-red-600 text-right"
              >
                <Trash2 size={18} />
                <span>حذف</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActionMenuMessage(null)}
              className="w-full p-3 rounded-lg bg-gray-100 text-gray-700"
            >
              إلغاء
            </button>
          </div>
        </>
      )}

      {showProfileModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/35" onClick={() => setShowProfileModal(false)}></div>
          <div className="fixed z-[60] inset-x-3 top-8 md:inset-x-auto md:right-8 md:w-[420px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2 text-gray-800">
                <SlidersHorizontal size={18} />
                <h3 className="font-semibold">الملف الشخصي والإعدادات</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="p-1 rounded-md text-gray-500 hover:bg-gray-200"
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="flex items-center gap-3">
                <img
                  src={currentUser?.avatar || currentUser?.photoURL || `https://ui-avatars.com/api/?name=${currentUser?.name || currentUser?.displayName || currentUser?.email?.charAt(0) || 'U'}&background=random`}
                  alt="avatar"
                  className="w-14 h-14 rounded-full object-cover bg-gray-200"
                  onError={handleImageError}
                />
                <div>
                  <p className="font-semibold text-gray-800">{currentUser?.name || currentUser?.displayName || 'المستخدم'}</p>
                  <p className="text-xs text-gray-500">{currentUser?.email || 'بدون بريد'}</p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4 space-y-4">
                <h4 className="font-semibold text-gray-800">إعدادات الصوت</h4>

                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-gray-800">كتم كل الأصوات</p>
                    <p className="text-xs text-gray-500">إيقاف جميع أصوات الرسائل والمكالمات</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!soundSettings.masterEnabled}
                    onChange={(e) => updateSoundSettings({ masterEnabled: !e.target.checked })}
                    className="w-5 h-5 accent-blue-600"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-gray-800">تعطيل أصوات الرسائل فقط</p>
                    <p className="text-xs text-gray-500">يشمل صوت الإرسال والاستلام</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!soundSettings.messageSoundsEnabled}
                    onChange={(e) => updateSoundSettings({ messageSoundsEnabled: !e.target.checked })}
                    disabled={!soundSettings.masterEnabled}
                    className="w-5 h-5 accent-blue-600 disabled:opacity-40"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-gray-800">تعطيل أصوات المكالمات فقط</p>
                    <p className="text-xs text-gray-500">يشمل الرنين وأصوات بداية/نهاية المكالمة</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!soundSettings.callSoundsEnabled}
                    onChange={(e) => updateSoundSettings({ callSoundsEnabled: !e.target.checked })}
                    disabled={!soundSettings.masterEnabled}
                    className="w-5 h-5 accent-blue-600 disabled:opacity-40"
                  />
                </label>

                <div>
                  <p className="text-sm font-medium text-gray-800 mb-2">مستوى الصوت</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setVolumeLevel('low')}
                      disabled={!soundSettings.masterEnabled}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${soundSettings.volumeLevel === 'low' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'} disabled:opacity-40`}
                    >
                      Low
                    </button>
                    <button
                      type="button"
                      onClick={() => setVolumeLevel('normal')}
                      disabled={!soundSettings.masterEnabled}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${soundSettings.volumeLevel === 'normal' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'} disabled:opacity-40`}
                    >
                      Normal
                    </button>
                    <button
                      type="button"
                      onClick={() => setVolumeLevel('high')}
                      disabled={!soundSettings.masterEnabled}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${soundSettings.volumeLevel === 'high' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'} disabled:opacity-40`}
                    >
                      High
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {swipeToast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-gray-900 text-white text-sm shadow-lg transition-all duration-250 ${swipeToastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
        >
          {swipeToast}
        </div>
      )}
    </div>
  );
}
