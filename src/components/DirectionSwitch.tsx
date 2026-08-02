'use client';

import type { Direction } from '@/lib/types';

const OPTIONS: Array<{ value: Direction; from: string; to: string }> = [
  { value: 'ym2sp', from: 'Яндекс.Музыка', to: 'Spotify' },
  { value: 'sp2ym', from: 'Spotify', to: 'Яндекс.Музыка' },
];

export function DirectionSwitch({
  value,
  onChange,
  disabled,
}: {
  value: Direction;
  onChange: (next: Direction) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label="Направление переноса">
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? 'border-spotify bg-spotify/10' : 'border-edge bg-panel hover:border-muted'
            }`}
          >
            <span className="block text-sm font-semibold">
              {option.from} <span className={active ? 'text-spotify' : 'text-muted'}>→</span> {option.to}
            </span>
          </button>
        );
      })}
    </div>
  );
}
