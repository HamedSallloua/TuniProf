import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/auth/crypto';
import { runDailyJob } from '@/lib/billing/jobs';
import { getPool } from '@/lib/db/client';
import { getCronSecret } from '@/lib/env';

export const dynamic = 'force-dynamic';

// Called once a day by the host's cron with the header "Authorization: Bearer <CRON_SECRET>".
// Without the right secret nothing runs. Running it twice is harmless.
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch {
    return new NextResponse('Jobs are not configured', { status: 503 });
  }
  const given = request.headers.get('authorization') ?? '';
  if (!safeEqual(given, `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const result = await runDailyJob(getPool());
  return NextResponse.json({ ok: true, ...result });
}
