import { RecipeIngredientScaling, type RecipeDifficulty } from '@menuboard/shared';
import { extractJson, generateGeminiText } from './GeminiService';

/**
 * Free-text recipe import: a rule-based first pass (no AI dependency), with an optional
 * Gemini resolution step for ingredients the regex parser could not confidently match.
 * Ported from VSKorder's `recipe-parser.service.ts` (see
 * E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md), adapted to UUID ingredient ids and MenuBoard's
 * `RecipeIngredientScaling` enum.
 */

export interface KnownIngredient {
  id: string;
  name: string;
  nameHi?: string | null;
}

export interface ParsedIngredient {
  ingredientId?: string;
  name: string;
  qtyForBasePax: string;
  unit?: string;
  scaling?: RecipeIngredientScaling;
  notes?: string;
}

export interface ParsedStep {
  textEn: string;
  durationMin?: number;
}

export interface UnresolvedItem {
  type: string;
  text: string;
  reason: string;
}

export interface ParsedRecipe {
  itemName: string;
  basePax: number;
  prepTimeMin?: number;
  cookTimeMin?: number;
  difficulty?: RecipeDifficulty;
  descriptionEn?: string;
  methodEn?: string;
  yieldNote?: string;
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  unresolved: UnresolvedItem[];
}

const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', millilitre: 'ml',
  l: 'ltr', lt: 'ltr', ltr: 'ltr', liter: 'ltr', litres: 'ltr', liters: 'ltr',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tablespoon: 'tbsp', tbs: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', tsps: 'tsp',
  pinch: 'pinch', pinches: 'pinch',
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs',
};

const FIXED_SCALING_HINTS = /temper|tadka|garnish|topping|serve|to taste|as needed|as required|pinch|optional|for garnish|for tempering|for serving/i;
const SQRT_SCALING_INGREDIENTS = /\b(salt|water)\b/i;
const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'or', 'to', 'with', 'without', 'finely', 'chopped', 'diced', 'sliced', 'fresh', 'dried', 'whole', 'half']);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function tokenSet(text: string): Set<string> {
  const tokens = normalize(text)
    .split(' ')
    .map(singularize)
    .filter((w) => w && !STOP_WORDS.has(w));
  return new Set(tokens);
}

function parseQuantity(raw: string): number | null {
  if (!raw) return null;
  const mixed = raw.match(/^(\d+)\s+(\d)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = raw.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const range = raw.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const decimal = Number(raw.replace(/,/g, ''));
  if (!Number.isNaN(decimal)) return decimal;
  return null;
}

function detectUnit(word: string): string | undefined {
  if (!word) return undefined;
  const clean = word.toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[clean];
}

function parseIngredientLine(line: string): ParsedIngredient | null {
  const cleaned = line.replace(/^[-*••·\s]+/, '').trim();
  if (!cleaned) return null;

  const leadingQty = /^[-*•\s]*((?:\d+\s+\d\/\d+|\d+(?:\/\d+)?(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\/\d+)?(?:\.\d+)?)?))\s*(?:([a-zA-Z.]+)\s*[.,]?\s+)?(.*)$/;
  let qty: number | null = null;
  let unit: string | undefined;
  let name = '';
  let notes = '';

  const m = cleaned.match(leadingQty);
  if (m) {
    if (m[1]) qty = parseQuantity(m[1].trim());
    const first = m[2]?.trim();
    const rest = m[3]?.trim() ?? '';
    if (first) {
      const unitCandidate = detectUnit(first);
      if (unitCandidate) {
        unit = unitCandidate;
        name = rest;
      } else if (['a', 'an', 'the'].includes(first.toLowerCase()) && rest) {
        name = rest;
        if (first.toLowerCase() === 'a' || first.toLowerCase() === 'an') qty = qty ?? 1;
      } else {
        name = first + (rest ? ' ' + rest : '');
      }
    } else {
      name = rest;
    }

    const bracketNotes = name.match(/(.+?)\s*[[(]([^\])]+)[\])]\s*$/);
    if (bracketNotes?.[1] !== undefined && bracketNotes[2] !== undefined) {
      name = bracketNotes[1].trim();
      notes = bracketNotes[2].trim();
    }

    if (!notes) {
      const forMatch = name.match(/(.+?)\s+\b(for\s+.+)$/i);
      if (forMatch?.[1] !== undefined && forMatch[2] !== undefined) {
        name = forMatch[1].trim();
        notes = forMatch[2].trim();
      }
    }
  } else {
    name = cleaned;
  }

  if (!name) return null;

  const scaling = FIXED_SCALING_HINTS.test(name + ' ' + notes)
    ? RecipeIngredientScaling.FIXED
    : SQRT_SCALING_INGREDIENTS.test(name)
      ? RecipeIngredientScaling.SQRT
      : RecipeIngredientScaling.LINEAR;

  return {
    name,
    qtyForBasePax: qty === null ? '' : String(qty),
    unit,
    scaling,
    notes,
  };
}

function findSection(lines: string[], patterns: RegExp[]): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i] as string))) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const endPatterns = [/instructions|method|directions|steps|preparation|how to make|procedure|notes|tips|serves|yield|nutrition/i];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (endPatterns.some((re) => re.test(lines[i] as string))) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function findMethodSection(lines: string[]): { start: number; end: number } | null {
  return findSection(lines, [/instructions|method|directions|steps|preparation|how to make|procedure/i]);
}

function detectDifficulty(text: string): RecipeDifficulty | undefined {
  if (/\beasy\b/i.test(text)) return 'EASY';
  if (/\bmedium\b/i.test(text)) return 'MEDIUM';
  if (/\bhard\b/i.test(text) || /\bdifficult\b/i.test(text)) return 'HARD';
  return undefined;
}

function detectTime(text: string, type: 'prep' | 'cook' | 'total'): number | undefined {
  const label = type === 'prep' ? 'preparation' : type === 'cook' ? 'cooking' : 'total';
  const re = new RegExp(String.raw`(?:${type}|${label})\s*(?:time)?[:\s]*(\d+)\s*(?:min|minute)`, 'i');
  const m = text.match(re);
  return m ? Number(m[1]) : undefined;
}

function detectBasePax(text: string): number {
  const m = text.match(/(?:serves?|servings?|pax|people|persons|yield(?:s)?|makes?)[:\s]*(\d+(?:[.,]\d+)?)/i);
  if (m?.[1] !== undefined) return Number(m[1].replace(/,/, ''));
  const range = text.match(/(?:serves?|servings?|people|persons)[:\s]*(\d+)\s*[-–]\s*(\d+)/i);
  if (range?.[1] !== undefined && range[2] !== undefined) {
    return Math.round((Number(range[1]) + Number(range[2])) / 2);
  }
  return 100;
}

function matchIngredients(parsed: ParsedIngredient[], known: KnownIngredient[]): ParsedIngredient[] {
  return parsed.map((p) => {
    const parsedTokens = tokenSet(p.name);
    if (parsedTokens.size === 0) return p;

    const candidates = known
      .map((k) => {
        const knownTokens = tokenSet(k.name + ' ' + (k.nameHi ?? ''));
        const intersection = [...knownTokens].filter((t) => parsedTokens.has(t));
        return {
          ingredient: k,
          score: intersection.length,
          knownLength: knownTokens.size,
          nameLength: k.name.length,
        };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.knownLength !== a.knownLength) return b.knownLength - a.knownLength;
        return b.nameLength - a.nameLength;
      });

    if (candidates.length === 1 || (candidates.length > 1 && (candidates[0] as { score: number }).score > (candidates[1] as { score: number }).score)) {
      return { ...p, ingredientId: (candidates[0] as { ingredient: KnownIngredient }).ingredient.id };
    }
    return p;
  });
}

function buildStep(text: string): ParsedStep {
  const cleaned = text.trim();
  const m = cleaned.match(/(\d+)\s*(?:min|minute|minutes)/i);
  return { textEn: cleaned, durationMin: m ? Number(m[1]) : undefined };
}

export function parseRecipeText(rawText: string, knownIngredients: KnownIngredient[]): ParsedRecipe {
  const text = rawText.replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.trim());

  const unresolved: UnresolvedItem[] = [];

  let itemName = '';
  const titleLine = lines.find((l) => l && !l.match(/^(ingredients|instructions|method|serves|prep|recipe[:-])/i));
  if (titleLine) {
    itemName = (titleLine.replace(/^[-*•\s]+/, '').split(/\s{2,}|\t/)[0] as string).trim();
  }
  const recipeHeader = text.match(/recipe\s*(?:for)?[:\-\s]+(.+)/i)?.[1]?.trim();
  if (recipeHeader) itemName = recipeHeader;

  const basePax = detectBasePax(text);
  const prepTimeMin = detectTime(text, 'prep');
  const cookTimeMin = detectTime(text, 'cook');
  const difficulty = detectDifficulty(text);

  const ingredientSection = findSection(lines, [/ingredients/i, /for the\s+\w+/i, /you will need/i, /what you need/i]);
  const methodSection = findMethodSection(lines);

  const ingredientLines: string[] = [];
  if (ingredientSection) {
    const raw = lines.slice(ingredientSection.start + 1, ingredientSection.end).filter((l) => l);
    for (const l of raw) {
      if (/^\d+[.)]\s/.test(l)) break;
      if (/instructions|method|directions|steps|preparation/i.test(l)) break;
      if (l.startsWith('-') || l.startsWith('*') || /\d/.test(l) || l.length < 80) ingredientLines.push(l);
    }
  }

  let parsedIngredients = ingredientLines
    .map(parseIngredientLine)
    .filter((x): x is ParsedIngredient => x !== null && x.name.length > 1);

  parsedIngredients = matchIngredients(parsedIngredients, knownIngredients);

  const methodStart = methodSection
    ? methodSection.start + 1
    : ingredientSection
      ? ingredientSection.end
      : lines.length;
  const methodEnd = methodSection ? methodSection.end : lines.length;
  const methodLines = lines
    .slice(methodStart, methodEnd)
    .filter((l) => l && !l.match(/^(instructions|method|directions|steps|preparation)$/i));

  const steps: ParsedStep[] = [];
  let currentStep = '';
  for (const l of methodLines) {
    const numbered = l.match(/^\d+[.)]:?\s*(.+)/);
    if (numbered) {
      if (currentStep) steps.push(buildStep(currentStep));
      currentStep = numbered[1] as string;
    } else if (l.length < 25 && currentStep) {
      currentStep += ' ' + l;
    } else if (l) {
      if (currentStep) steps.push(buildStep(currentStep));
      currentStep = l;
    }
  }
  if (currentStep) steps.push(buildStep(currentStep));

  const methodEn = steps.map((s) => s.textEn).join('\n\n');

  parsedIngredients.forEach((ing) => {
    if (!ing.ingredientId) {
      unresolved.push({
        type: 'ingredient',
        text: `${ing.qtyForBasePax || ''} ${ing.unit || ''} ${ing.name}`.trim(),
        reason: 'No matching ingredient in the master list',
      });
    }
  });

  return {
    itemName,
    basePax,
    prepTimeMin,
    cookTimeMin,
    difficulty,
    descriptionEn: '',
    methodEn,
    yieldNote: '',
    ingredients: parsedIngredients,
    steps,
    unresolved,
  };
}

export async function resolveRecipeWithAI(
  rawText: string,
  draft: ParsedRecipe,
  unresolved: UnresolvedItem[],
  knownIngredients: KnownIngredient[],
): Promise<ParsedRecipe> {
  const ingredientList = knownIngredients.map((k) => `${k.id}:${k.name}`).join('\n');
  const prompt = `You are a recipe parser for a kitchen management system.

Recipe text:
---
${rawText}
---

Known ingredients (id:name):
${ingredientList}

Regex parser produced this draft JSON:
${JSON.stringify({ ...draft, unresolved })}

Resolve the unresolved items using the known ingredient list. Return only a valid JSON object with the exact same shape as the draft above (keys: itemName, basePax, prepTimeMin, cookTimeMin, difficulty, descriptionEn, methodEn, yieldNote, ingredients, steps, unresolved). For each ingredient, set ingredientId from the known list when confident, otherwise leave it out. Do not include any explanation outside the JSON.`;

  const text = await generateGeminiText(prompt);
  const json = extractJson(text);
  try {
    const parsed = JSON.parse(json) as ParsedRecipe;
    return { ...draft, ...parsed };
  } catch {
    throw new Error('AI response could not be parsed into a recipe draft');
  }
}
