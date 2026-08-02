'use client';

import { useState } from 'react';
import { Badge, Button, Card, Notice } from './ui';
import type { Direction, Summary } from '@/lib/types';

type Found = { uri: string; label: string; album?: string };

/** Итоги переноса плюс ручной доподбор всего, что не уехало автоматически. */
export function ReviewTable({
  step,
  direction,
  summary,
}: {
  step: number;
  direction: Direction;
  summary: Summary;
}) {
  // Сомнительные варианты идут первыми: по ним есть что предложить одним кликом.
  const pending: Array<{ id: string; source: string; candidates: Array<{ uri: string; label: string; score: number }> }> =
    [...summary.review, ...summary.missed.map((item) => ({ ...item, candidates: [] }))];

  const targetName = direction === 'ym2sp' ? 'Spotify' : 'Яндекс';

  return (
    <Card step={step} title="Итог" done={pending.length === 0}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Stat label="Всего треков" value={summary.total} />
          <Stat label="Перенесено" value={summary.transferred} tone="ok" />
          <Stat label="Требуют внимания" value={pending.length} tone={pending.length > 0 ? 'warn' : 'mute'} />
        </div>

        {pending.length === 0 ? (
          <Notice tone="info">Всё уехало без потерь.</Notice>
        ) : (
          <>
            <p className="text-sm text-muted">
              Эти треки {targetName} либо не знает, либо нашёл слишком непохожее. Найди вручную — привязка запомнится, и
              при следующем запуске трек встанет и в свои плейлисты.
            </p>
            <ul className="thin-scroll max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {pending.map((item) => (
                <ReviewRow
                  key={item.id}
                  id={item.id}
                  direction={direction}
                  source={item.source}
                  candidates={item.candidates}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value, tone = 'mute' }: { label: string; value: number; tone?: 'ok' | 'warn' | 'mute' }) {
  const color = { ok: 'text-spotify', warn: 'text-yandex', mute: 'text-white' }[tone];
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function ReviewRow({
  id,
  direction,
  source,
  candidates,
}: {
  id: string;
  direction: Direction;
  source: string;
  candidates: Array<{ uri: string; label: string; score: number }>;
}) {
  const [query, setQuery] = useState(source.replace(' — ', ' '));
  const [results, setResults] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [bound, setBound] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/resolve?q=${encodeURIComponent(query)}&direction=${direction}`);
      const json = (await res.json()) as { tracks?: Found[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Поиск не удался');
      setResults(json.tracks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска');
    } finally {
      setBusy(false);
    }
  }

  async function bind(uri: string, label: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, uri, direction }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Не удалось привязать');
      setBound(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-edge bg-panel-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">{source}</span>
        {bound && <Badge tone="ok">привязан</Badge>}
      </div>

      {bound ? (
        <p className="mt-1 text-sm text-muted">→ {bound} · добавлен в медиатеку</p>
      ) : (
        <div className="mt-2 space-y-2">
          {candidates.length > 0 && (
            <div className="space-y-1">
              {candidates.map((candidate) => (
                <button
                  key={candidate.uri}
                  type="button"
                  disabled={busy}
                  onClick={() => bind(candidate.uri, candidate.label)}
                  className="flex w-full items-center gap-2 rounded-md border border-edge px-2 py-1.5 text-left text-sm transition-colors hover:border-spotify/60 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{candidate.score}%</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') search();
              }}
              aria-label={`Поиск в Spotify для «${source}»`}
              className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-2 py-1.5 text-sm outline-none focus:border-spotify/60"
            />
            <Button variant="ghost" onClick={search} disabled={busy}>
              {busy ? '…' : 'Искать'}
            </Button>
          </div>

          {results && results.length === 0 && <p className="text-sm text-muted">Spotify ничего не нашёл.</p>}

          {results && results.length > 0 && (
            <div className="space-y-1">
              {results.map((track) => (
                <button
                  key={track.uri}
                  type="button"
                  disabled={busy}
                  onClick={() => bind(track.uri, track.label)}
                  className="flex w-full items-center gap-2 rounded-md border border-edge px-2 py-1.5 text-left text-sm transition-colors hover:border-spotify/60 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">{track.label}</span>
                  {track.album && <span className="shrink-0 truncate text-xs text-muted">{track.album}</span>}
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
      )}
    </li>
  );
}
