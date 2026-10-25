import type { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { GET, POST } from '@/app/api/webhooks/whatsapp/route';
import { deriveVerificationCode } from '@/lib/auth/crypto';
import { getChallengeView, startChallenge } from '@/lib/auth/verification';
import { getVerificationProviderName } from '@/lib/env';
import { signBody } from '@/lib/verification-provider/whatsapp';
import { runMigrations } from '@/db/migrate';
import { clearAuthTables, device, PHONE_A, PHONE_B } from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';

// The route handler, called exactly as Meta would call it.

const APP_SECRET = 'test-app-secret'; // see vitest.config.mts
const URL_BASE = 'http://localhost/api/webhooks/whatsapp';

const payload = (from: string, text: string, id: string) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            messages: [{ from, id, type: 'text', text: { body: text } }],
          },
        },
      ],
    },
  ],
});

function signedPost(body: unknown, signature?: string) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(URL_BASE, {
    method: 'POST',
    headers: { 'x-hub-signature-256': signature ?? signBody(APP_SECRET, raw) },
    body: raw,
  });
}

describe.skipIf(!testDatabaseUrl)('WhatsApp webhook route (database)', () => {
  let pool: Pool;

  beforeAll(async () => {
    // The route uses the app's own pool: point it at the test database.
    process.env.DATABASE_URL = testDatabaseUrl;
    delete (globalThis as { pgPool?: Pool }).pgPool;
    vi.stubEnv('VERIFICATION_PROVIDER', 'whatsapp');
    pool = createTestPool();
    await runMigrations(pool);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await (globalThis as { pgPool?: Pool }).pgPool?.end();
    delete (globalThis as { pgPool?: Pool }).pgPool;
    await pool.end();
  });
  beforeEach(async () => {
    await clearAuthTables(pool);
  });

  async function waitingChallenge(phone = PHONE_A) {
    const started = await startChallenge(pool, {
      phone,
      purpose: 'visitor_login',
      userId: null,
      device: device(),
    });
    if (!started.ok) throw new Error('setup');
    return started.challengeId;
  }
  const status = async (id: string) =>
    (await getChallengeView(pool, id, device().deviceHash))?.status;

  it('verifies the sender when a correctly signed Meta message carries the code', async () => {
    const id = await waitingChallenge();
    const code = deriveVerificationCode(id);
    const response = await POST(
      signedPost(
        payload(PHONE_A.slice(1), `Vérification : ${code}`, 'wamid.1'),
      ),
    );
    expect(response.status).toBe(200);
    expect(await status(id)).toBe('verified');
  });

  it('refuses a request with a wrong or missing signature, and changes nothing', async () => {
    const id = await waitingChallenge();
    const body = payload(
      PHONE_A.slice(1),
      deriveVerificationCode(id),
      'wamid.2',
    );

    expect(
      (
        await POST(
          signedPost(body, signBody('another-secret', JSON.stringify(body))),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request(URL_BASE, { method: 'POST', body: JSON.stringify(body) }),
        )
      ).status,
    ).toBe(401);
    expect(await status(id)).toBe('pending');
  });

  it('a code sent from another phone does not verify (route level)', async () => {
    const id = await waitingChallenge(PHONE_A);
    await POST(
      signedPost(
        payload(PHONE_B.slice(1), deriveVerificationCode(id), 'wamid.3'),
      ),
    );
    expect(await status(id)).toBe('pending');
  });

  it('answers 200 for harmless events (delivery statuses, other text) and 400 for broken JSON', async () => {
    const statuses = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }],
    };
    expect((await POST(signedPost(statuses))).status).toBe(200);
    expect(
      (await POST(signedPost(payload(PHONE_A.slice(1), 'bonjour', 'wamid.4'))))
        .status,
    ).toBe(200);
    expect((await POST(signedPost('{not json'))).status).toBe(400);
  });

  it('handles a message delivered twice only once', async () => {
    const id = await waitingChallenge();
    const wrong = payload(PHONE_A.slice(1), 'TTP-ZZZ2', 'wamid.same');
    await POST(signedPost(wrong));
    await POST(signedPost(wrong));
    const { rows } = await pool.query(
      'SELECT attempts FROM otp_challenges WHERE id = $1',
      [id],
    );
    expect(rows[0].attempts).toBe(1);
  });

  describe('set-up handshake', () => {
    const handshake = (token: string) =>
      new Request(
        `${URL_BASE}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=987654`,
      );

    it('echoes the challenge for the right token and refuses others', async () => {
      const ok = await GET(handshake('test-verify-token'));
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe('987654');
      expect((await GET(handshake('wrong-token'))).status).toBe(403);
    });
  });
});

describe('provider choice', () => {
  it('uses the dev stub locally', () => {
    vi.stubEnv('VERIFICATION_PROVIDER', 'dev-stub');
    expect(getVerificationProviderName()).toBe('dev-stub');
    vi.unstubAllEnvs();
  });

  it('can NEVER use the dev stub in production, whatever the setting says', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERIFICATION_PROVIDER', 'dev-stub');
    expect(getVerificationProviderName()).toBe('whatsapp');
    vi.stubEnv('VERIFICATION_PROVIDER', '');
    expect(getVerificationProviderName()).toBe('whatsapp');
    vi.unstubAllEnvs();
  });

  it('the webhook refuses unsigned requests in production even if the stub was selected', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERIFICATION_PROVIDER', 'dev-stub');
    const response = await POST(
      new Request(URL_BASE, {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ from: '21622345678', text: 'TTP-ABCD' }],
        }),
      }),
    );
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });
});
