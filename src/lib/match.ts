/**
 * Сопоставление трека одного сервиса с треком другого.
 *
 * Логика намеренно не знает, кто источник, а кто приёмник: обе стороны
 * приводятся к `TrackRef`, а поиск передаётся функцией. Благодаря этому
 * перенос в обе стороны считается одним и тем же кодом.
 */

import { hasCyrillic, normalize, similarity, transliterate } from './text';

/** Трек в общем виде — то, чем оперируют скоринг и матчинг. */
export type TrackRef = {
  /** Идентификатор в своём сервисе. */
  id: string;
  title: string;
  /** Подзаголовок Яндекса («feat. X», «Remastered») — он держит его отдельно от названия. */
  version?: string;
  artists: string[];
  album?: string;
  /** Идентификатор альбома. Нужен Яндексу: без него трек не вставить в плейлист. */
  albumId?: string;
  durationMs: number;
  /** URI трека в Spotify. */
  uri?: string;
  /** Обложка — нужна только для таблицы ручного доподбора. */
  image?: string;
};

export type MatchOutcome = 'auto' | 'review' | 'miss';

export type Candidate = { track: TrackRef; score: number };

export type MatchResult = {
  source: TrackRef;
  outcome: MatchOutcome;
  best?: Candidate;
  /** Топ вариантов — показываются в таблице ручного доподбора. */
  candidates: Candidate[];
};

/** Функция поиска в целевом сервисе. */
export type SearchFn = (query: string) => Promise<TrackRef[]>;

/** Выше этого порога считаем совпадение достоверным и переносим без вопросов. */
const AUTO = 0.68;
/** Ниже этого порога вариант не показываем даже как сомнительный. */
const REVIEW = 0.48;
/** Нашли настолько хороший вариант — дальше не ищем, экономим квоту. */
const CONFIDENT = 0.86;

/** Слова, выдающие каверы и подделки под оригинал. */
const IMPOSTOR = [
  'karaoke', 'tribute', 'made famous by', 'in the style of', 'originally performed',
  'instrumental version', 'lullaby', '8 bit', '8-bit', 'workout mix',
  'караоке', 'минус', 'кавер',
];

function fullTitle(source: TrackRef): string {
  return source.version ? `${source.title} ${source.version}` : source.title;
}

/**
 * Наборы поисковых запросов, от самого точного к самому широкому.
 *
 * `fieldSyntax` включает операторы вида `track:"…" artist:"…"` — их понимает
 * Spotify. Поиск Яндекса такого синтаксиса не знает и на подобной строке
 * находит пустоту, поэтому ему отдаём обычный текст.
 */
function buildQueries(source: TrackRef, fieldSyntax: boolean): string[] {
  const artist = source.artists[0] ?? '';
  const title = source.title;
  const queries: string[] = [];

  if (artist) {
    if (fieldSyntax) queries.push(`track:"${title}" artist:"${artist}"`);
    queries.push(`${artist} ${title}`);
  }
  queries.push(title);

  if (source.version) {
    queries.push(`${artist} ${fullTitle(source)}`.trim());
  }

  // Русские исполнители часто заведены латиницей (и наоборот).
  if (hasCyrillic(`${artist} ${title}`)) {
    queries.push(`${transliterate(artist)} ${transliterate(title)}`.trim());
  }

  // Несколько исполнителей — иногда сервис знает трек по второму из них.
  if (source.artists.length > 1) {
    queries.push(`${source.artists[1]} ${title}`);
  }

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

/** Насколько близка длительность: до 2 секунд — идеально, после 20 — уже не аргумент. */
function durationScore(a: number, b: number): number {
  if (!a || !b) return 0.5; // длительность неизвестна — не штрафуем и не поощряем
  const diff = Math.abs(a - b);
  if (diff <= 2000) return 1;
  if (diff >= 20000) return 0;
  return 1 - (diff - 2000) / 18000;
}

/** Есть ли у обеих сторон исполнители — от этого зависит, можно ли им верить. */
function artistsComparable(source: TrackRef, candidate: TrackRef): boolean {
  return source.artists.length > 0 && candidate.artists.length > 0;
}

function artistScore(source: TrackRef, candidate: TrackRef): number {
  if (!artistsComparable(source, candidate)) return 0.5;

  // Достаточно, чтобы совпал хотя бы один исполнитель: составы в сервисах
  // перечислены по-разному, а фиты часто спрятаны в названии.
  let best = 0;
  for (const a of source.artists) {
    for (const b of candidate.artists) {
      best = Math.max(best, similarity(normalize(a), normalize(b)));
    }
  }

  // Запасной вариант: все исполнители одной строкой.
  const joined = similarity(normalize(source.artists.join(' ')), normalize(candidate.artists.join(' ')));
  return Math.max(best, joined);
}

export function scoreCandidate(source: TrackRef, candidate: TrackRef): number {
  const sourceTitle = normalize(source.title);
  const candidateTitle = normalize(candidate.title);

  let title = similarity(sourceTitle, candidateTitle);

  // У каждой стороны приписка может жить и в названии, и отдельным полем —
  // сравниваем оба варианта склейки.
  if (source.version) {
    title = Math.max(title, similarity(normalize(fullTitle(source)), candidateTitle));
  }
  if (candidate.version) {
    title = Math.max(title, similarity(sourceTitle, normalize(fullTitle(candidate))));
  }

  const artist = artistScore(source, candidate);
  const duration = durationScore(source.durationMs, candidate.durationMs);

  let score = 0.42 * title + 0.38 * artist + 0.2 * duration;

  const lowerCandidate = `${candidate.title} ${candidate.version ?? ''}`.toLowerCase();
  const lowerSource = `${source.title} ${source.version ?? ''}`.toLowerCase();

  // Кавер/караоке вместо оригинала — худший вид «успешного» переноса.
  if (IMPOSTOR.some((word) => lowerCandidate.includes(word) && !lowerSource.includes(word))) {
    score -= 0.4;
  }

  // Ремикс там, где его не просили, — тоже не то же самое произведение.
  if (/\bremix\b|\bремикс\b/.test(lowerCandidate) && !/\bremix\b|\bремикс\b/.test(lowerSource)) {
    score -= 0.25;
  }

  // Живая запись вместо студийной — близко, но не то.
  if (/\blive\b/.test(lowerCandidate) && !/\blive\b/.test(lowerSource)) {
    score -= 0.12;
  }

  // Название и исполнитель — это идентичность трека, а не просто слагаемые.
  // Без потолков взвешенная сумма пропускает подмены: у «Yesterday» и «Help!»
  // совпадает исполнитель и примерно совпадает длительность, и этого хватало,
  // чтобы набрать проходной балл при полностью разных названиях.
  if (title < 0.45) score = Math.min(score, 0.3);
  if (artistsComparable(source, candidate) && artist < 0.35) score = Math.min(score, 0.42);

  return Math.max(0, Math.min(1, score));
}

export async function matchTrack(
  search: SearchFn,
  source: TrackRef,
  options: { fieldSyntax?: boolean } = {},
): Promise<MatchResult> {
  const seen = new Map<string, Candidate>();

  for (const query of buildQueries(source, options.fieldSyntax ?? false)) {
    let results: TrackRef[];
    try {
      results = await search(query);
    } catch {
      // Единичный сбой поиска не должен ронять весь перенос — пробуем следующий запрос.
      continue;
    }

    for (const track of results) {
      if (seen.has(track.id)) continue;
      seen.set(track.id, { track, score: scoreCandidate(source, track) });
    }

    const best = bestOf(seen);
    if (best && best.score >= CONFIDENT) break;
  }

  const candidates = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  const best = candidates[0];

  let outcome: MatchOutcome = 'miss';
  if (best && best.score >= AUTO) outcome = 'auto';
  else if (best && best.score >= REVIEW) outcome = 'review';

  return {
    source,
    outcome,
    best: outcome === 'miss' ? undefined : best,
    candidates: candidates.filter((c) => c.score >= 0.25),
  };
}

function bestOf(map: Map<string, Candidate>): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of map.values()) {
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

/**
 * Обход списка с ограничением параллелизма.
 * Spotify в Development Mode даёт скромную квоту, поэтому больше трёх
 * одновременных запросов быстро упираются в 429.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onDone?: (result: R, index: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const result = await worker(items[index], index);
      results[index] = result;
      onDone?.(result, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
