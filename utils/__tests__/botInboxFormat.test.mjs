// Unit tests for the Phase 16-17 inbox/delivery formatters.
// Run with: npm run test:ui  (node --test utils/__tests__/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeAgo,
  conversationPreview,
  unreadBadgeLabel,
  deliveryStatusKind,
  deliveryStatusLabel,
  deliveryMeta,
} from '../botInboxFormat.mjs';

test('timeAgo compacts recent timestamps and dates older ones', () => {
  const now = Date.now();
  assert.equal(timeAgo(now), 'now');
  assert.equal(timeAgo(now - 5 * 60 * 1000), '5m');
  assert.equal(timeAgo(now - 3 * 60 * 60 * 1000), '3h');
  assert.equal(timeAgo(now - 2 * 24 * 60 * 60 * 1000), '2d');
  assert.match(timeAgo(now - 30 * 24 * 60 * 60 * 1000), /^[A-Z][a-z]{2} \d{1,2}$/);
  assert.equal(timeAgo(null), '');
  assert.equal(timeAgo(undefined), '');
});

test('conversationPreview mirrors the Worker conversation row contract', () => {
  assert.equal(conversationPreview({ lastMessage: null }), 'No messages yet');
  assert.equal(conversationPreview({}), 'No messages yet');
  assert.equal(
    conversationPreview({ lastMessage: { text: 'hi there', direction: 'in' } }),
    'hi there',
  );
  assert.equal(
    conversationPreview({ lastMessage: { text: 'on it', direction: 'out' } }),
    'You: on it',
  );
  // attachment-only message (null text) never renders as a blank row
  assert.equal(
    conversationPreview({ lastMessage: { text: null, direction: 'in' } }),
    'Attachment',
  );
  assert.equal(
    conversationPreview({ lastMessage: { text: '   ', direction: 'out' } }),
    'You: Attachment',
  );
});

test('unreadBadgeLabel hides zero and caps large counts', () => {
  assert.equal(unreadBadgeLabel(0), null);
  assert.equal(unreadBadgeLabel(undefined), null);
  assert.equal(unreadBadgeLabel('3'), '3');
  assert.equal(unreadBadgeLabel(99), '99');
  assert.equal(unreadBadgeLabel(120), '99+');
});

test('deliveryStatusKind/Label map the backend enum defensively', () => {
  assert.equal(deliveryStatusKind('delivered'), 'success');
  assert.equal(deliveryStatusKind('failed'), 'error');
  assert.equal(deliveryStatusKind('exhausted'), 'error');
  assert.equal(deliveryStatusKind('something_new'), 'pending');
  assert.equal(deliveryStatusLabel('delivered'), 'Delivered');
  assert.equal(deliveryStatusLabel('failed'), 'Failed');
  assert.equal(deliveryStatusLabel('exhausted'), 'Retries exhausted');
  assert.equal(deliveryStatusLabel('queued'), 'Pending');
});

test('deliveryMeta renders code, latency, retries, and age', () => {
  const now = Date.now();
  assert.equal(
    deliveryMeta({ responseCode: 200, latencyMs: 84, attempt: 1, createdAt: now - 60 * 1000 }),
    'HTTP 200 · 84ms · 1m',
  );
  // a connection failure records responseCode null — say so, never "HTTP null"
  assert.equal(
    deliveryMeta({ responseCode: null, latencyMs: 12, attempt: 3, createdAt: now }),
    'No response · 12ms · attempt 3 · now',
  );
  assert.equal(
    deliveryMeta({ responseCode: 500, latencyMs: null, attempt: 1, createdAt: now }),
    'HTTP 500 · now',
  );
});
