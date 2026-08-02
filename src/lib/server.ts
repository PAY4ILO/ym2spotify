/** Общая обвязка для роутов: достать сессию, собрать клиентов, отдать поток. */

import { SpotifyClient } from './spotify';
import { getSpotifyTokens, getYandexToken, setSpotifyTokens } from './session';

export class NotConnectedError extends Error {}

export async function requireSpotify(): Promise<SpotifyClient> {
  const tokens = await getSpotifyTokens();
  if (!tokens) throw new NotConnectedError('Spotify не подключён');

  return new SpotifyClient(tokens, (fresh) => {
    // В стриминговых ответах заголовки уже отправлены и куку переписать нельзя.
    // Это не страшно: refresh-токен остаётся прежним, и следующий запрос обновится сам.
    void setSpotifyTokens(fresh).catch(() => {});
  });
}

export async function requireYandex(): Promise<string> {
  const token = await getYandexToken();
  if (!token) throw new NotConnectedError('Токен Яндекс.Музыки не задан');
  return token;
}

export type Emit = (event: Record<string, unknown>) => void;

/**
 * Поток построчного JSON (NDJSON).
 *
 * EventSource умеет только GET, а перенос запускается POST-ом с параметрами,
 * поэтому отдаём построчный JSON и читаем его на клиенте обычным fetch.
 */
export function ndjson(run: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit: Emit = (event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        await run(emit);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        emit({ type: 'error', message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
