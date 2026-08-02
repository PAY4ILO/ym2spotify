import { NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/spotify';
import { attachSpotifyTokens, clearOauthState, readOauthState } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Возврат на главную относительным Location.
 *
 * Абсолютный адрес пришлось бы собирать из `request.url`, а он в dev-режиме
 * приходит с хостом `localhost`, даже когда браузер работает на `127.0.0.1`.
 * Для браузера это разные origin: куку он положил бы одному, а страницу открыл
 * у другого — и подключение выглядело бы неудавшимся. Относительный путь
 * браузер разрешает от текущего адреса, поэтому origin остаётся тем же.
 */
function home(params: string): NextResponse {
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: `/${params}` },
  });
  // state одноразовый — гасим на любом исходе.
  clearOauthState(response);
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const denied = url.searchParams.get('error');
  if (denied) return home(`?error=${encodeURIComponent(denied)}`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = await readOauthState();

  // Без совпадения state запрос мог быть инициирован не нами.
  if (!code || !state || state !== expected) {
    return home('?error=state_mismatch');
  }

  try {
    const tokens = await exchangeCode(code);
    const response = home('?connected=spotify');
    attachSpotifyTokens(response, tokens);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка';
    return home(`?error=${encodeURIComponent(message)}`);
  }
}
