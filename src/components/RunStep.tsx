'use client';

import { useEffect, useRef } from 'react';
import { Badge, Card, Notice, Progress } from './ui';

export type LogLine = { id: number; text: string; outcome?: string };

const OUTCOME_LABEL: Record<string, { tone: 'ok' | 'warn' | 'err' | 'mute'; text: string }> = {
  auto: { tone: 'ok', text: 'найден' },
  cache: { tone: 'mute', text: 'из кэша' },
  review: { tone: 'warn', text: 'сомнительно' },
  miss: { tone: 'err', text: 'не найден' },
};

export function RunStep({
  step,
  active,
  stage,
  progress,
  log,
  error,
}: {
  step: number;
  active: boolean;
  stage: string | null;
  progress: { done: number; total: number } | null;
  log: LogLine[];
  error: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Журнал длинный, интересен всегда хвост — подматываем к нему.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  if (!active && log.length === 0 && !error) return null;

  return (
    <Card step={step} title="Перенос" subtitle={stage ?? undefined} done={!active && !error && log.length > 0}>
      <div className="space-y-4">
        {error && <Notice tone="err">{error}</Notice>}

        {progress && progress.total > 0 && <Progress done={progress.done} total={progress.total} />}

        {log.length > 0 && (
          <div className="thin-scroll max-h-72 overflow-y-auto rounded-lg border border-edge bg-panel-2 p-3">
            <ul className="space-y-1 text-sm">
              {log.map((line) => {
                const badge = line.outcome ? OUTCOME_LABEL[line.outcome] : undefined;
                return (
                  <li key={line.id} className="flex items-start gap-2">
                    {badge && (
                      <span className="shrink-0">
                        <Badge tone={badge.tone}>{badge.text}</Badge>
                      </span>
                    )}
                    <span className={badge ? 'min-w-0 text-muted' : 'min-w-0 text-white'}>{line.text}</span>
                  </li>
                );
              })}
            </ul>
            <div ref={endRef} />
          </div>
        )}
      </div>
    </Card>
  );
}
