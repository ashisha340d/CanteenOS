import { config } from '../config';
import { ValidationError } from '../utils/errors';

/**
 * Thin wrapper around the Gemini `generateContent` API. Ported from VSKorder's
 * `gemini.service.ts` (see E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md) — powers the recipe
 * importer's AI-resolution step and audio transcription. Both fail with a clear message
 * rather than a stack trace when `GEMINI_API_KEY` is unset, since the feature is optional.
 */

interface InlineDataPart {
  inlineData: { mimeType: string; data: string };
}

const TIMEOUT_MS = 25_000;

function requireApiKey(): string {
  if (!config.gemini.apiKey) {
    throw new ValidationError(
      'AI-assisted recipe authoring is not configured on this server (GEMINI_API_KEY is unset)',
    );
  }
  return config.gemini.apiKey;
}

export async function generateGeminiText(
  prompt: string,
  inlineParts: InlineDataPart[] = [],
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const apiKey = requireApiKey();
  const url = `${config.gemini.apiUrl}/models/${config.gemini.model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, ...inlineParts] }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new Error(json.error.message);

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const base64 = buffer.toString('base64');
  const prompt =
    'Transcribe the speech in this audio clip. Return only the spoken text, with no extra commentary or formatting.';
  return generateGeminiText(prompt, [{ inlineData: { mimeType, data: base64 } }], options);
}

export function extractJson(text: string): string {
  const block = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (block?.[1] !== undefined) return block[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1).trim();
  return text.trim();
}
