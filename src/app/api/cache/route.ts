import { NextResponse } from 'next/server';
import { forgetAll } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Сброс кэша сопоставлений — включая ручные привязки. */
export async function DELETE() {
  await forgetAll();
  return NextResponse.json({ ok: true });
}
