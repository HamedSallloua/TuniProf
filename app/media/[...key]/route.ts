import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { isValidStorageKey } from '@/lib/storage/provider';

export const dynamic = 'force-dynamic';

// Serves uploaded photos in development (local folder). In production the bucket's own
// address is used instead. Only files under photos/ are ever served.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const key = (await params).key.join('/');
  if (!key.startsWith('photos/') || !isValidStorageKey(key)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const file = await getStorage().get(key);
  if (!file) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      // File names are random and never reused, so they can be cached for good.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
