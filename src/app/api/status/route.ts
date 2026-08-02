import { NextResponse } from 'next/server';
import { getSpotifyTokens, getYandexToken } from '@/lib/session';
import { SpotifyClient } from '@/lib/spotify';
import { getAccount } from '@/lib/yandex';
import { credentialsFromEnv, hasSpotifyCredentials, redirectUri } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Состояние настройки и обоих подключений — на нём строится вся стартовая страница. */
export async function GET() {
  const configured = hasSpotifyCredentials();

  let spotify: { displayName: string; product?: string } | null = null;
  let spotifyError: string | null = null;

  const tokens = await getSpotifyTokens();
  if (tokens) {
    try {
      spotify = await new SpotifyClient(tokens).me();
    } catch (error) {
      spotifyError = error instanceof Error ? error.message : 'не удалось получить профиль';
    }
  }

  let yandex: { login?: string; displayName?: string; hasPlus: boolean } | null = null;
  let yandexError: string | null = null;

  const token = await getYandexToken();
  if (token) {
    try {
      const account = await getAccount(token);
      yandex = { login: account.login, displayName: account.displayName, hasPlus: account.hasPlus };
    } catch (error) {
      yandexError = error instanceof Error ? error.message : 'токен не принят';
    }
  }

  return NextResponse.json({
    configured,
    envManaged: credentialsFromEnv(),
    redirectUri: redirectUri(),
    spotify,
    spotifyError,
    yandex,
    yandexError,
  });
}
