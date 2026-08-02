'use client';

const DONATE_URL = 'https://www.donationalerts.com/r/pay40k_';

/** Просьба о донате. Ничего не блокирует и не считает — просто ссылка. */
export function DonateBanner() {
  return (
    <aside className="rounded-2xl border border-yandex/25 bg-yandex/5 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Приложение бесплатное и без рекламы</h2>
          <p className="mt-0.5 text-sm text-muted">
            Если перенос сэкономил тебе вечер — можно закинуть автору на кофе. Совершенно необязательно.
          </p>
        </div>
        <a
          href={DONATE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex shrink-0 items-center rounded-lg bg-yandex px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-yandex/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yandex"
        >
          Поддержать
        </a>
      </div>
    </aside>
  );
}
