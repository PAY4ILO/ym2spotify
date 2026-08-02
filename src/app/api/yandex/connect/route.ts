import { NextResponse } from 'next/server';
import { setYandexToken } from '@/lib/session';
import { getAccount } from '@/lib/yandex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const raw = (body.token ?? '').trim();

  // Из devtools токен часто копируют вместе с префиксом заголовка.
  const token = raw.replace(/^OAuth\s+/i, '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Пустой токен' }, { status: 400 });
  }

  try {
    const account = await getAccount(token);
    await setYandexToken(token);
    return NextResponse.json({
      login: account.login,
      displayName: account.displayName,
      hasPlus: account.hasPlus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось проверить токен';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
