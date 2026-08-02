import { NextResponse } from 'next/server';
import { NotConnectedError, requireSpotify } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Что есть в Spotify — для выбора перед переносом в обратную сторону. */
export async function GET() {
  try {
    const spotify = await requireSpotify();
    const me = await spotify.me();

    const [saved, playlists] = await Promise.all([spotify.getSavedTracks(), spotify.getPlaylists()]);

    return NextResponse.json({
      likedCount: saved.length,
      playlists: playlists
        .filter((p) => p.trackCount > 0)
        .sort((a, b) => b.trackCount - a.trackCount)
        .map((p) => ({ id: p.id, title: p.name, trackCount: p.trackCount, owner: me.displayName })),
    });
  } catch (error) {
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Не удалось прочитать библиотеку Spotify';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
