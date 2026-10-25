import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/auth/crypto';
import { getWhatsAppConfig } from '@/lib/env';
import type { InboundText, VerificationProvider } from './types';

// WhatsApp Business Platform (Cloud API) by Meta, spec 8.5 and 13.2.
// The formats below follow Meta's webhook documentation; they are checked against a real
// Meta account when the owner's credentials exist (listed as a blocker in PROGRESS.md).

/** X-Hub-Signature-256 header value for a body, as Meta computes it. */
export function signBody(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

type CloudApiMessage = {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  text?: { body?: unknown };
};

export const whatsappProvider: VerificationProvider = {
  name: 'whatsapp',

  platformNumber: () => getWhatsAppConfig().platformNumber,

  buildWaLink: (text) =>
    `https://wa.me/${getWhatsAppConfig().platformNumber}?text=${encodeURIComponent(text)}`,

  verifyRequest(rawBody, headers) {
    const received = headers.get('x-hub-signature-256');
    if (!received) return false;
    return safeEqual(
      received,
      signBody(getWhatsAppConfig().appSecret, rawBody),
    );
  },

  // { object: "whatsapp_business_account",
  //   entry: [{ changes: [{ value: { messages: [{ id, from, type: "text", text: { body } }] } }] }] }
  parseInbound(body: unknown): InboundText[] {
    const payload = body as {
      object?: unknown;
      entry?: { changes?: { value?: { messages?: CloudApiMessage[] } }[] }[];
    };
    if (payload?.object !== 'whatsapp_business_account') return [];

    const result: InboundText[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (
            message.type === 'text' &&
            typeof message.id === 'string' &&
            typeof message.from === 'string' &&
            typeof message.text?.body === 'string'
          ) {
            result.push({
              messageId: message.id,
              from: message.from,
              text: message.text.body,
            });
          }
        }
      }
    }
    return result;
  },
};

/**
 * Meta checks the webhook URL once with a GET request:
 * ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * Returns the text to answer with, or null to refuse.
 */
export function answerWebhookHandshake(params: URLSearchParams): string | null {
  const { verifyToken } = getWhatsAppConfig();
  const token = params.get('hub.verify_token');
  if (
    params.get('hub.mode') === 'subscribe' &&
    token !== null &&
    safeEqual(token, verifyToken)
  ) {
    return params.get('hub.challenge');
  }
  return null;
}
