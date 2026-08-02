/**
 * OAuth Device Flow Яндекса — получение токена без копания в devtools.
 *
 * Схема стандартная: приложение просит у Яндекса короткий код, пользователь
 * вводит его на странице Яндекса и подтверждает вход своим логином, после чего
 * приложение забирает токен. Пароль при этом вводится только на стороне Яндекса.
 *
 * client_id/secret — публичные креды официального Android-клиента Яндекс.Музыки.
 * Свой client_id тут не подойдёт: токен должен иметь доступ именно к музыке.
 */

const OAUTH = 'https://oauth.yandex.ru';
const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
const CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300';
const DEVICE_NAME = 'ym2spotify';

export class DeviceAuthError extends Error {}

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Рекомендованный сервером интервал опроса, секунды. */
  interval: number;
  /** Сколько секунд код остаётся действительным. */
  expiresIn: number;
};

/** Ответы OAuth-ручек Яндекса: успех и ошибка приходят одной и той же формой. */
type OauthPayload = {
  device_code?: string;
  user_code?: string;
  verification_url?: string;
  interval?: number | string;
  expires_in?: number | string;
  access_token?: string;
  error?: string;
  error_description?: string;
};

async function form(path: string, data: Record<string, string>): Promise<{ status: number; json: OauthPayload }> {
  const res = await fetch(OAUTH + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString(),
    cache: 'no-store',
  });

  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as OauthPayload };
  } catch {
    throw new DeviceAuthError(`Яндекс вернул не-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Случайный идентификатор устройства — Яндекс требует его при запросе кода. */
function randomDeviceId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const { status, json } = await form('/device/code', {
    client_id: CLIENT_ID,
    device_id: randomDeviceId(),
    device_name: DEVICE_NAME,
  });

  // Без user_code показывать пользователю нечего, так что он тоже обязателен.
  if (status !== 200 || !json?.device_code || !json?.user_code) {
    const reason = json?.error_description ?? json?.error ?? `код ${status}`;
    throw new DeviceAuthError(`Не удалось запросить код у Яндекса: ${reason}`);
  }

  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    // Обычно https://ya.ru/device, но полагаться на это не стоит — берём из ответа.
    verificationUrl: json.verification_url ?? 'https://ya.ru/device',
    interval: Number(json.interval) || 5,
    expiresIn: Number(json.expires_in) || 300,
  };
}

/** `null` означает «пользователь ещё не подтвердил» — это не ошибка, а ожидание. */
export async function pollDeviceToken(deviceCode: string): Promise<string | null> {
  const { status, json } = await form('/token', {
    grant_type: 'device_code',
    code: deviceCode,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  if (status === 200 && json?.access_token) {
    return json.access_token as string;
  }

  const error = json?.error as string | undefined;

  if (error === 'authorization_pending') return null;

  const messages: Record<string, string> = {
    expired_token: 'Код истёк — запусти авторизацию заново.',
    access_denied: 'Вход отклонён на стороне Яндекса.',
    invalid_grant: 'Код больше не действителен — запусти авторизацию заново.',
  };

  throw new DeviceAuthError(
    messages[error ?? ''] ?? `Яндекс отказал: ${json?.error_description ?? error ?? `код ${status}`}`,
  );
}
