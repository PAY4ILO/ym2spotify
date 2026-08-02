'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Notice } from './ui';
import type { Status } from '@/lib/types';

export function SpotifyStep({ step, status }: { step: number; status: Status }) {
  const connected = Boolean(status.spotify);

  return (
    <Card
      step={step}
      title="Войти в Spotify"
      subtitle="Пароль вводится только на стороне Spotify"
      done={connected}
      disabled={!status.configured}
    >
      {connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="ok">Подключено</Badge>
          <span className="text-sm">{status.spotify!.displayName}</span>
          {status.spotify!.product && status.spotify!.product !== 'premium' && (
            <Badge tone="warn">тариф: {status.spotify!.product}</Badge>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {status.spotifyError && <Notice tone="err">{status.spotifyError}</Notice>}
          <a
            href="/api/auth/spotify/login"
            className={`inline-flex items-center justify-center rounded-lg bg-spotify px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-spotify/85 ${
              status.configured ? '' : 'pointer-events-none opacity-40'
            }`}
          >
            Войти через Spotify
          </a>
          {!status.configured && <p className="text-sm text-muted">Сначала заполни ключи на первом шаге.</p>}
        </div>
      )}
    </Card>
  );
}

type Device = { userCode: string; verificationUrl: string; interval: number; deadline: number };

function formatLeft(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function YandexStep({
  step,
  status,
  onConnected,
}: {
  step: number;
  status: Status;
  onConnected: () => void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [device, setDevice] = useState<Device | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  const connected = Boolean(status.yandex);

  async function startDeviceAuth() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/yandex/device', { method: 'POST' });
      const json = (await res.json()) as {
        userCode?: string;
        verificationUrl?: string;
        interval?: number;
        expiresIn?: number;
        error?: string;
      };
      if (!res.ok || !json.userCode) throw new Error(json.error ?? 'Не удалось получить код');

      setDevice({
        userCode: json.userCode,
        verificationUrl: json.verificationUrl ?? 'https://ya.ru/device',
        interval: json.interval ?? 5,
        deadline: Date.now() + (json.expiresIn ?? 300) * 1000,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать авторизацию');
    } finally {
      setBusy(false);
    }
  }

  // Пока код не подтверждён, спрашиваем Яндекс с рекомендованным им интервалом.
  useEffect(() => {
    if (!device) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/yandex/device');
        const json = (await res.json()) as { pending?: boolean; error?: string };
        if (cancelled) return;

        if (!res.ok) {
          setError(json.error ?? 'Авторизация не удалась');
          setDevice(null);
          return;
        }
        if (!json.pending) {
          setDevice(null);
          onConnected();
        }
      } catch {
        // Сеть моргнула — просто дождёмся следующей попытки.
      }
    }

    const pollTimer = setInterval(poll, device.interval * 1000);
    const tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((device.deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setDevice(null);
        setError('Код истёк. Нажми «Войти через Яндекс» ещё раз.');
      }
    }, 1000);

    setSecondsLeft(Math.max(0, Math.ceil((device.deadline - Date.now()) / 1000)));

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(tick);
    };
  }, [device, onConnected]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/yandex/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Токен не принят');
      setToken('');
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключиться');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      step={step}
      title="Войти в Яндекс.Музыку"
      subtitle="Вход по коду — пароль вводится только на странице Яндекса"
      done={connected}
    >
      {connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="ok">Подключено</Badge>
          <span className="text-sm">{status.yandex!.displayName ?? status.yandex!.login}</span>
          {status.yandex!.hasPlus ? <Badge tone="warn">Плюс</Badge> : <Badge tone="mute">без Плюса</Badge>}
        </div>
      ) : device ? (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pr-4 pl-5 text-sm text-muted">
            <li>
              Открой{' '}
              <a
                href={device.verificationUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-yandex underline underline-offset-2"
              >
                {device.verificationUrl.replace(/^https?:\/\//, '')}
              </a>
            </li>
            <li>Введи этот код и подтверди вход.</li>
          </ol>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-yandex/30 bg-yandex/5 px-4 py-3">
            <span className="font-mono text-3xl font-semibold tracking-[0.2em] text-yandex tabular-nums">
              {device.userCode}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(device.userCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Скопирован' : 'Копировать'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span className="inline-flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-spotify" aria-hidden />
              Жду подтверждения…
            </span>
            <span className="tabular-nums">код действует ещё {formatLeft(secondsLeft)}</span>
          </div>

          <Button
            variant="ghost"
            onClick={() => {
              setDevice(null);
              setError(null);
            }}
          >
            Отмена
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button onClick={startDeviceAuth} disabled={busy}>
            {busy ? 'Получаю код…' : 'Войти через Яндекс'}
          </Button>

          {status.yandexError && <Notice tone="err">{status.yandexError}</Notice>}
          {error && <Notice tone="err">{error}</Notice>}

          <Notice tone="info">
            Пароль вводится только на сайте Яндекса. Приложение получит токен и положит его в зашифрованную
            httpOnly-куку — с этого компьютера он никуда не уходит, кроме самих запросов к Яндексу.
          </Notice>

          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-sm text-muted underline underline-offset-2 hover:text-white"
          >
            {showHelp ? 'Скрыть' : 'Вставить токен вручную'}
          </button>

          {showHelp && (
            <div className="space-y-3 rounded-lg border border-edge bg-panel-2 px-3 py-3">
              <p className="text-sm text-muted">
                Запасной путь, если вход по коду не сработал. Токен берётся из{' '}
                <span className="text-white">music.yandex.ru</span> → <span className="text-white">F12</span> →{' '}
                <span className="text-white">Network</span> → любой запрос к{' '}
                <span className="font-mono text-white">api.music.yandex.net</span> →{' '}
                <span className="text-white">Request Headers</span> → строка{' '}
                <span className="font-mono text-white">Authorization: OAuth …</span>
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && token.trim() && !busy) submit();
                  }}
                  placeholder="y0__xD…"
                  aria-label="OAuth-токен Яндекс.Музыки"
                  className="min-w-0 flex-1 rounded-lg border border-edge bg-panel px-3 py-2 font-mono text-sm outline-none placeholder:text-muted/60 focus:border-yandex/60"
                />
                <Button variant="ghost" onClick={submit} disabled={busy || !token.trim()}>
                  {busy ? 'Проверяю…' : 'Подключить'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
