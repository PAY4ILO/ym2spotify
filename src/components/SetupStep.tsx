'use client';

import { useState } from 'react';
import { Badge, Button, Card, Notice } from './ui';
import type { Status } from '@/lib/types';

/**
 * Ввод ключей приложения Spotify.
 *
 * Своё приложение нужно каждому: Spotify с мая 2025 выдаёт публичный доступ
 * только организациям с четвертью миллиона пользователей, а в обычном режиме
 * одно приложение обслуживает не больше пяти человек. Поэтому ключи здесь —
 * не «настройка для продвинутых», а обязательный первый шаг.
 */
export function SetupStep({ status, onSaved }: { status: Status; onSaved: () => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Не удалось сохранить');
      setClientId('');
      setClientSecret('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  function copyRedirect() {
    void navigator.clipboard?.writeText(status.redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status.configured) {
    return (
      <Card step={1} title="Ключи Spotify" done>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="ok">Заданы</Badge>
          {status.envManaged ? (
            <span className="text-sm text-muted">из переменных окружения</span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-sm text-muted underline underline-offset-2 hover:text-white"
            >
              {expanded ? 'Скрыть' : 'Заменить'}
            </button>
          )}
        </div>

        {expanded && !status.envManaged && (
          <div className="mt-3">
            <CredentialsForm
              clientId={clientId}
              clientSecret={clientSecret}
              setClientId={setClientId}
              setClientSecret={setClientSecret}
              onSave={save}
              busy={busy}
              error={error}
            />
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card step={1} title="Создать приложение Spotify" subtitle="Разовая настройка, минут пять">
      <div className="space-y-4">
        <Notice tone="warn">
          Нужен активный <b>Spotify Premium</b> — с февраля 2026 без подписки кабинет разработчика ключи не выдаёт.
        </Notice>

        <ol className="list-decimal space-y-2.5 pr-2 pl-5 text-sm text-muted">
          <li>
            Открой{' '}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-spotify underline underline-offset-2"
            >
              developer.spotify.com/dashboard
            </a>{' '}
            и нажми <span className="text-white">Create app</span>.
          </li>
          <li>
            Название и описание — любые. Поставь галочку <span className="text-white">Web API</span>.
          </li>
          <li>
            В поле <span className="text-white">Redirect URI</span> вставь ровно это:
            <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-panel-2 px-3 py-2">
              <code className="min-w-0 flex-1 font-mono text-xs break-all text-white">{status.redirectUri}</code>
              <Button variant="ghost" onClick={copyRedirect}>
                {copied ? 'Скопирован' : 'Копировать'}
              </Button>
            </div>
            <span className="mt-1 block text-xs">
              Именно <span className="font-mono">127.0.0.1</span>, а не <span className="font-mono">localhost</span> —
              Spotify его не принимает.
            </span>
          </li>
          <li>
            Сохрани, затем открой <span className="text-white">Settings → User Management</span> и добавь свой аккаунт
            (email и имя, как в профиле Spotify). Без этого API ответит отказом.
          </li>
          <li>
            Вернись на страницу приложения, нажми <span className="text-white">View client secret</span> и скопируй оба
            значения сюда.
          </li>
        </ol>

        <CredentialsForm
          clientId={clientId}
          clientSecret={clientSecret}
          setClientId={setClientId}
          setClientSecret={setClientSecret}
          onSave={save}
          busy={busy}
          error={error}
        />
      </div>
    </Card>
  );
}

function CredentialsForm({
  clientId,
  clientSecret,
  setClientId,
  setClientSecret,
  onSave,
  busy,
  error,
}: {
  clientId: string;
  clientSecret: string;
  setClientId: (v: string) => void;
  setClientSecret: (v: string) => void;
  onSave: () => void;
  busy: boolean;
  error: string | null;
}) {
  const ready = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  return (
    <div className="space-y-2">
      <input
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="Client ID"
        aria-label="Client ID приложения Spotify"
        className="w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted/60 focus:border-spotify/60"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready && !busy) onSave();
          }}
          placeholder="Client Secret"
          aria-label="Client Secret приложения Spotify"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-panel-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted/60 focus:border-spotify/60"
        />
        <Button onClick={onSave} disabled={busy || !ready}>
          {busy ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </div>
      {error && <Notice tone="err">{error}</Notice>}
    </div>
  );
}
