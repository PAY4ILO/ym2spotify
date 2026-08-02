import { NextResponse } from 'next/server';
import { ndjson, requireSpotify, requireYandex, type Emit } from '@/lib/server';
import { buildSummary, dedupe, emptySummary, matchAll, type Group, type Resolved } from '@/lib/transfer';
import { loadCache, rememberPlaylist, saveCache } from '@/lib/store';
import type { SpotifyClient } from '@/lib/spotify';
import {
  collectMyWave,
  getAccount,
  getLikedTrackIds,
  getListeningHistory,
  getMyWaveStation,
  getPlaylists,
  getPlaylistTracks,
  getSimilarTracks,
  getTracks,
  normalizeTrack,
} from '@/lib/yandex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

type Body = {
  likes?: boolean;
  /** kind'ы плейлистов Яндекса, выбранные пользователем. */
  playlists?: number[];
  /** Сколько треков взять из истории прослушиваний. 0 — не брать. */
  historySize?: number;
  /** Сколько треков собрать в «Мою волну». 0 — не собирать. */
  waveSize?: number;
  /** Перепроверить треки, которые в прошлый раз не нашлись. */
  retryMisses?: boolean;
};

/** Плейлисты, которые обновляются на месте, а не создаются заново при каждом запуске. */
const REGENERATED: Record<string, { title: string; description: string }> = {
  wave: {
    title: 'Моя волна (из Яндекса)',
    description: 'Собрано ротором Яндекс.Музыки и перенесено в Spotify',
  },
  history: {
    title: 'Что я слушал в Яндексе',
    description: 'История прослушиваний Яндекс.Музыки, от частого к редкому',
  },
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  // Куки читаются здесь, а не внутри потока: как только начнётся отдача тела,
  // контекст запроса уже недоступен.
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
    // Лучше упасть сейчас, чем на середине переноса.
    await spotify.me();

    const account = await getAccount(yandexToken);
    const groups = await collectGroups(yandexToken, account.uid, body, emit);

    const unique = dedupe(groups);
    if (unique.length === 0) {
      emit({ type: 'done', summary: emptySummary() });
      return;
    }

    const matches = await matchAll(
      unique,
      {
        search: (query) => spotify.searchTracks(query),
        prefix: 'ym:',
        // Полевой синтаксис `track:"…" artist:"…"` понимает только Spotify.
        fieldSyntax: true,
        retryMisses: Boolean(body.retryMisses),
      },
      emit,
    );

    await applyGroups(spotify, groups, matches, emit);
    await saveCache();

    emit({ type: 'done', summary: buildSummary(groups, matches) });
  });
}

async function collectGroups(token: string, uid: number, body: Body, emit: Emit): Promise<Group[]> {
  const groups: Group[] = [];

  if (body.likes) {
    emit({ type: 'stage', stage: 'fetch', message: 'Читаю лайки в Яндексе…' });
    const ids = await getLikedTrackIds(token, uid);
    const tracks = (await getTracks(token, ids)).map(normalizeTrack);
    groups.push({ key: 'likes', kind: 'likes', title: 'Мне нравится', tracks });
    emit({ type: 'stage', stage: 'fetch', message: `Лайков: ${tracks.length}` });
  }

  const wantedPlaylists = body.playlists ?? [];
  if (wantedPlaylists.length > 0) {
    const titles = new Map((await getPlaylists(token, uid)).map((p) => [p.kind, p.title]));

    for (const kind of wantedPlaylists) {
      const title = titles.get(kind) ?? `Плейлист ${kind}`;
      emit({ type: 'stage', stage: 'fetch', message: `Читаю плейлист «${title}»…` });
      const tracks = await getPlaylistTracks(token, uid, kind);
      groups.push({ key: `playlist:${kind}`, kind: 'playlist', title, tracks });
    }
  }

  const historySize = body.historySize ?? 0;
  if (historySize > 0) {
    emit({ type: 'stage', stage: 'fetch', message: 'Читаю историю прослушиваний…' });
    const ids = (await getListeningHistory(token)).slice(0, historySize);
    const tracks = (await getTracks(token, ids)).map(normalizeTrack);
    groups.push({ key: 'history', kind: 'history', title: 'Что я слушал', tracks });
    emit({ type: 'stage', stage: 'fetch', message: `Из истории: ${tracks.length} треков` });
  }

  const waveSize = body.waveSize ?? 0;
  if (waveSize > 0) {
    emit({ type: 'stage', stage: 'fetch', message: 'Раскручиваю «Мою волну»…' });
    const station = await getMyWaveStation(token);
    const wave = await collectMyWave(token, station, waveSize, (collected) => {
      emit({ type: 'stage', stage: 'fetch', message: `«Моя волна»: собрано ${collected} из ${waveSize}` });
    });

    // Ротор нередко выдыхается раньше, чем наберётся нужное количество.
    if (wave.length < waveSize) {
      emit({ type: 'stage', stage: 'fetch', message: 'Волна иссякла, добираю похожими треками…' });
      const seen = new Set(wave.map((t) => t.id));
      for (const seed of wave.slice(0, 20)) {
        if (wave.length >= waveSize) break;
        for (const similar of await getSimilarTracks(token, seed.id)) {
          if (wave.length >= waveSize) break;
          if (seen.has(similar.id)) continue;
          seen.add(similar.id);
          wave.push(similar);
        }
      }
    }

    groups.push({ key: 'wave', kind: 'wave', title: 'Моя волна', tracks: wave });
    emit({ type: 'stage', stage: 'fetch', message: `«Моя волна»: ${wave.length} треков` });
  }

  return groups;
}

async function applyGroups(
  spotify: SpotifyClient,
  groups: Group[],
  matches: Map<string, Resolved>,
  emit: Emit,
): Promise<void> {
  const cache = await loadCache();

  for (const group of groups) {
    const uris = group.tracks
      .map((track) => matches.get(track.id)?.target?.uri)
      .filter((uri): uri is string => Boolean(uri));

    // Spotify ругается на повторы внутри одного плейлиста.
    const unique = [...new Set(uris)];

    if (unique.length === 0) {
      emit({ type: 'stage', stage: 'apply', message: `«${group.title}»: переносить нечего` });
      continue;
    }

    if (group.kind === 'likes') {
      emit({ type: 'stage', stage: 'apply', message: `Добавляю ${unique.length} треков в медиатеку…` });
      await spotify.saveToLibrary(unique);
      emit({ type: 'stage', stage: 'apply', message: `Медиатека: добавлено ${unique.length}` });
      continue;
    }

    const regenerated = REGENERATED[group.key];
    if (regenerated) {
      // Такие плейлисты обновляются на месте, чтобы ссылка не менялась
      // и повторный запуск не плодил копии.
      let playlistId = cache.playlists[group.key];

      if (!playlistId || !(await spotify.playlistExists(playlistId))) {
        const created = await spotify.createPlaylist(regenerated.title, regenerated.description);
        playlistId = created.id;
        await rememberPlaylist(group.key, playlistId);
        emit({ type: 'stage', stage: 'apply', message: `Создал плейлист «${regenerated.title}» — ${created.url}` });
      }

      await spotify.replacePlaylistItems(playlistId, unique);
      emit({ type: 'stage', stage: 'apply', message: `«${regenerated.title}»: ${unique.length} треков` });
      continue;
    }

    const created = await spotify.createPlaylist(group.title, 'Перенесено из Яндекс.Музыки');
    await spotify.addToPlaylist(created.id, unique);
    emit({
      type: 'stage',
      stage: 'apply',
      message: `Плейлист «${group.title}»: ${unique.length} треков — ${created.url}`,
    });
  }
}
