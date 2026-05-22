export const buildNewestMessageKey = (message) => {
  if (!message) return 'none:0';

  const id = message.id || message.clientMessageId || 'unknown';
  const timestampMs = message?.timestamp?.toMillis ? message.timestamp.toMillis() : 0;
  return `${id}:${timestampMs}`;
};

export const shouldIncrementNewMessageCount = ({
  isBrowsingHistory,
  isIncomingMessage
}) => {
  return Boolean(isBrowsingHistory && isIncomingMessage);
};
