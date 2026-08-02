'use client';

import { Button, Card, Notice } from './ui';
import type { Direction, Library } from '@/lib/types';

export type Selection = {
  likes: boolean;
  playlists: string[];
  historySize: number;
  waveSize: number;
  retryMisses: boolean;
};

const SIZE_OPTIONS = [0, 50, 100, 200, 300];

function SizePicker({
  value,
  onChange,
  options = SIZE_OPTIONS,
  label,
}: {
  value: number;
  onChange: (size: number) => void;
  options?: number[];
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((size) => (
        <button
          key={size}
          type="button"
          aria-pressed={value === size}
          onClick={() => onChange(size)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            value === size
              ? 'border-spotify bg-spotify/15 text-spotify'
              : 'border-edge bg-panel-2 text-muted hover:text-white'
          }`}
        >
          {size === 0 ? 'не нужно' : `${size} треков`}
        </button>
      ))}
    </div>
  );
}

export function SelectStep({
  step,
  direction,
  library,
  loading,
  error,
  selection,
  onChange,
  onStart,
  running,
  ready,
}: {
  step: number;
  direction: Direction;
  library: Library | null;
  loading: boolean;
  error: string | null;
  selection: Selection;
  onChange: (next: Selection) => void;
  onStart: () => void;
  running: boolean;
  ready: boolean;
}) {
  // История и ротор — механики Яндекса, у Spotify аналогов в API не осталось.
  const personalSources = direction === 'ym2sp';

  function togglePlaylist(id: string) {
    const next = selection.playlists.includes(id)
      ? selection.playlists.filter((k) => k !== id)
      : [...selection.playlists, id];
    onChange({ ...selection, playlists: next });
  }

  const nothingSelected =
    !selection.likes &&
    selection.playlists.length === 0 &&
    (!personalSources || (selection.waveSize === 0 && selection.historySize === 0));

  return (
    <Card step={step} title="Что переносим" subtitle="Треки ищутся по названию и исполнителю" disabled={!ready}>
      {!ready && <p className="text-sm text-muted">Сначала подключи оба сервиса.</p>}

      {ready && loading && <p className="text-sm text-muted">Читаю библиотеку…</p>}
      {ready && error && <Notice tone="err">{error}</Notice>}

      {ready && library && (
        <div className="space-y-5">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-edge bg-panel-2 px-3 py-2.5">
            <input
              type="checkbox"
              checked={selection.likes}
              onChange={(e) => onChange({ ...selection, likes: e.target.checked })}
              className="size-4 accent-[#1db954]"
            />
            <span className="flex-1 text-sm font-medium">Мне нравится</span>
            <span className="text-sm text-muted tabular-nums">{library.likedCount}</span>
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">Плейлисты</h3>
              {library.playlists.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...selection,
                      playlists:
                        selection.playlists.length === library.playlists.length
                          ? []
                          : library.playlists.map((p) => p.id),
                    })
                  }
                  className="text-xs text-muted underline underline-offset-2 hover:text-white"
                >
                  {selection.playlists.length === library.playlists.length ? 'снять все' : 'выбрать все'}
                </button>
              )}
            </div>

            {library.playlists.length === 0 ? (
              <p className="text-sm text-muted">Плейлистов с треками не нашлось.</p>
            ) : (
              <div className="thin-scroll max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {library.playlists.map((playlist) => (
                  <label
                    key={playlist.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-edge bg-panel-2 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={selection.playlists.includes(playlist.id)}
                      onChange={() => togglePlaylist(playlist.id)}
                      className="size-4 accent-[#1db954]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{playlist.title}</span>
                    <span className="text-sm text-muted tabular-nums">{playlist.trackCount}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {personalSources && (
            <div className="space-y-4 border-t border-edge pt-4">
              <p className="text-sm text-muted">
                Spotify закрыл свой эндпоинт рекомендаций в феврале 2026, поэтому «что-то похожее» берётся со стороны
                Яндекса. Оба плейлиста ниже обновляются на месте — повторный запуск не плодит копии.
              </p>

              <div>
                <h3 className="mb-1 text-sm font-medium">
                  Что я слушал <span className="font-normal text-muted">— история прослушиваний</span>
                </h3>
                <p className="mb-2 text-sm text-muted">
                  Самый честный слепок вкусов: берётся реальная история, треки сортируются по числу прослушиваний.
                </p>
                <SizePicker
                  label="Сколько треков взять из истории"
                  value={selection.historySize}
                  onChange={(historySize) => onChange({ ...selection, historySize })}
                />
              </div>

              <div>
                <h3 className="mb-1 text-sm font-medium">
                  «Моя волна» <span className="font-normal text-muted">— ротор Яндекса</span>
                </h3>
                <p className="mb-2 text-sm text-muted">
                  Живой поток станции. Даёт новое, а не только знакомое, но это снимок случайного отрезка волны.
                </p>
                <SizePicker
                  label="Сколько треков собрать из волны"
                  value={selection.waveSize}
                  onChange={(waveSize) => onChange({ ...selection, waveSize })}
                  options={[0, 50, 100, 200]}
                />
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-3 text-sm text-muted">
            <input
              type="checkbox"
              checked={selection.retryMisses}
              onChange={(e) => onChange({ ...selection, retryMisses: e.target.checked })}
              className="size-4 accent-[#1db954]"
            />
            Перепроверить треки, которые не нашлись в прошлый раз
          </label>

          <div className="flex items-center gap-3 border-t border-edge pt-4">
            <Button onClick={onStart} disabled={running || nothingSelected}>
              {running ? 'Переношу…' : 'Перенести'}
            </Button>
            {nothingSelected && <span className="text-sm text-muted">Выбери хотя бы что-нибудь</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
