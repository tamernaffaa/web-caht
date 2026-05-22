import { describe, expect, it } from 'vitest';
import { buildNewestMessageKey, shouldIncrementNewMessageCount } from './chat-behavior';

describe('buildNewestMessageKey', () => {
  it('builds a stable key from id and timestamp', () => {
    const key = buildNewestMessageKey({
      id: 'm1',
      timestamp: { toMillis: () => 12345 }
    });

    expect(key).toBe('m1:12345');
  });

  it('falls back to clientMessageId and zero timestamp', () => {
    const key = buildNewestMessageKey({
      clientMessageId: 'c-1'
    });

    expect(key).toBe('c-1:0');
  });

  it('returns safe key for empty message', () => {
    expect(buildNewestMessageKey(null)).toBe('none:0');
  });
});

describe('shouldIncrementNewMessageCount', () => {
  it('increments only for incoming messages while browsing history', () => {
    expect(
      shouldIncrementNewMessageCount({
        isBrowsingHistory: true,
        isIncomingMessage: true
      })
    ).toBe(true);
  });

  it('does not increment when user is near bottom', () => {
    expect(
      shouldIncrementNewMessageCount({
        isBrowsingHistory: false,
        isIncomingMessage: true
      })
    ).toBe(false);
  });

  it('does not increment for own outgoing message', () => {
    expect(
      shouldIncrementNewMessageCount({
        isBrowsingHistory: true,
        isIncomingMessage: false
      })
    ).toBe(false);
  });
});
