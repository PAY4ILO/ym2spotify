'use client';

import { useCallback, useEffect, useState } from 'react';
import { SetupStep } from '@/components/SetupStep';
import { SpotifyStep, YandexStep } from '@/components/ConnectStep';
import { DirectionSwitch } from '@/components/DirectionSwitch';
import { SelectStep, type Selection } from '@/components/SelectStep';
import { RunStep, type LogLine } from '@/components/RunStep';
import { ReviewTable } from '@/components/ReviewTable';
import { DonateBanner } from '@/components/DonateBanner';
import { Button, Notice } from '@/components/ui';
import type { Direction, Library, Status, Summary, TransferEvent } from '@/lib/types';

/** Расшифровка кодов, с которыми OAuth-колбэк возвращает на главную. */
function describeAuthError(code: string): string {
  const known: Record<string, string> = {
    state_mismatch:
      'Проверка безопасности не прошла: браузер не вернул метку, выданную перед переходом в Spotify. Попробуй войти ещё раз.',
    no_client: 'Ключи Spotify не заданы — заполни их на первом шаге.',
    access_denied: 'Доступ отклонён на стороне Spotify.',
    invalid_client: 'Spotify не признал ключи приложения — проверь Client ID и Client Secret.',
  };
  return known[code] ?? `Spotify вернул ошибку: ${code}`;
}

const DEFAULT_SELECTION: Selection = {
  likes: true,
  playlists: [],
  // История по умолчанию, ротор — нет: она точнее отражает вкусы.
  historySize: 200,
  waveSize: 0,
  retryMisses: false,
};

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [direction, setDirection] = useState<Direction>('ym2sp');

  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [authNotice, setAuthNotice] = useState<{ tone: 'err' | 'info'; text: string } | null>(null);

  const refreshStatus = useCallback(async () => {
    const res = await fetch('/api/status');
    setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Итог OAuth-редиректа приезжает в query. Показываем его и подчищаем адрес,
  // иначе сообщение залипает при каждой перезагрузке страницы.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const connected = params.get('connected');
    if (!error && !connected) return;

    setAuthNotice(
      error ? { tone: 'err', text: describeAuthError(error) } : { tone: 'info', text: 'Spotify подключён.' },
    );
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const ready = Boolean(status?.spotify && status?.yandex);

  // Библиотека своя у каждого направления — при переключении перечитываем.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    setLibrary(null);
    setLibraryLoading(true);
    setLibraryError(null);
    setSelection({ ...DEFAULT_SELECTION });

    const url = direction === 'ym2sp' ? '/api/yandex/library' : '/api/spotify/library';
    fetch(url)
      .then(async (res) => {
        const json = (await res.json()) as Library & { error?: string };
        if (!res.ok) throw new Error(json.error ?? 'Не удалось прочитать библиотеку');
        if (!cancelled) setLibrary(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLibraryError(e instanceof Error ? e.message : 'Ошибка');
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, direction]);

  async function start() {
    setRunning(true);
    setRunError(null);
    setSummary(null);
    setLog([]);
    setProgress(null);
    setStage('Запускаю…');

    let lineId = 0;
    const append = (text: string, outcome?: string) => {
      setLog((prev) => {
        const next = [...prev, { id: lineId++, text, outcome }];
        // Держим журнал коротким: на нескольких тысячах строк DOM начинает тормозить.
        return next.length > 400 ? next.slice(-400) : next;
      });
    };

    try {
      const endpoint = direction === 'ym2sp' ? '/api/transfer' : '/api/transfer/to-yandex';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection),
      });

      if (!res.ok) {
        // Отказ до старта потока приходит обычным JSON.
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Сервер ответил ${res.status}`);
      }
      if (!res.body) throw new Error('Сервер не отдал поток');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Ответ приходит построчным JSON — разбираем его по мере поступления.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as TransferEvent;

          if (event.type === 'stage') {
            setStage(event.message);
            append(event.message);
          } else if (event.type === 'progress') {
            setProgress({ done: event.done, total: event.total });
            append(event.matched ? `${event.title} → ${event.matched}` : event.title, event.outcome);
          } else if (event.type === 'done') {
            setSummary(event.summary);
            setStage('Готово');
          } else if (event.type === 'error') {
            setRunError(event.message);
            setStage(null);
          }
        }
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Перенос прервался');
    } finally {
      setRunning(false);
    }
  }

  async function disconnect() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setLibrary(null);
    setSummary(null);
    setLog([]);
    await refreshStatus();
  }

  async function resetCache() {
    await fetch('/api/cache', { method: 'DELETE' });
    setSummary(null);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Перенос музыки</h1>
        <p className="mt-2 text-sm text-muted">
          Лайки, плейлисты и история между Яндекс.Музыкой и Spotify. Работает целиком на этом компьютере — токены
          никуда не отправляются.
        </p>
      </header>

      {status === null ? (
        <p className="text-sm text-muted">Загружаю…</p>
      ) : (
        <div className="space-y-4">
          {authNotice && <Notice tone={authNotice.tone}>{authNotice.text}</Notice>}

          <SetupStep status={status} onSaved={refreshStatus} />
          <SpotifyStep step={2} status={status} />
          <YandexStep step={3} status={status} onConnected={refreshStatus} />

          {ready && (
            <section className="rounded-2xl border border-edge bg-panel/80 px-5 py-4">
              <h2 className="mb-3 text-sm font-semibold">Направление</h2>
              <DirectionSwitch value={direction} onChange={setDirection} disabled={running} />
            </section>
          )}

          <SelectStep
            step={4}
            direction={direction}
            library={library}
            loading={libraryLoading}
            error={libraryError}
            selection={selection}
            onChange={setSelection}
            onStart={start}
            running={running}
            ready={ready}
          />

          <RunStep step={5} active={running} stage={stage} progress={progress} log={log} error={runError} />
          {summary && <ReviewTable step={6} direction={direction} summary={summary} />}

          <DonateBanner />

          {(status.spotify || status.yandex) && (
            <footer className="flex flex-wrap gap-3 pt-2">
              <Button variant="ghost" onClick={disconnect}>
                Отключить аккаунты
              </Button>
              <Button variant="danger" onClick={resetCache}>
                Очистить кэш сопоставлений
              </Button>
            </footer>
          )}
        </div>
      )}
    </main>
  );
}
