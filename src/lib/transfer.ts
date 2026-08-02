/** Общая для обоих направлений часть переноса: сопоставление и сводка. */

import { mapWithConcurrency, matchTrack, type MatchResult, type SearchFn, type TrackRef } from './match';
import { loadCache, rememberMatch } from './store';
import type { Emit } from './server';

/** Логическая пачка треков: лайки, один плейлист, история или волна. */
export type Group = {
  key: string;
  kind: 'likes' | 'playlist' | 'wave' | 'history';
  title: string;
  tracks: TrackRef[];
};

export type Resolved = {
  /** Идентификатор найденного трека в целевом сервисе, либо null. */
  target: TrackRef | null;
  result?: MatchResult;
};

export type Summary = {
  total: number;
  transferred: number;
  review: Array<{ id: string; source: string; candidates: Array<{ uri: string; label: string; score: number }> }>;
  missed: Array<{ id: string; source: string }>;
};

export function emptySummary(): Summary {
  return { total: 0, transferred: 0, review: [], missed: [] };
}

/** Один и тот же трек может лежать и в лайках, и в трёх плейлистах — ищем его один раз. */
export function dedupe(groups: Group[]): TrackRef[] {
  const map = new Map<string, TrackRef>();
  for (const group of groups) {
    for (const track of group.tracks) {
      if (!map.has(track.id)) map.set(track.id, track);
    }
  }
  return [...map.values()];
}

export async function matchAll(
  tracks: TrackRef[],
  options: {
    search: SearchFn;
    /** Префикс ключей кэша — разводит направления, чтобы идентификаторы не пересеклись. */
    prefix: string;
    fieldSyntax: boolean;
    retryMisses: boolean;
    concurrency?: number;
  },
  emit: Emit,
): Promise<Map<string, Resolved>> {
  const cache = await loadCache();
  const resolved = new Map<string, Resolved>();
  let done = 0;

  emit({ type: 'stage', stage: 'match', message: 'Ищу совпадения…', total: tracks.length });

  await mapWithConcurrency(tracks, options.concurrency ?? 3, async (track) => {
    const cacheKey = `${options.prefix}${track.id}`;
    const cached = cache.matches[cacheKey];

    // Ручные привязки и прошлые находки не переискиваем — это и время, и квота.
    const reusable = cached && (cached.manual || cached.uri !== null || !options.retryMisses);
    if (reusable) {
      resolved.set(track.id, {
        target: cached.uri ? { id: cached.uri, uri: cached.uri, title: '', artists: [], durationMs: 0 } : null,
      });
      done++;
      emit({
        type: 'progress',
        done,
        total: tracks.length,
        title: `${track.artists.join(', ')} — ${track.title}`,
        outcome: cached.uri ? 'cache' : 'miss',
      });
      return;
    }

    const result = await matchTrack(options.search, track, { fieldSyntax: options.fieldSyntax });
    const target = result.outcome === 'auto' ? (result.best?.track ?? null) : null;

    await rememberMatch(cacheKey, {
      // В кэше держим уже готовый идентификатор для целевого сервиса.
      uri: target ? (target.uri ?? target.id) : null,
      title: track.title,
      artists: track.artists,
      score: result.best?.score,
    });

    resolved.set(track.id, { target, result });
    done++;
    emit({
      type: 'progress',
      done,
      total: tracks.length,
      title: `${track.artists.join(', ')} — ${track.title}`,
      outcome: result.outcome,
      matched: result.best ? `${result.best.track.artists.join(', ')} — ${result.best.track.title}` : undefined,
    });
  });

  return resolved;
}

export function buildSummary(groups: Group[], matches: Map<string, Resolved>): Summary {
  const summary = emptySummary();
  const seen = new Set<string>();

  for (const group of groups) {
    for (const track of group.tracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);

      summary.total++;
      const resolved = matches.get(track.id);
      if (resolved?.target) {
        summary.transferred++;
        continue;
      }

      const source = `${track.artists.join(', ')} — ${track.title}`;
      const candidates = resolved?.result?.candidates ?? [];

      if (candidates.length > 0) {
        summary.review.push({
          id: track.id,
          source,
          candidates: candidates.map((c) => ({
            uri: c.track.uri ?? c.track.id,
            label: `${c.track.artists.join(', ')} — ${c.track.title}`,
            score: Math.round(c.score * 100),
          })),
        });
      } else {
        summary.missed.push({ id: track.id, source });
      }
    }
  }

  return summary;
}
