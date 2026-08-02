/**
 * Офлайн-проверка сопоставления: реальные пары «как в Яндексе» / «как в Spotify»
 * и заведомо неверные варианты. Гоняется без сети и без ключей.
 *
 *   npm run check:matching
 */

import { scoreCandidate, type TrackRef } from '../src/lib/match';
import { normalize, similarity, transliterate } from '../src/lib/text';

function ym(title: string, artists: string[], durationMs: number, version?: string): TrackRef {
  return { id: 'x', title, artists, durationMs, version };
}

function sp(title: string, artists: string[], durationMs: number): TrackRef {
  return { id: 'y', uri: 'spotify:track:y', title, artists, durationMs };
}

const AUTO = 0.68;
const REVIEW = 0.48;

type Case = { label: string; source: TrackRef; candidate: TrackRef; expect: 'auto' | 'review' | 'miss' };

const cases: Case[] = [
  {
    label: 'точное совпадение латиницей',
    source: ym('Bohemian Rhapsody', ['Queen'], 354000),
    candidate: sp('Bohemian Rhapsody', ['Queen'], 354947),
    expect: 'auto',
  },
  {
    label: 'ремастер в скобках у Spotify',
    source: ym('Come Together', ['The Beatles'], 259000),
    candidate: sp('Come Together - Remastered 2009', ['The Beatles'], 259947),
    expect: 'auto',
  },
  {
    label: 'фит вынесен в скобки',
    source: ym('Stay', ['The Kid LAROI', 'Justin Bieber'], 141000),
    candidate: sp('STAY (with Justin Bieber)', ['The Kid LAROI', 'Justin Bieber'], 141805),
    expect: 'auto',
  },
  {
    label: 'кириллица с обеих сторон',
    source: ym('Танцы на стёклах', ['Максим'], 236000),
    candidate: sp('Танцы на стеклах', ['МакSим'], 236000),
    expect: 'auto',
  },
  {
    label: 'русский исполнитель латиницей в Spotify',
    source: ym('Тает лёд', ['Грибы'], 175000),
    candidate: sp('Taet lyod', ['Griby'], 175000),
    expect: 'auto',
  },
  {
    label: 'version у Яндекса, приписка в названии у Spotify',
    source: ym('Numb', ['Linkin Park'], 187000, 'Live'),
    candidate: sp('Numb - Live', ['Linkin Park'], 187000),
    expect: 'auto',
  },
  {
    label: 'караоке-подделка должна отсеиваться',
    source: ym('Bohemian Rhapsody', ['Queen'], 354000),
    candidate: sp('Bohemian Rhapsody (Karaoke Version)', ['Karaoke Band'], 354000),
    expect: 'miss',
  },
  {
    label: 'непрошеный ремикс — не то же самое',
    source: ym('Blinding Lights', ['The Weeknd'], 200000),
    candidate: sp('Blinding Lights - Chromatics Remix', ['The Weeknd'], 248000),
    expect: 'review',
  },
  {
    label: 'другой трек того же артиста',
    source: ym('Yesterday', ['The Beatles'], 125000),
    candidate: sp('Help!', ['The Beatles'], 139000),
    expect: 'miss',
  },
  {
    label: 'совпало название, но артист чужой',
    source: ym('Hello', ['Adele'], 295000),
    candidate: sp('Hello', ['Lionel Richie'], 251000),
    expect: 'miss',
  },

  // Обратное направление: источник — Spotify, кандидат — карточка Яндекса,
  // где приписка живёт в отдельном поле version.
  {
    label: 'обратно: приписка Spotify против version Яндекса',
    source: sp('Numb - Live', ['Linkin Park'], 187000),
    candidate: ym('Numb', ['Linkin Park'], 187000, 'Live'),
    expect: 'auto',
  },
  {
    label: 'обратно: латиница Spotify против кириллицы Яндекса',
    source: sp('Taet lyod', ['Griby'], 175000),
    candidate: ym('Тает лёд', ['Грибы'], 175000),
    expect: 'auto',
  },
  {
    label: 'обратно: фит в скобках против version',
    source: sp('Numb (feat. Jay-Z)', ['Linkin Park'], 187000),
    candidate: ym('Numb', ['Linkin Park', 'Jay-Z'], 187000, 'feat. Jay-Z'),
    expect: 'auto',
  },
];

function classify(score: number): 'auto' | 'review' | 'miss' {
  if (score >= AUTO) return 'auto';
  if (score >= REVIEW) return 'review';
  return 'miss';
}

let failed = 0;
console.log('\n  Сопоставление треков\n');

for (const testCase of cases) {
  const score = scoreCandidate(testCase.source, testCase.candidate);
  const actual = classify(score);
  const ok = actual === testCase.expect;
  if (!ok) failed++;
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'}  ${testCase.label.padEnd(42)} ${(score * 100).toFixed(0).padStart(3)}%  ` +
      `ожидалось ${testCase.expect}, получено ${actual}`,
  );
}

console.log('\n  Нормализация\n');
const normalizations: Array<[string, string]> = [
  ['Come Together - Remastered 2009', 'come together'],
  ['STAY (with Justin Bieber)', 'stay with justin bieber'],
  ['Numb (feat. Jay-Z)', 'numb'],
  ['Тает лёд', 'тает лед'],
  ['Song (Live at Wembley)', 'song live at wembley'],
];

for (const [input, expected] of normalizations) {
  const actual = normalize(input);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  "${input}" -> "${actual}"${ok ? '' : ` (ожидалось "${expected}")`}`);
}

console.log('\n  Транслитерация\n');
for (const word of ['Грибы', 'Щербаков', 'Ёлка', 'Цой']) {
  console.log(`  ${word} -> ${transliterate(word)}`);
}

console.log(`\n  Кириллица против латиницы: "грибы" ~ "griby" = ${similarity('грибы', 'griby').toFixed(2)}\n`);

if (failed > 0) {
  console.error(`  ${failed} проверок не прошло\n`);
  process.exit(1);
}
console.log('  Все проверки пройдены\n');
