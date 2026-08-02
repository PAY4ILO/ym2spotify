import { NextResponse } from 'next/server';
import { clearDeviceCode, getDeviceCode, setDeviceCode, setYandexToken } from '@/lib/session';
import { DeviceAuthError, pollDeviceToken, requestDeviceCode } from '@/lib/yandexAuth';
import { getAccount } from '@/lib/yandex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Старт авторизации: получаем короткий код, который пользователь введёт у Яндекса. */
export async function POST() {
  try {
    const code = await requestDeviceCode();
    await setDeviceCode(code.deviceCode);

    // device_code наружу не отдаём — клиенту нужен только код для ввода.
    return NextResponse.json({
      userCode: code.userCode,
      verificationUrl: code.verificationUrl,
      interval: code.interval,
      expiresIn: code.expiresIn,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось начать авторизацию';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Опрос: подтвердил ли пользователь вход. */
export async function GET() {
  const deviceCode = await getDeviceCode();
  if (!deviceCode) {
    return NextResponse.json({ error: 'Авторизация не запущена или код истёк' }, { status: 400 });
  }

  try {
    const token = await pollDeviceToken(deviceCode);
    if (token === null) {
      return NextResponse.json({ pending: true });
    }

    // Токен получен — сразу проверяем, что им действительно можно читать музыку.
    const account = await getAccount(token);
    await setYandexToken(token);
    await clearDeviceCode();

    return NextResponse.json({
      pending: false,
      login: account.login,
      displayName: account.displayName,
      hasPlus: account.hasPlus,
    });
  } catch (error) {
    await clearDeviceCode();
    const message = error instanceof Error ? error.message : 'Авторизация не удалась';
    return NextResponse.json({ error: message }, { status: error instanceof DeviceAuthError ? 400 : 502 });
  }
}
