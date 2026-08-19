/**
 * Deliberately forgiving client-side matching for long, machine-named lists (capabilities,
 * enum values, keys). Punctuation is ignored on both sides and every query word only has to
 * appear as a subsequence, so "eq wr" and "equipwrite" both find "equipment.write".
 */
function flatten(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

export function looseMatch(query: string, ...haystacks: string[]): boolean {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  if (tokens.length === 0) return true;
  const flat = flatten(haystacks.join(' '));
  return tokens.every((token) => isSubsequence(flatten(token), flat));
}
