// What the site needs from a WhatsApp provider. Two implementations exist:
// the dev stub (local work, no Meta account) and the real WhatsApp Cloud API.

export type InboundText = {
  /** Unique id of the message at the provider; used to ignore deliveries repeated by Meta. */
  messageId: string;
  /** Sender, digits with the country code and no "+": "21622345678". */
  from: string;
  text: string;
};

export interface VerificationProvider {
  readonly name: 'dev-stub' | 'whatsapp';

  /** The platform's WhatsApp number, digits with country code. People send their code to it. */
  platformNumber(): string;

  /** wa.me link that opens WhatsApp with `text` already typed. */
  buildWaLink(text: string): string;

  /** True only when the webhook request really comes from the provider. */
  verifyRequest(rawBody: string, headers: Headers): boolean;

  /** The text messages inside a webhook body. Anything else is ignored. */
  parseInbound(body: unknown): InboundText[];
}
