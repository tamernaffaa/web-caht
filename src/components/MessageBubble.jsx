import React, { memo } from 'react';
import { Reply, Pencil, Trash2, Check, CheckCheck } from 'lucide-react';

function MessageBubble({
  msg,
  isMe,
  timeString,
  deliveryState,
  deliveryTitle,
  highlighted,
  swipeOffset,
  swipeStrength,
  canShowActions,
  renderMessageContent,
  onContextMenu,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onJumpToReply
}) {
  const isFailed = msg.status === 'failed';
  const isSending = msg.status === 'sending';
  const isSentPendingAck = msg.status === 'sent' && msg._localOnly;
  const isSwipingThis = Math.abs(swipeOffset) > 0;

  return (
    <div key={msg.id} id={`msg-${msg.id}`} className={`flex ${isMe ? 'justify-end' : 'justify-start'} relative py-2 px-2`}>
      {isSwipingThis && Math.abs(swipeOffset) > 8 && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${isMe ? 'left-2' : 'right-2'} text-blue-500`}
          style={{ opacity: swipeStrength }}
        >
          <Reply size={18} />
        </div>
      )}

      <div
        className={`p-3 rounded-lg max-w-[75%] md:max-w-md relative ${isMe ? 'bg-blue-500 text-white rounded-tr-none mr-2' : 'bg-white text-gray-800 shadow-sm rounded-tl-none ml-2'} ${highlighted ? 'ring-2 ring-yellow-400 ring-offset-2 animate-pulse' : ''}`}
        style={{ transform: `translateX(${swipeOffset}px)`, transition: isSwipingThis ? 'none' : 'transform 180ms ease-out' }}
        onContextMenu={(e) => onContextMenu(e, msg, canShowActions)}
        onTouchStart={(e) => onTouchStart(e, msg, canShowActions)}
        onTouchMove={(e) => onTouchMove(e, msg, canShowActions)}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {msg.replyTo && (
          <div
            className={`mb-2 p-2 rounded border-r-2 text-xs cursor-pointer transition ${isMe ? 'bg-blue-400/50 border-white/60' : 'bg-gray-100 border-blue-400 text-gray-700'} hover:bg-blue-200/60`}
            onClick={() => onJumpToReply(msg.replyTo.messageId)}
            title="انتقل للرسالة الأصلية"
          >
            <p className="font-semibold mb-1">رد على رسالة</p>
            <p className="truncate">{msg.replyTo.textPreview || '[رسالة]'}</p>
          </div>
        )}

        {renderMessageContent(msg, isMe)}

        <div className={`text-[10px] mt-1 text-left flex items-center gap-2 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
          <span>{timeString}</span>
          {!msg.isDeleted && msg.isEdited && <span>(معدلة)</span>}
          {isMe && isSending && <span>جاري الإرسال...</span>}
          {isMe && isSentPendingAck && <span>تم الإرسال</span>}
          {isMe && !isSending && !isFailed && !isSentPendingAck && deliveryState === 'sent' && (
            <span className="inline-flex items-center gap-1"><Check size={12} /> <span>مرسلة</span></span>
          )}
          {isMe && !isSending && !isFailed && !isSentPendingAck && deliveryState === 'delivered' && (
            <span className="inline-flex items-center gap-1" title={deliveryTitle}><CheckCheck size={12} /> <span>تم التسليم</span></span>
          )}
          {isMe && !isSending && !isFailed && !isSentPendingAck && deliveryState === 'seen' && (
            <span className="inline-flex items-center gap-1 text-cyan-200" title={deliveryTitle}><CheckCheck size={12} /> <span>تمت القراءة</span></span>
          )}
          {isMe && isFailed && (
            <>
              <span className="text-red-200">فشل الإرسال</span>
              <button type="button" onClick={() => onRetry(msg.id)} className="underline text-red-100 hover:text-white">
                إعادة المحاولة
              </button>
            </>
          )}
        </div>

        {canShowActions && (
          <div className={`mt-2 hidden md:flex gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
            <button
              type="button"
              onClick={() => onReply(msg)}
              className={`text-[11px] inline-flex items-center gap-1 ${isMe ? 'text-blue-100 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Reply size={12} />
              <span>رد</span>
            </button>
            {isMe && msg.type === 'text' && (
              <button
                type="button"
                onClick={() => onEdit(msg)}
                className="text-[11px] inline-flex items-center gap-1 text-blue-100 hover:text-white"
              >
                <Pencil size={12} />
                <span>تعديل</span>
              </button>
            )}
            {isMe && (
              <button
                type="button"
                onClick={() => onDelete(msg)}
                className="text-[11px] inline-flex items-center gap-1 text-red-100 hover:text-white"
              >
                <Trash2 size={12} />
                <span>حذف</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function areEqual(prevProps, nextProps) {
  const prevMsg = prevProps.msg;
  const nextMsg = nextProps.msg;

  const prevTs = prevMsg?.timestamp?.toMillis ? prevMsg.timestamp.toMillis() : 0;
  const nextTs = nextMsg?.timestamp?.toMillis ? nextMsg.timestamp.toMillis() : 0;

  if (prevMsg?.id !== nextMsg?.id) return false;
  if (prevMsg?.text !== nextMsg?.text) return false;
  if (prevMsg?.type !== nextMsg?.type) return false;
  if (prevMsg?.mediaUrl !== nextMsg?.mediaUrl) return false;
  if (prevMsg?.status !== nextMsg?.status) return false;
  if (prevMsg?.isDeleted !== nextMsg?.isDeleted) return false;
  if (prevMsg?.isEdited !== nextMsg?.isEdited) return false;
  if (prevMsg?._localOnly !== nextMsg?._localOnly) return false;
  if (prevTs !== nextTs) return false;

  if (prevProps.isMe !== nextProps.isMe) return false;
  if (prevProps.timeString !== nextProps.timeString) return false;
  if (prevProps.deliveryState !== nextProps.deliveryState) return false;
  if (prevProps.deliveryTitle !== nextProps.deliveryTitle) return false;
  if (prevProps.highlighted !== nextProps.highlighted) return false;
  if (prevProps.swipeOffset !== nextProps.swipeOffset) return false;
  if (prevProps.swipeStrength !== nextProps.swipeStrength) return false;
  if (prevProps.canShowActions !== nextProps.canShowActions) return false;

  if (prevProps.renderMessageContent !== nextProps.renderMessageContent) return false;
  if (prevProps.onContextMenu !== nextProps.onContextMenu) return false;
  if (prevProps.onTouchStart !== nextProps.onTouchStart) return false;
  if (prevProps.onTouchMove !== nextProps.onTouchMove) return false;
  if (prevProps.onTouchEnd !== nextProps.onTouchEnd) return false;
  if (prevProps.onReply !== nextProps.onReply) return false;
  if (prevProps.onEdit !== nextProps.onEdit) return false;
  if (prevProps.onDelete !== nextProps.onDelete) return false;
  if (prevProps.onRetry !== nextProps.onRetry) return false;
  if (prevProps.onJumpToReply !== nextProps.onJumpToReply) return false;

  const prevReplyTo = prevMsg?.replyTo;
  const nextReplyTo = nextMsg?.replyTo;
  if (!!prevReplyTo !== !!nextReplyTo) return false;
  if (prevReplyTo && nextReplyTo) {
    if (prevReplyTo.messageId !== nextReplyTo.messageId) return false;
    if (prevReplyTo.textPreview !== nextReplyTo.textPreview) return false;
    if (prevReplyTo.senderId !== nextReplyTo.senderId) return false;
    if (prevReplyTo.type !== nextReplyTo.type) return false;
  }

  return true;
}

export default memo(MessageBubble, areEqual);
