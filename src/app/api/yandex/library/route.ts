import { NextResponse } from 'next/server';
import { requireYandex, NotConnectedError } from '@/lib/server';
import { getAccount, getLikedTrackIds, getPlaylists } from '@/lib/yandex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Что вообще есть в библиотеке — чтобы показать выбор до запуска переноса. */
export async function GET() {
  try {
    const token = await requireYandex();
    const account = await getAccount(token);

    const [likedIds, playlists] = await Promise.all([
      getLikedTrackIds(token, account.uid),
      getPlaylists(token, account.uid),
    ]);

    return NextResponse.json({
      likedCount: likedIds.length,
      playlists: playlists
        .filter((p) => p.trackCount > 0)
        .sort((a, b) => b.trackCount - a.trackCount)
        // kind — число, но интерфейс работает с идентификаторами обоих сервисов
        // одинаково, поэтому приводим к строке.
        .map((p) => ({ id: String(p.kind), title: p.title, trackCount: p.trackCount })),
    });
  } catch (error) {
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Не удалось прочитать библиотеку';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
