import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeUrl } from '@/lib/spotify';
import { attachOauthState } from '@/lib/session';
import { hasSpotifyCredentials } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasSpotifyCredentials()) {
    // Относительный Location — чтобы не увести браузер на другой origin.
    return new NextResponse(null, { status: 307, headers: { Location: '/?error=no_client' } });
  }

  const state = randomBytes(16).toString('hex');
  const response = NextResponse.redirect(authorizeUrl(state));
  // Кука ставится на сам редирект: иначе Next её потеряет и на возврате
  // сверять будет нечего.
  attachOauthState(response, state);
  return response;
}
