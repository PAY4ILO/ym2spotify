/**
 * Клиент Spotify Web API.
 *
 * Учитывает разбор эндпоинтов от февраля 2026: единая библиотека `PUT /me/library`
 * вместо `PUT /me/tracks`, `POST /playlists/{id}/items` вместо `.../tracks`,
 * `POST /me/playlists` вместо `POST /users/{id}/playlists`, и поиск с потолком
 * limit=10 (раньше было 50).
 */

import type { TrackRef } from './match';
import { getConfig, redirectUri } from './config';

const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

/** Максимум URI за один запрос к /me/library (по документации — 40). */
const LIBRARY_BATCH = 40;
/** Максимум URI за один запрос к /playlists/{id}/items. */
const PLAYLIST_BATCH = 100;

export const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-library-read',
  'user-library-modify',
  'user-follow-modify',
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  /** Unix-время в миллисекундах, когда access-токен протухнет. */
  expiresAt: number;
};

export type SpotifyPlaylistMeta = { id: string; name: string; trackCount: number };

function basicAuth(): string {
  const { spotifyClientId, spotifyClientSecret } = getConfig();
  if (!spotifyClientId || !spotifyClientSecret) {
    throw new SpotifyError('Ключи Spotify не заданы — заполни их на первом шаге', 500);
  }
  return Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getConfig().spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    show_dialog: 'false',
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new SpotifyError(`Spotify не выдал токен (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  return JSON.parse(text) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<SpotifyTokens> {
  const json = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  );
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/* ------------------------------------------------------------------ */
/* Клиент                                                              */
/* ------------------------------------------------------------------ */

export class SpotifyClient {
  private tokens: SpotifyTokens;
  /** Вызывается, когда access-токен обновился — чтобы роут переписал куку. */
  private readonly onRefresh?: (tokens: SpotifyTokens) => void;

  constructor(tokens: SpotifyTokens, onRefresh?: (tokens: SpotifyTokens) => void) {
    this.tokens = tokens;
    this.onRefresh = onRefresh;
  }

  get currentTokens(): SpotifyTokens {
    return this.tokens;
  }

  private async accessToken(): Promise<string> {
    // Обновляем за минуту до истечения, чтобы не словить 401 на середине пачки.
    if (Date.now() < this.tokens.expiresAt - 60_000) return this.tokens.accessToken;

    const json = await tokenRequest(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken }),
    );
    this.tokens = {
      accessToken: json.access_token,
      // Spotify не всегда присылает новый refresh-токен — тогда остаётся старый.
      refreshToken: json.refresh_token ?? this.tokens.refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    this.onRefresh?.(this.tokens);
    return this.tokens.accessToken;
  }

  private async request<T>(
    path: string,
    init: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T | null> {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    // До 5 попыток: 429 отдаёт Retry-After, 5xx лечится обычным бэк-оффом.
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await this.accessToken();
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '2');
        await sleep((Number.isFinite(retryAfter) ? retryAfter : 2) * 1000 + 250);
        continue;
      }

      if (res.status >= 500) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      const text = await res.text();

      if (!res.ok) {
        let detail = text.slice(0, 300);
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          if (parsed.error?.message) detail = parsed.error.message;
        } catch {
          /* тело не JSON */
        }
        if (res.status === 403) {
          detail += ' (частая причина — приложение в Development Mode и аккаунт не добавлен в список пользователей)';
        }
        throw new SpotifyError(`Spotify ответил ${res.status}: ${detail}`, res.status);
      }

      return text ? (JSON.parse(text) as T) : null;
    }

    throw new SpotifyError('Spotify продолжает отвечать 429/5xx после 5 попыток', 429);
  }

  async me(): Promise<{ id: string; displayName: string; product?: string }> {
    const json = await this.request<{ id: string; display_name?: string; product?: string }>('/me');
    return { id: json!.id, displayName: json!.display_name ?? json!.id, product: json!.product };
  }

  /**
   * Поиск треков. limit жёстко ограничен десятью — это потолок API с февраля 2026,
   * запрос с большим значением вернёт 400.
   */
  async searchTracks(query: string, limit = 10): Promise<TrackRef[]> {
    const json = await this.request<{ tracks?: { items: RawTrack[] } }>('/search', {
      query: { q: query, type: 'track', limit: Math.min(limit, 10) },
    });
    return (json?.tracks?.items ?? []).map(toTrackRef);
  }

  /** Постраничный обход коллекций Spotify. */
  private async *paginate<T>(path: string, pageSize: number): AsyncGenerator<T> {
    let offset = 0;
    for (;;) {
      const json = await this.request<{ items?: T[]; total?: number }>(path, {
        query: { limit: pageSize, offset },
      });
      const items = json?.items ?? [];
      for (const item of items) yield item;

      // Пустая или неполная страница означает, что коллекция кончилась.
      if (items.length < pageSize) return;
      offset += pageSize;
    }
  }

  /** Сохранённые треки («Мне нравится» в Spotify). */
  async getSavedTracks(onProgress?: (count: number) => void): Promise<TrackRef[]> {
    const out: TrackRef[] = [];
    for await (const item of this.paginate<{ track?: RawTrack }>('/me/tracks', 50)) {
      if (item.track) out.push(toTrackRef(item.track));
      if (out.length % 200 === 0) onProgress?.(out.length);
    }
    return out;
  }

  async getPlaylists(): Promise<SpotifyPlaylistMeta[]> {
    const out: SpotifyPlaylistMeta[] = [];
    for await (const item of this.paginate<{
      id: string;
      name: string;
      tracks?: { total?: number };
      items?: { total?: number };
    }>('/me/playlists', 50)) {
      out.push({ id: item.id, name: item.name, trackCount: item.items?.total ?? item.tracks?.total ?? 0 });
    }
    return out;
  }

  async getPlaylistItems(playlistId: string): Promise<TrackRef[]> {
    const out: TrackRef[] = [];
    for await (const entry of this.paginate<{ track?: RawTrack | null; item?: RawTrack | null }>(`/playlists/${playlistId}/items`, 100)) {
      // В плейлистах попадаются подкасты и удалённые позиции — у них нет трека.
      const track = entry.item ?? entry.track;
      if (track?.id) out.push(toTrackRef(track));
    }
    return out;
  }

  /**
   * Сохранение в «Мою медиатеку» (лайки).
   * URI передаются строкой в query, а не телом — так описан PUT /me/library.
   */
  async saveToLibrary(uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += LIBRARY_BATCH) {
      const chunk = uris.slice(i, i + LIBRARY_BATCH);
      await this.request<null>('/me/library', {
        method: 'PUT',
        query: { uris: chunk.join(',') },
      });
    }
  }

  async createPlaylist(name: string, description: string): Promise<{ id: string; url: string }> {
    const json = await this.request<{ id: string; external_urls?: { spotify?: string } }>('/me/playlists', {
      method: 'POST',
      body: { name, public: false, description },
    });
    return { id: json!.id, url: json!.external_urls?.spotify ?? `https://open.spotify.com/playlist/${json!.id}` };
  }

  async addToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += PLAYLIST_BATCH) {
      await this.request<{ snapshot_id: string }>(`/playlists/${playlistId}/items`, {
        method: 'POST',
        body: { uris: uris.slice(i, i + PLAYLIST_BATCH) },
      });
    }
  }

  /**
   * Полная замена содержимого плейлиста.
   * PUT затирает список целиком, поэтому первые 100 треков отправляем им,
   * а хвост дописываем обычным добавлением.
   */
  async replacePlaylistItems(playlistId: string, uris: string[]): Promise<void> {
    await this.request<{ snapshot_id: string }>(`/playlists/${playlistId}/items`, {
      method: 'PUT',
      body: { uris: uris.slice(0, PLAYLIST_BATCH) },
    });
    if (uris.length > PLAYLIST_BATCH) {
      await this.addToPlaylist(playlistId, uris.slice(PLAYLIST_BATCH));
    }
  }

  /** Проверка, что плейлист ещё существует (его могли удалить руками между запусками). */
  async playlistExists(playlistId: string): Promise<boolean> {
    try {
      await this.request<unknown>(`/playlists/${playlistId}`, { query: { fields: 'id' } });
      return true;
    } catch {
      return false;
    }
  }
}

type RawTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists?: Array<{ name: string }>;
  album?: { name?: string; images?: Array<{ url: string }> };
};

function toTrackRef(raw: RawTrack): TrackRef {
  return {
    id: raw.id,
    uri: raw.uri,
    title: raw.name,
    artists: (raw.artists ?? []).map((a) => a.name),
    album: raw.album?.name,
    durationMs: raw.duration_ms,
    image: raw.album?.images?.at(-1)?.url,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
