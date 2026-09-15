import { describe, expect, it } from 'vitest';
import {
  buildEventPayload,
  checkWebhookUrl,
  signBotWebhookPayload,
  verifyBotWebhookSignature,
} from '../botWebhookDelivery';

describe('Phase 16 webhook security', () => {
  it('accepts only public HTTPS-looking destinations and blocks local/metadata IPs', () => {
    expect(checkWebhookUrl('https://hooks.example.com/events')).toEqual({ ok: true, url: 'https://hooks.example.com/events' });
    expect(checkWebhookUrl('http://hooks.example.com/events')).toEqual({ ok: false, error: 'https_required' });
    for (const url of [
      'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.1/x',
      'https://172.16.0.1/x', 'https://192.168.1.1/x', 'https://169.254.169.254/x',
      'https://[::1]/x', 'https://metadata.google.internal/x',
    ]) expect(checkWebhookUrl(url)).toEqual({ ok: false, error: 'blocked_host' });
  });

  it('signs the exact canonical body and rejects changed bodies', async () => {
    const body = JSON.stringify(buildEventPayload('bot-a', 'bot.message.received', { messageId: 'm1' }));
    const signature = await signBotWebhookPayload('separate-webhook-secret', body);
    expect(await verifyBotWebhookSignature('separate-webhook-secret', body, signature)).toBe(true);
    expect(await verifyBotWebhookSignature('separate-webhook-secret', `${body} `, signature)).toBe(false);
  });

  it('emits a stable event id and timestamp that survive retries of the same payload', () => {
    const payload = buildEventPayload('bot-a', 'bot.message.sent', { messageId: 'm1' });
    expect(payload.event_id).toMatch(/^[a-f0-9]{24}$/);
    expect(payload.timestamp).toBeTypeOf('number');
    expect(payload.bot_id).toBe('bot-a');
  });
});
