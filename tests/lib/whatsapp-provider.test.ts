import { describe, expect, it } from 'vitest';
import { devStubProvider } from '@/lib/verification-provider/dev-stub';
import {
  answerWebhookHandshake,
  signBody,
  whatsappProvider,
} from '@/lib/verification-provider/whatsapp';

// Simulated payloads in the shape of Meta's WhatsApp Cloud API webhooks.
const textMessage = (overrides: Record<string, unknown> = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_ID',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '21600000001',
              phone_number_id: 'PNID',
            },
            contacts: [{ profile: { name: 'Test' }, wa_id: '21622345678' }],
            messages: [
              {
                from: '21622345678',
                id: 'wamid.AAA',
                timestamp: '1761472800',
                type: 'text',
                text: { body: 'Vérification TuniProf : TTP-7KQ2' },
                ...overrides,
              },
            ],
          },
        },
      ],
    },
  ],
});

describe('WhatsApp Cloud API provider', () => {
  it('reads a text message', () => {
    expect(whatsappProvider.parseInbound(textMessage())).toEqual([
      {
        messageId: 'wamid.AAA',
        from: '21622345678',
        text: 'Vérification TuniProf : TTP-7KQ2',
      },
    ]);
  });

  it('reads several messages and several entries', () => {
    const payload = textMessage();
    const second = textMessage({ id: 'wamid.BBB', from: '21655111222' });
    payload.entry.push(second.entry[0]);
    expect(
      whatsappProvider.parseInbound(payload).map((m) => m.messageId),
    ).toEqual(['wamid.AAA', 'wamid.BBB']);
  });

  it('ignores images, status updates and anything that is not a text message', () => {
    expect(
      whatsappProvider.parseInbound(
        textMessage({ type: 'image', text: undefined }),
      ),
    ).toEqual([]);

    const statusOnly = {
      object: 'whatsapp_business_account',
      entry: [
        { changes: [{ value: { statuses: [{ id: 'x', status: 'read' }] } }] },
      ],
    };
    expect(whatsappProvider.parseInbound(statusOnly)).toEqual([]);
  });

  it('ignores bodies that are not from WhatsApp, or are malformed', () => {
    expect(
      whatsappProvider.parseInbound({ object: 'page', entry: [] }),
    ).toEqual([]);
    expect(whatsappProvider.parseInbound(null)).toEqual([]);
    expect(whatsappProvider.parseInbound('text')).toEqual([]);
    expect(
      whatsappProvider.parseInbound({ object: 'whatsapp_business_account' }),
    ).toEqual([]);
    expect(
      whatsappProvider.parseInbound(textMessage({ id: 42, from: undefined })),
    ).toEqual([]);
  });

  describe('signature', () => {
    const body = JSON.stringify(textMessage());
    const headers = (signature: string | null) => {
      const h = new Headers();
      if (signature) h.set('x-hub-signature-256', signature);
      return h;
    };

    it('accepts a body signed with the app secret', () => {
      const signature = signBody('test-app-secret', body);
      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(whatsappProvider.verifyRequest(body, headers(signature))).toBe(
        true,
      );
    });

    it('refuses a missing, wrong or stale signature', () => {
      expect(whatsappProvider.verifyRequest(body, headers(null))).toBe(false);
      expect(
        whatsappProvider.verifyRequest(
          body,
          headers(signBody('another-secret', body)),
        ),
      ).toBe(false);
      expect(
        whatsappProvider.verifyRequest(
          body + ' ',
          headers(signBody('test-app-secret', body)),
        ),
      ).toBe(false);
      expect(whatsappProvider.verifyRequest(body, headers('sha256=abc'))).toBe(
        false,
      );
    });
  });

  describe('webhook set-up handshake', () => {
    const params = (entries: Record<string, string>) =>
      new URLSearchParams(entries);

    it('answers Meta with the challenge when the token is right', () => {
      expect(
        answerWebhookHandshake(
          params({
            'hub.mode': 'subscribe',
            'hub.verify_token': 'test-verify-token',
            'hub.challenge': '1158201444',
          }),
        ),
      ).toBe('1158201444');
    });

    it('refuses a wrong token, a wrong mode, or no token', () => {
      const base = { 'hub.mode': 'subscribe', 'hub.challenge': '1' };
      expect(
        answerWebhookHandshake(params({ ...base, 'hub.verify_token': 'nope' })),
      ).toBeNull();
      expect(
        answerWebhookHandshake(
          params({
            ...base,
            'hub.mode': 'other',
            'hub.verify_token': 'test-verify-token',
          }),
        ),
      ).toBeNull();
      expect(answerWebhookHandshake(params(base))).toBeNull();
    });
  });

  it('builds the wa.me link with the message ready', () => {
    expect(whatsappProvider.platformNumber()).toBe('21600000001');
    expect(whatsappProvider.buildWaLink('TTP-7KQ2 é')).toBe(
      'https://wa.me/21600000001?text=TTP-7KQ2%20%C3%A9',
    );
  });
});

describe('dev stub provider', () => {
  it('reads its simple body and invents ids when missing', () => {
    const [message] = devStubProvider.parseInbound({
      messages: [{ from: '21622345678', text: 'TTP-7KQ2' }],
    });
    expect(message).toMatchObject({ from: '21622345678', text: 'TTP-7KQ2' });
    expect(message.messageId).toMatch(/^dev-/);
  });

  it('ignores a malformed body', () => {
    expect(devStubProvider.parseInbound({})).toEqual([]);
    expect(devStubProvider.parseInbound({ messages: [{ from: 1 }] })).toEqual(
      [],
    );
  });

  it('uses a number that cannot be a real phone', () => {
    expect(devStubProvider.platformNumber()).toBe('00000000000');
  });
});
