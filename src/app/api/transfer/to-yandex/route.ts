import { NextResponse } from 'next/server';
import { ndjson, requireSpotify, requireYandex, type Emit } from '@/lib/server';
import { buildSummary, dedupe, emptySummary, matchAll, type Group, type Resolved } from '@/lib/transfer';
import { saveCache } from '@/lib/store';
import type { SpotifyClient } from '@/lib/spotify';
import { addTracksToPlaylist, createPlaylist, getAccount, getTracks, likeTracks, normalizeTrack, searchTracks } from '@/lib/yandex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

type Body = {
  likes?: boolean;
  /** Идентификаторы плейлистов Spotify. */
  playlists?: string[];
  retryMisses?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  let yandexToken: string;
  let spotify: SpotifyClient;
  try {
    yandexToken = await requireYandex();
    spotify = await requireSpotify();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Нет подключения';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  return ndjson(async (emit) => {
    await spotify.me();
    const account = await getAccount(yandexToken);

    const groups = await collectGroups(spotify, body, emit);

    const unique = dedupe(groups);
    if (unique.length === 0) {
      emit({ type: 'done', summary: emptySummary() });
      return;
    }

    const matches = await matchAll(
      unique,
      {
        search: (query) => searchTracks(yandexToken, query),
        prefix: 'sp:',
        // Поиск Яндекса полевых операторов не понимает — только обычный текст.
        fieldSyntax: false,
        retryMisses: Boolean(body.retryMisses),
        // Яндекс к своему поиску мягче, чем Spotify к квоте.
        concurrency: 4,
      },
      emit,
    );

    await applyGroups(yandexToken, account.uid, groups, matches, emit);
    await saveCache();

    emit({ type: 'done', summary: buildSummary(groups, matches) });
  });
}

async function collectGroups(spotify: SpotifyClient, body: Body, emit: Emit): Promise<Group[]> {
  const groups: Group[] = [];

  if (body.likes) {
    emit({ type: 'stage', stage: 'fetch', message: 'Читаю медиатеку Spotify…' });
    const tracks = await spotify.getSavedTracks((count) => {
      emit({ type: 'stage', stage: 'fetch', message: `Медиатека Spotify: ${count} треков…` });
    });
    groups.push({ key: 'likes', kind: 'likes', title: 'Мне нравится', tracks });
    emit({ type: 'stage', stage: 'fetch', message: `Лайков в Spotify: ${tracks.length}` });
  }

  const wanted = body.playlists ?? [];
  if (wanted.length > 0) {
    const titles = new Map((await spotify.getPlaylists()).map((p) => [p.id, p.name]));

    for (const id of wanted) {
      const title = titles.get(id) ?? 'Плейлист Spotify';
      emit({ type: 'stage', stage: 'fetch', message: `Читаю плейлист «${title}»…` });
      const tracks = await spotify.getPlaylistItems(id);
      groups.push({ key: `playlist:${id}`, kind: 'playlist', title, tracks });
    }
  }

  return groups;
}

async function applyGroups(
  token: string,
  uid: number,
  groups: Group[],
  matches: Map<string, Resolved>,
  emit: Emit,
): Promise<void> {
  for (const group of groups) {
    const found = group.tracks
      .map((track) => matches.get(track.id)?.target)
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    // Один и тот же трек мог найтись для нескольких исходных — дубликаты не нужны.
    const unique = [...new Map(found.map((t) => [t.id, t])).values()];

    if (unique.length === 0) {
      emit({ type: 'stage', stage: 'apply', message: `«${group.title}»: переносить нечего` });
      continue;
    }

    if (group.kind === 'likes') {
      emit({ type: 'stage', stage: 'apply', message: `Ставлю лайки: ${unique.length} треков…` });
      await likeTracks(token, uid, unique.map((t) => t.id));
      emit({ type: 'stage', stage: 'apply', message: `Лайков поставлено: ${unique.length}` });
      continue;
    }

    // В кэше хранится только ID трека, поэтому запрашиваем ID альбомов у Яндекса.
    // Делаем это до создания плейлиста, чтобы ошибка запроса не оставила пустую копию.
    const missingIds = unique.filter((t) => !t.albumId).map((t) => t.id);
    if (missingIds.length > 0) {
      emit({ type: 'stage', stage: 'apply', message: `Получаем данные об альбомах для «${group.title}»: ${missingIds.length} треков` });
      const details = await getTracks(token, missingIds);
      const albumByTrack = new Map(details.map(normalizeTrack).map((t) => [t.id, t.albumId]));
      for (const track of unique) {
        if (!track.albumId) track.albumId = albumByTrack.get(track.id);
      }
    }

    const created = await createPlaylist(token, uid, group.title);
    await addTracksToPlaylist(token, uid, created.kind, unique, created.revision ?? 1);

    // Треки без albumId Яндекс в плейлист не принимает — честно говорим, сколько дошло.
    const inserted = unique.filter((t) => t.albumId).length;
    emit({
      type: 'stage',
      stage: 'apply',
      message:
        `Плейлист «${group.title}»: ${inserted} треков` +
        (inserted < unique.length ? ` (${unique.length - inserted} без данных об альбоме — пропущены)` : ''),
    });
  }
}
