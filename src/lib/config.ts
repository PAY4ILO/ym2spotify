/**
 * Настройки приложения.
 *
 * Ключи Spotify хранятся в `data/config.json` и вводятся прямо в интерфейсе,
 * а не правкой файлов: переменные окружения читаются только при старте процесса,
 * поэтому форма с ними требовала бы перезапуска на каждое изменение.
 * Переменные окружения при этом никуда не делись и имеют приоритет — так
 * удобнее тем, кто разворачивает приложение своими средствами.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'config.json');

export type AppConfig = {
  spotifyClientId: string;
  spotifyClientSecret: string;
  /** Секрет для шифрования кук. Генерируется сам при первом запуске. */
  sessionSecret: string;
};

type StoredConfig = Partial<AppConfig>;

let cache: StoredConfig | null = null;

function readStored(): StoredConfig {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8')) as StoredConfig;
  } catch {
    // Файла ещё нет — это нормальный первый запуск.
    cache = {};
  }
  return cache;
}

function writeStored(next: StoredConfig): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  cache = next;
}

export function port(): number {
  return Number(process.env.PORT) || 4321;
}

/**
 * Адрес возврата после входа в Spotify.
 * Строго `127.0.0.1`: `localhost` Spotify в редиректах не принимает.
 */
export function redirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${port()}/api/auth/spotify/callback`;
}

export function getConfig(): AppConfig {
  const stored = readStored();
  return {
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || stored.spotifyClientId || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || stored.spotifyClientSecret || '',
    sessionSecret: process.env.SESSION_SECRET || stored.sessionSecret || ensureSessionSecret(),
  };
}

/** Секрет генерируется один раз и переживает перезапуски — иначе сессия слетала бы каждый раз. */
function ensureSessionSecret(): string {
  const stored = readStored();
  if (stored.sessionSecret) return stored.sessionSecret;

  const secret = randomBytes(32).toString('hex');
  writeStored({ ...stored, sessionSecret: secret });
  return secret;
}

export function saveSpotifyCredentials(clientId: string, clientSecret: string): void {
  const stored = readStored();
  writeStored({ ...stored, spotifyClientId: clientId.trim(), spotifyClientSecret: clientSecret.trim() });
}

export function hasSpotifyCredentials(): boolean {
  const config = getConfig();
  return Boolean(config.spotifyClientId && config.spotifyClientSecret);
}

/** Ключи заданы через окружение — тогда форма в интерфейсе их не перебивает. */
export function credentialsFromEnv(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}
