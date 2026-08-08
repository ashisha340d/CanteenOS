const FETCH_TIMEOUT_MS = 8_000;

/** MyMemory rejects a `q` longer than this, so anything larger is translated in pieces. */
const MAX_CHARS_PER_CALL = 450;

/**
 * English -> Hindi auto-translate for the ingredient/menu-item name fields' "Auto Translate"
 * button. MyMemory is a free, keyless endpoint — good enough for a first draft that a human
 * then reviews; it is never treated as authoritative. Ported from VSKorder's
 * `translate.service.ts` (see E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md).
 */
export async function translateText(text: string, target = 'hi'): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const chunks = splitForTranslation(trimmed);
  const out: string[] = [];
  // Sequential rather than parallel: the free endpoint throttles bursts, and a recipe's
  // worth of steps would otherwise arrive as one.
  for (const chunk of chunks) {
    out.push(await translateChunk(chunk, target));
  }
  return out.join(' ');
}

/**
 * Translates many texts in one call, preserving order and position. An empty input stays
 * empty, and one failure fails the batch rather than silently returning English.
 */
export async function translateBatch(texts: string[], target = 'hi'): Promise<string[]> {
  const results: string[] = [];
  for (const text of texts) {
    results.push(await translateText(text, target));
  }
  return results;
}

async function translateChunk(text: string, target: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${target}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { responseData?: { translatedText?: string } };
    const translated = json.responseData?.translatedText;
    if (!translated) throw new Error('No translation returned');
    return translated;
  } finally {
    clearTimeout(timer);
  }
}

/** Splits on sentence ends first, then whitespace, so a chunk never breaks mid-word. */
function splitForTranslation(text: string): string[] {
  if (text.length <= MAX_CHARS_PER_CALL) return [text];

  const sentences = text.split(/(?<=[.!?।\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    for (const piece of hardSplit(sentence)) {
      if (current === '') {
        current = piece;
      } else if (current.length + piece.length + 1 <= MAX_CHARS_PER_CALL) {
        current = `${current} ${piece}`;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/** A single sentence longer than the limit still has to be broken, on word boundaries. */
function hardSplit(sentence: string): string[] {
  if (sentence.length <= MAX_CHARS_PER_CALL) return [sentence];

  const pieces: string[] = [];
  let current = '';
  for (const word of sentence.split(/\s+/)) {
    if (current === '') {
      current = word.slice(0, MAX_CHARS_PER_CALL);
    } else if (current.length + word.length + 1 <= MAX_CHARS_PER_CALL) {
      current = `${current} ${word}`;
    } else {
      pieces.push(current);
      current = word.slice(0, MAX_CHARS_PER_CALL);
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}
