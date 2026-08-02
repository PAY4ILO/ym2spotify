/** Нормализация строк и меры похожести для сопоставления треков. */

const CYRILLIC = /[а-яё]/i;

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

export function hasCyrillic(value: string): boolean {
  return CYRILLIC.test(value);
}

export function transliterate(value: string): string {
  let out = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    const mapped = TRANSLIT[lower];
    out += mapped === undefined ? char : mapped;
  }
  return out;
}

/**
 * Хвосты, которые Яндекс и Spotify пишут по-разному и которые только мешают
 * сравнению: пометки о ремастере, издании, версии.
 */
const NOISE = [
  'remaster', 'remastered', 'remasterizado', 'radio edit', 'radio version',
  'album version', 'single version', 'original mix', 'extended mix',
  'bonus track', 'deluxe', 'anniversary', 'edition', 'reissue',
  'mono version', 'stereo version', 'explicit', 'clean version',
  'ремастер', 'переиздание', 'бонус', 'версия',
];

const FEAT = /\s*[\(\[]?\s*(feat\.?|ft\.?|featuring|при участии|совместно с)\s+[^)\]]*[\)\]]?/gi;

/** Скобочный хвост считаем мусором, только если внутри есть шумовое слово. */
function dropNoisyBrackets(value: string): string {
  return value.replace(/[\(\[][^\)\]]*[\)\]]/g, (match) => {
    const inner = match.slice(1, -1).toLowerCase();
    return NOISE.some((word) => inner.includes(word)) ? ' ' : match;
  });
}

/** Хвост после дефиса («Song - 2011 Remaster») — тоже только при наличии шума. */
function dropNoisyDashTail(value: string): string {
  const index = value.lastIndexOf(' - ');
  if (index === -1) return value;
  const tail = value.slice(index + 3).toLowerCase();
  return NOISE.some((word) => tail.includes(word)) ? value.slice(0, index) : value;
}

export function normalize(value: string, options: { keepFeat?: boolean } = {}): string {
  let out = value.toLowerCase().replace(/ё/g, 'е');
  out = dropNoisyBrackets(out);
  out = dropNoisyDashTail(out);
  if (!options.keepFeat) out = out.replace(FEAT, ' ');
  out = out
    .normalize('NFD')
    // диакритика после NFD — комбинирующие знаки U+0300..U+036F
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return out;
}

function tokens(value: string): string[] {
  return value.split(' ').filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current.slice();
  }
  return previous[b.length];
}

function editRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/** Похожесть по множествам слов — устойчива к перестановкам и лишним словам. */
function tokenSetRatio(a: string, b: string): number {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;

  // Дайс: вознаграждает совпадение слов, не наказывая за разную длину так жёстко, как Жаккар.
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * Итоговая похожесть двух нормализованных строк.
 * Берём максимум из посимвольной и пословной меры: первая ловит опечатки
 * и разную транслитерацию, вторая — перестановки и лишние слова.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  let score = Math.max(editRatio(a, b), tokenSetRatio(a, b));

  // Одна строка целиком входит в другую («Song» против «Song Reprise») — почти совпадение.
  if (a.includes(b) || b.includes(a)) {
    score = Math.max(score, 0.9);
  }

  // Если строки на разных алфавитах, сравниваем ещё и в латинице.
  if (hasCyrillic(a) !== hasCyrillic(b)) {
    const latinA = transliterate(a);
    const latinB = transliterate(b);
    score = Math.max(score, editRatio(latinA, latinB), tokenSetRatio(latinA, latinB));
  }

  return score;
}
