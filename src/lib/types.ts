/** Формы данных, общие для роутов и клиентских компонентов. */

/** Куда переносим. */
export type Direction = 'ym2sp' | 'sp2ym';

export type Status = {
  /** Заданы ли ключи Spotify. */
  configured: boolean;
  /** Ключи пришли из переменных окружения — форма в интерфейсе их не перебивает. */
  envManaged: boolean;
  /** Адрес, который нужно вписать в настройках приложения Spotify. */
  redirectUri: string;
  spotify: { displayName: string; product?: string } | null;
  spotifyError: string | null;
  yandex: { login?: string; displayName?: string; hasPlus: boolean } | null;
  yandexError: string | null;
};

/** Плейлист источника. `id` — число (kind) у Яндекса и строка у Spotify. */
export type PlaylistMeta = { id: string; title: string; trackCount: number };

export type Library = { likedCount: number; playlists: PlaylistMeta[] };

export type ReviewItem = {
  id: string;
  source: string;
  candidates: Array<{ uri: string; label: string; score: number }>;
};

export type Summary = {
  total: number;
  transferred: number;
  review: ReviewItem[];
  missed: Array<{ id: string; source: string }>;
};

export type TransferEvent =
  | { type: 'stage'; stage: string; message: string; total?: number }
  | { type: 'progress'; done: number; total: number; title: string; outcome: string; matched?: string }
  | { type: 'done'; summary: Summary }
  | { type: 'error'; message: string };
