import { randomUUID } from 'node:crypto';
import type { InboundText, VerificationProvider } from './types';

// For local work without a Meta account. The sign-up screen shows a "simulate the
// WhatsApp message" button that calls the same code as the real webhook.
// It refuses to work in production (see getVerificationProviderName).
export const devStubProvider: VerificationProvider = {
  name: 'dev-stub',

  // Clearly fake: no real phone can have this number.
  platformNumber: () => '00000000000',

  buildWaLink: (text) =>
    `https://wa.me/00000000000?text=${encodeURIComponent(text)}`,

  verifyRequest: () => process.env.NODE_ENV !== 'production',

  // Simple body: { "messages": [{ "from": "21622345678", "text": "TTP-ABCD" }] }
  parseInbound(body: unknown): InboundText[] {
    const messages = (body as { messages?: unknown })?.messages;
    if (!Array.isArray(messages)) return [];
    return messages.flatMap((m): InboundText[] => {
      if (typeof m?.from !== 'string' || typeof m?.text !== 'string') return [];
      return [
        {
          messageId: typeof m.id === 'string' ? m.id : `dev-${randomUUID()}`,
          from: m.from,
          text: m.text,
        },
      ];
    });
  },
};
