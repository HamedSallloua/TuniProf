import { NextResponse } from 'next/server';
import { handleInboundMessage } from '@/lib/auth/verification';
import { getPool } from '@/lib/db/client';
import { getVerificationProviderName } from '@/lib/env';
import { getVerificationProvider } from '@/lib/verification-provider';
import { answerWebhookHandshake } from '@/lib/verification-provider/whatsapp';

export const dynamic = 'force-dynamic';

// Meta calls this once, when the webhook is set up, to check that we own the URL.
export async function GET(request: Request) {
  if (getVerificationProviderName() !== 'whatsapp') {
    return new NextResponse('Not found', { status: 404 });
  }
  const answer = answerWebhookHandshake(new URL(request.url).searchParams);
  return answer === null
    ? new NextResponse('Forbidden', { status: 403 })
    : new NextResponse(answer, { status: 200 });
}

// Meta calls this for every incoming WhatsApp message.
export async function POST(request: Request) {
  const provider = getVerificationProvider();
  const rawBody = await request.text();

  if (!provider.verifyRequest(rawBody, request.headers)) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  const pool = getPool();
  for (const message of provider.parseInbound(body)) {
    try {
      await handleInboundMessage(pool, { provider: provider.name, ...message });
    } catch (error) {
      // Never answer with an error for one bad message: Meta would retry the whole delivery.
      console.error(
        'whatsapp webhook: message failed:',
        (error as Error).message,
      );
    }
  }
  // Always 200 once the signature is right, as Meta expects.
  return NextResponse.json({ received: true });
}
