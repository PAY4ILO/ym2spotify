import { NextResponse } from 'next/server';
import { credentialsFromEnv, saveSpotifyCredentials } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Сохранение ключей Spotify из формы — без правки файлов и без перезапуска. */
export async function POST(request: Request) {
  if (credentialsFromEnv()) {
    return NextResponse.json(
      { error: 'Ключи заданы через переменные окружения — правь их там же' },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string };
  const clientId = (body.clientId ?? '').trim();
  const clientSecret = (body.clientSecret ?? '').trim();

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Нужны и Client ID, и Client Secret' }, { status: 400 });
  }

  // Идентификатор Spotify — 32 шестнадцатеричных символа. Проверка ловит
  // самую частую ошибку: перепутанные местами или обрезанные при копировании поля.
  if (!/^[0-9a-f]{32}$/i.test(clientId)) {
    return NextResponse.json(
      { error: 'Client ID должен быть строкой из 32 символов (цифры и буквы a–f). Похоже, скопировалось не то поле.' },
      { status: 400 },
    );
  }

  saveSpotifyCredentials(clientId, clientSecret);
  return NextResponse.json({ ok: true });
}
