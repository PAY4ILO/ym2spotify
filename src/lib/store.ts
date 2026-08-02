/**
 * Локальный кэш результатов сопоставления в data/cache.json.
 *
 * Нужен для двух вещей: повторный запуск не тратит квоту Spotify на уже
 * разобранные треки, а ручные привязки не теряются между запусками.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'cache.json');

export type CachedMatch = {
  /** null означает «искали и не нашли» — это тоже результат, его стоит помнить. */
  uri: string | null;
  title?: string;
  artists?: string[];
  score?: number;
  /** true, если вариант выбрал человек руками. Такие записи не перетираются автоматикой. */
  manual?: boolean;
};

type Cache = {
  matches: Record<string, CachedMatch>;
  /** kind плейлиста в Яндексе -> id плейлиста в Spotify, чтобы не плодить дубли. */
  playlists: Record<string, string>;
};

const EMPTY: Cache = { matches: {}, playlists: {} };

let memory: Cache | null = null;
/** Запись идёт через цепочку промисов — параллельные сохранения не затирают друг друга. */
let writeQueue: Promise<void> = Promise.resolve();

export async function loadCache(): Promise<Cache> {
  if (memory) return memory;
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Cache>;
    memory = { matches: parsed.matches ?? {}, playlists: parsed.playlists ?? {} };
  } catch {
    // Файла ещё нет или он повреждён — начинаем с чистого кэша.
    memory = { ...EMPTY, matches: {}, playlists: {} };
  }
  return memory;
}

export async function saveCache(): Promise<void> {
  const snapshot = memory;
  if (!snapshot) return;
  writeQueue = writeQueue.then(async () => {
    await mkdir(DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  });
  return writeQueue;
}

export async function rememberMatch(ymId: string, match: CachedMatch): Promise<void> {
  const cache = await loadCache();
  // Ручной выбор — источник истины: автоматика его не перезаписывает.
  if (cache.matches[ymId]?.manual && !match.manual) return;
  cache.matches[ymId] = match;
}

export async function rememberPlaylist(kind: string, playlistId: string): Promise<void> {
  const cache = await loadCache();
  cache.playlists[kind] = playlistId;
}

export async function forgetAll(): Promise<void> {
  memory = { matches: {}, playlists: {} };
  await saveCache();
}
