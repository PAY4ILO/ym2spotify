/**
 * Хранение токенов в httpOnly-куках, зашифрованных AES-256-GCM.
 *
 * Токен Яндекса — это доступ ко всему аккаунту, поэтому он не должен лежать
 * ни в localStorage, ни в открытой куке, ни уезжать в чужой сервис.
 * Всё расшифровывается только на сервере, в браузер значения не попадают.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import type { SpotifyTokens } from './spotify';
import { getConfig } from './config';

const SPOTIFY_COOKIE = 'ym2s_spotify';
const YANDEX_COOKIE = 'ym2s_yandex';
const STATE_COOKIE = 'ym2s_state';
const DEVICE_COOKIE = 'ym2s_device';

function key(): Buffer {
  // Секрет берётся из конфига и генерируется сам при первом запуске,
  // поэтому отдельной настройки от пользователя не требует.
  return createHash('sha256').update(getConfig().sessionSecret).digest();
}

function seal(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}

function unseal(payload: string): string | null {
  try {
    const [ivPart, tagPart, dataPart] = payload.split('.');
    if (!ivPart || !tagPart || !dataPart) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Битая или подменённая кука — ведём себя так, будто её нет.
    return null;
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

export async function setSpotifyTokens(tokens: SpotifyTokens): Promise<void> {
  (await cookies()).set(SPOTIFY_COOKIE, seal(JSON.stringify(tokens)), COOKIE_OPTIONS);
}

export async function getSpotifyTokens(): Promise<SpotifyTokens | null> {
  const raw = (await cookies()).get(SPOTIFY_COOKIE)?.value;
  if (!raw) return null;
  const json = unseal(raw);
  if (!json) return null;
  try {
    return JSON.parse(json) as SpotifyTokens;
  } catch {
    return null;
  }
}

export async function setYandexToken(token: string): Promise<void> {
  (await cookies()).set(YANDEX_COOKIE, seal(token), COOKIE_OPTIONS);
}

export async function getYandexToken(): Promise<string | null> {
  const raw = (await cookies()).get(YANDEX_COOKIE)?.value;
  return raw ? unseal(raw) : null;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SPOTIFY_COOKIE);
  store.delete(YANDEX_COOKIE);
}

/**
 * device_code живёт между запуском авторизации и её подтверждением.
 * В браузер он не отдаётся: без client_secret он всё равно бесполезен,
 * но и светить его незачем.
 */
export async function setDeviceCode(code: string): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, seal(code), { ...COOKIE_OPTIONS, maxAge: 900 });
}

export async function getDeviceCode(): Promise<string | null> {
  const raw = (await cookies()).get(DEVICE_COOKIE)?.value;
  return raw ? unseal(raw) : null;
}

export async function clearDeviceCode(): Promise<void> {
  (await cookies()).delete(DEVICE_COOKIE);
}

/* ------------------------------------------------------------------ */
/* Куки для ответов-редиректов                                         */
/* ------------------------------------------------------------------ */

/**
 * Next.js не переносит правки из `cookies()` в ответ, созданный через
 * `NextResponse.redirect()` — заголовки такого ответа формируются отдельно.
 * Поэтому в OAuth-цепочке, где оба шага заканчиваются редиректом, куки
 * ставятся прямо на объект ответа.
 */
export function attachSpotifyTokens(response: NextResponse, tokens: SpotifyTokens): void {
  response.cookies.set(SPOTIFY_COOKIE, seal(JSON.stringify(tokens)), COOKIE_OPTIONS);
}

/** CSRF-защита OAuth-редиректа: state кладём в куку и сверяем на возврате. */
export function attachOauthState(response: NextResponse, state: string): void {
  response.cookies.set(STATE_COOKIE, state, { ...COOKIE_OPTIONS, maxAge: 600 });
}

export async function readOauthState(): Promise<string | null> {
  return (await cookies()).get(STATE_COOKIE)?.value ?? null;
}

/** state одноразовый — гасим его на любом исходе, успешном или нет. */
export function clearOauthState(response: NextResponse): void {
  response.cookies.set(STATE_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}
