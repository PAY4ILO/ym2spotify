import { NextResponse } from 'next/server';
import { NotConnectedError, requireSpotify, requireYandex } from '@/lib/server';
import { rememberMatch, saveCache } from '@/lib/store';
import { getAccount, likeTracks, searchTracks } from '@/lib/yandex';
import type { Direction } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isReverse(value: string | null): boolean {
  return (value as Direction) === 'sp2ym';
}

/** Ручной поиск для треков, которые автоматика не смогла опознать. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim();
  if (!query) return NextResponse.json({ tracks: [] });

  try {
    // Искать нужно в том сервисе, куда переносим.
    const tracks = isReverse(params.get('direction'))
      ? await searchTracks(await requireYandex(), query)
      : await (await requireSpotify()).searchTracks(query);

    return NextResponse.json({
      tracks: tracks.map((t) => ({
        uri: t.uri ?? t.id,
        label: `${t.artists.join(', ')} — ${t.title}`,
        album: t.album,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Привязка выбранного вручную трека.
 *
 * Трек сразу уходит в медиатеку целевого сервиса, а сама привязка запоминается
 * как ручная — при следующем запуске он встанет и в свои плейлисты.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    uri?: string;
    direction?: Direction;
  };
  if (!body.id || !body.uri) {
    return NextResponse.json({ error: 'Нужны id и uri' }, { status: 400 });
  }

  const reverse = body.direction === 'sp2ym';

  try {
    if (reverse) {
      const token = await requireYandex();
      const account = await getAccount(token);
      await likeTracks(token, account.uid, [body.uri]);
    } else {
      await (await requireSpotify()).saveToLibrary([body.uri]);
    }

    await rememberMatch(`${reverse ? 'sp:' : 'ym:'}${body.id}`, { uri: body.uri, score: 1, manual: true });
    await saveCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof NotConnectedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : 'Ошибка';
  return NextResponse.json({ error: message }, { status: 400 });
}
