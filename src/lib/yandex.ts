/**
 * Клиент неофициального API Яндекс.Музыки (api.music.yandex.net).
 *
 * Официального публичного API у сервиса нет. Пути и заголовки взяты из
 * MarshalX/yandex-music-api — того же набора, которым пользуются мобильные клиенты.
 */

import type { TrackRef } from './match';

const BASE = 'https://api.music.yandex.net';

/** Заголовки, которые Яндекс ожидает от «своего» клиента. Без них часть ручек отвечает 400. */
function headers(token: string): Record<string, string> {
  return {
    Authorization: `OAuth ${token}`,
    'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
    'User-Agent': 'Yandex-Music-API',
  };
}

export class YandexError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'YandexError';
  }
}

/** Ответы API завёрнуты в { invocationInfo, result }. */
type Envelope<T> = {
  result?: T;
  error?: { name?: string; message?: string };
};

async function call<T>(
  token: string,
  path: string,
  init?: { method?: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; form?: Record<string, string> },
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const method = init?.method ?? 'GET';
  const requestHeaders = headers(token);
  let body: string | undefined;

  if (init?.form) {
    body = new URLSearchParams(init.form).toString();
    requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, { method, headers: requestHeaders, body, cache: 'no-store' });
  const text = await res.text();

  if (!res.ok) {
    // Яндекс кладёт человекочитаемую причину в тело, но не всегда валидным JSON.
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as Envelope<unknown>;
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* тело не JSON — оставляем как есть */
    }
    if (res.status === 401 || res.status === 403) {
      throw new YandexError(`Токен Яндекса отклонён (${res.status}). Скорее всего он истёк — получи новый.`, res.status);
    }
    throw new YandexError(`Яндекс ответил ${res.status}: ${detail}`, res.status);
  }

  const parsed = JSON.parse(text) as Envelope<T>;
  if (parsed.result === undefined) {
    throw new YandexError('Яндекс вернул ответ без поля result', res.status);
  }
  return parsed.result;
}

/* ------------------------------------------------------------------ */
/* Типы (только те поля, которые реально используются)                 */
/* ------------------------------------------------------------------ */

export type YmArtist = { id?: number | string; name: string };
export type YmAlbum = { id?: number | string; title?: string; year?: number };

export type YmTrack = {
  id: number | string;
  title: string;
  /** Подзаголовок вида «feat. X» или «Remastered» — Яндекс держит его отдельно от title. */
  version?: string;
  durationMs?: number;
  available?: boolean;
  artists?: YmArtist[];
  albums?: YmAlbum[];
};

export type YmAccount = {
  uid: number;
  login?: string;
  displayName?: string;
  hasPlus: boolean;
};

export type YmPlaylistMeta = {
  kind: number;
  title: string;
  trackCount: number;
};

export function normalizeTrack(track: YmTrack): TrackRef {
  return {
    id: String(track.id),
    title: track.title ?? '',
    version: track.version,
    artists: (track.artists ?? []).map((a) => a.name).filter(Boolean),
    album: track.albums?.[0]?.title,
    // Без albumId Яндекс не примет трек при вставке в плейлист.
    albumId: track.albums?.[0]?.id === undefined ? undefined : String(track.albums[0].id),
    durationMs: track.durationMs ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Методы                                                              */
/* ------------------------------------------------------------------ */

type AccountStatusResult = {
  account: { uid: number; login?: string; displayName?: string };
  plus?: { hasPlus?: boolean };
};

export async function getAccount(token: string): Promise<YmAccount> {
  const result = await call<AccountStatusResult>(token, '/account/status');
  return {
    uid: result.account.uid,
    login: result.account.login,
    displayName: result.account.displayName,
    hasPlus: Boolean(result.plus?.hasPlus),
  };
}

type LikesResult = { library: { tracks: Array<{ id: number | string; albumId?: string }> } };

/** Идентификаторы всех лайкнутых треков, в порядке от новых к старым. */
export async function getLikedTrackIds(token: string, uid: number): Promise<string[]> {
  const result = await call<LikesResult>(token, `/users/${uid}/likes/tracks`);
  return result.library.tracks.map((t) => String(t.id));
}

/**
 * Догрузка полных карточек треков по идентификаторам.
 * Яндекс не любит слишком длинные списки, поэтому режем по 250 штук.
 */
export async function getTracks(token: string, ids: string[]): Promise<YmTrack[]> {
  const out: YmTrack[] = [];
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const result = await call<YmTrack[]>(token, '/tracks', {
      method: 'POST',
      form: { 'track-ids': chunk.join(','), 'with-positions': 'False' },
    });
    out.push(...result);
  }
  return out;
}

export async function getPlaylists(token: string, uid: number): Promise<YmPlaylistMeta[]> {
  const result = await call<Array<{ kind: number; title: string; trackCount?: number }>>(
    token,
    `/users/${uid}/playlists/list`,
  );
  return result.map((p) => ({ kind: p.kind, title: p.title, trackCount: p.trackCount ?? 0 }));
}

type PlaylistResult = {
  kind: number;
  title: string;
  tracks?: Array<{ id: number | string; track?: YmTrack }>;
};

/**
 * Треки конкретного плейлиста.
 * В длинных плейлистах Яндекс отдаёт часть позиций «пустыми» (только id),
 * поэтому недостающие карточки догружаем отдельным батчем.
 */
export async function getPlaylistTracks(token: string, uid: number, kind: number): Promise<TrackRef[]> {
  const result = await call<PlaylistResult>(token, `/users/${uid}/playlists/${kind}`);
  const entries = result.tracks ?? [];

  const resolved = new Map<string, YmTrack>();
  const missing: string[] = [];

  for (const entry of entries) {
    const id = String(entry.id);
    if (entry.track) resolved.set(id, entry.track);
    else missing.push(id);
  }

  if (missing.length > 0) {
    for (const track of await getTracks(token, missing)) {
      resolved.set(String(track.id), track);
    }
  }

  // Порядок в плейлисте важен — восстанавливаем его по исходному списку.
  return entries
    .map((entry) => resolved.get(String(entry.id)))
    .filter((t): t is YmTrack => Boolean(t))
    .map(normalizeTrack);
}

/* ------------------------------------------------------------------ */
/* История прослушиваний                                               */
/* ------------------------------------------------------------------ */

type HistoryResult = {
  historyTabs?: Array<{
    date?: string;
    items?: Array<{
      tracks?: Array<{ type?: string; data?: { itemId?: { trackId?: string } } }>;
    }>;
  }>;
};

/**
 * Что пользователь действительно слушал, от частого к редкому.
 *
 * История приходит журналом с повторами и разбита по дням. Повтор здесь —
 * самый ценный сигнал: трек, включённый двадцать раз, характеризует вкус
 * лучше, чем случайно заигравший один раз. Поэтому считаем частоту и
 * сортируем по ней, а при равенстве — по свежести.
 */
export async function getListeningHistory(token: string): Promise<string[]> {
  const result = await call<HistoryResult>(token, '/music-history', {
    query: { fullModelsCount: 0 },
  });

  const plays = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let position = 0;

  // Вкладки идут от свежих дней к старым, поэтому позиция = свежесть.
  for (const tab of result.historyTabs ?? []) {
    for (const group of tab.items ?? []) {
      for (const entry of group.tracks ?? []) {
        const id = entry.data?.itemId?.trackId;
        if (!id) continue;
        plays.set(id, (plays.get(id) ?? 0) + 1);
        if (!firstSeen.has(id)) firstSeen.set(id, position++);
      }
    }
  }

  return [...plays.keys()].sort((a, b) => {
    const byPlays = (plays.get(b) ?? 0) - (plays.get(a) ?? 0);
    if (byPlays !== 0) return byPlays;
    return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
  });
}

/* ------------------------------------------------------------------ */
/* «Моя волна» и похожие треки                                         */
/* ------------------------------------------------------------------ */

type DashboardResult = {
  stations: Array<{ station: { id: { type: string; tag: string }; name?: string; idForFrom?: string } }>;
};

export type WaveStation = {
  /** Идентификатор станции вида `user:onyourwave`. */
  id: string;
  /**
   * Значение параметра `from` для фидбека. Яндекс сверяет его со станцией:
   * произвольная строка приводит к тому, что сессия не считается
   * персональной и ротор скатывается в обезличенный поток хитов.
   */
  from: string;
};

export async function getMyWaveStation(token: string): Promise<WaveStation> {
  try {
    const result = await call<DashboardResult>(token, '/rotor/stations/dashboard');
    const personal = result.stations.find((s) => s.station.id.type === 'user') ?? result.stations[0];
    if (personal) {
      const id = `${personal.station.id.type}:${personal.station.id.tag}`;
      const idForFrom = personal.station.idForFrom ?? `${personal.station.id.type}-${personal.station.id.tag}`;
      return { id, from: `desktop_win-radio-${idForFrom}` };
    }
  } catch {
    /* дашборд иногда недоступен — ниже безопасный дефолт */
  }
  return { id: 'user:onyourwave', from: 'desktop_win-radio-user-onyourwave' };
}

/**
 * Инициализация сессии ротора.
 *
 * Официальные клиенты дёргают эту ручку перед запуском станции, и без неё
 * Яндекс не связывает последующие запросы с конкретным пользователем.
 */
async function initRotorSession(token: string): Promise<void> {
  try {
    await call<unknown>(token, '/rotor/account/status');
  } catch {
    // Не критично: станция всё равно ответит, просто менее персонально.
  }
}

type StationTracksResult = {
  batchId?: string;
  sequence: Array<{ track?: YmTrack }>;
};

/**
 * Прокрутка цепочки «Моей волны».
 *
 * Ротор отдаёт треки небольшими партиями и продолжает цепочку только если
 * ему сообщить, какой трек только что отыграл (`queue`) и прислать фидбек.
 * Без фидбека станция начинает возвращать одно и то же, поэтому он здесь
 * не косметика, а условие продвижения.
 */
export async function collectMyWave(
  token: string,
  station: WaveStation,
  wanted: number,
  onProgress?: (collected: number) => void,
): Promise<TrackRef[]> {
  const collected = new Map<string, TrackRef>();
  let queue: string | undefined;
  let emptyRounds = 0;

  await initRotorSession(token);
  await feedback(token, station, { type: 'radioStarted' });

  // Потолок итераций защищает от бесконечного цикла, если станция зациклится.
  for (let i = 0; i < 60 && collected.size < wanted; i++) {
    const result = await call<StationTracksResult>(token, `/rotor/station/${station.id}/tracks`, {
      // settings2 официальные клиенты передают всегда, в том числе при продолжении цепочки.
      query: { settings2: 'True', queue },
    });
    const batchId = result.batchId;

    const before = collected.size;
    let last: TrackRef | undefined;

    for (const item of result.sequence ?? []) {
      if (!item.track) continue;
      const normalized = normalizeTrack(item.track);
      last = normalized;
      if (!collected.has(normalized.id) && collected.size < wanted) {
        collected.set(normalized.id, normalized);
      }
    }

    onProgress?.(collected.size);

    // Ничего нового за две итерации подряд — станция исчерпалась.
    if (collected.size === before) {
      if (++emptyRounds >= 2) break;
    } else {
      emptyRounds = 0;
    }

    if (!last) break;

    // Полный цикл прослушивания: станция сдвигает цепочку только после того,
    // как трек отмечен и начатым, и дослушанным. Одного trackFinished мало —
    // без trackStarted ротор считает, что трек не играл, и выдаёт то же самое.
    await feedback(token, station, { type: 'trackStarted', batchId, trackId: last.id });
    await feedback(token, station, {
      type: 'trackFinished',
      batchId,
      trackId: last.id,
      totalPlayedSeconds: Math.round((last.durationMs || 180_000) / 1000),
    });

    queue = last.id;
  }

  return [...collected.values()];
}

async function feedback(
  token: string,
  station: WaveStation,
  payload: {
    type: string;
    batchId?: string;
    trackId?: string;
    totalPlayedSeconds?: number;
  },
): Promise<void> {
  const form: Record<string, string> = {
    type: payload.type,
    timestamp: String(Date.now() / 1000),
    from: station.from,
  };
  if (payload.trackId) form.trackId = payload.trackId;
  if (payload.totalPlayedSeconds !== undefined) form.totalPlayedSeconds = String(payload.totalPlayedSeconds);

  try {
    await call<string>(token, `/rotor/station/${station.id}/feedback`, {
      method: 'POST',
      query: payload.batchId ? { 'batch-id': payload.batchId } : undefined,
      form,
    });
  } catch {
    // Фидбек — вспомогательный вызов. Если он не прошёл, цепочка просто
    // продвинется хуже, но ронять из-за этого весь сбор волны не стоит.
  }
}

type SimilarResult = { similarTracks?: YmTrack[] };

/** Треки, похожие на заданный. Используется, чтобы добить волну, если ротор отдал мало. */
export async function getSimilarTracks(token: string, trackId: string): Promise<TrackRef[]> {
  try {
    const result = await call<SimilarResult>(token, `/tracks/${trackId}/similar`);
    return (result.similarTracks ?? []).map(normalizeTrack);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Поиск и запись — направление Spotify → Яндекс                       */
/* ------------------------------------------------------------------ */

type SearchResult = { tracks?: { results?: YmTrack[] } };

/**
 * Поиск трека.
 *
 * `nocorrect=false` оставляет исправление опечаток включённым: названия
 * приезжают из чужого сервиса и нередко записаны иначе.
 */
export async function searchTracks(token: string, query: string): Promise<TrackRef[]> {
  const result = await call<SearchResult>(token, '/search', {
    query: { text: query, type: 'track', page: 0, nocorrect: 'false' },
  });
  return (result.tracks?.results ?? []).map(normalizeTrack);
}

/** Отметка «Мне нравится». Яндекс принимает пачку идентификаторов за раз. */
export async function likeTracks(token: string, uid: number, trackIds: string[]): Promise<void> {
  for (let i = 0; i < trackIds.length; i += 150) {
    await call<unknown>(token, `/users/${uid}/likes/tracks/add-multiple`, {
      method: 'POST',
      form: { 'track-ids': trackIds.slice(i, i + 150).join(',') },
    });
  }
}

type CreatedPlaylist = { kind: number; revision?: number };

export async function createPlaylist(token: string, uid: number, title: string): Promise<CreatedPlaylist> {
  const result = await call<CreatedPlaylist>(token, `/users/${uid}/playlists/create`, {
    method: 'POST',
    form: { title, visibility: 'private' },
  });
  return { kind: result.kind, revision: result.revision ?? 1 };
}

/**
 * Добавление треков в плейлист.
 *
 * Яндекс правит плейлисты не списком, а операциями над ним, и каждая операция
 * должна ссылаться на текущую ревизию. Ревизия растёт после каждого запроса,
 * поэтому её приходится тянуть из ответа — иначе следующая пачка отлетит
 * с конфликтом.
 */
export async function addTracksToPlaylist(
  token: string,
  uid: number,
  kind: number,
  tracks: TrackRef[],
  startRevision = 1,
): Promise<void> {
  // Треки без albumId Яндекс не примет — операция вставки требует оба поля.
  const insertable = tracks.filter((t) => t.albumId);
  let revision = startRevision;
  let at = 0;

  for (let i = 0; i < insertable.length; i += 100) {
    const chunk = insertable.slice(i, i + 100);
    const diff = JSON.stringify([
      {
        op: 'insert',
        at,
        tracks: chunk.map((t) => ({ id: t.id, albumId: t.albumId })),
      },
    ]);

    const result = await call<{ revision?: number }>(token, `/users/${uid}/playlists/${kind}/change`, {
      method: 'POST',
      form: { kind: String(kind), revision: String(revision), diff },
    });

    revision = result.revision ?? revision + 1;
    at += chunk.length;
  }
}
