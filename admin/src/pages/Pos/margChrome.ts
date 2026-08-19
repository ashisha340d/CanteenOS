export const MARG_LABEL = 'text-[#0d5b57]';

export const MARG_RULE = 'border-[#7d9490]';

export const MARG_FIELD =
  'h-[19px] w-full border-0 bg-transparent px-1 font-mono text-[13px] leading-none font-bold text-black uppercase outline-none focus:bg-white focus:shadow-[inset_0_0_0_1px_#0d5b57] disabled:text-[#6b7a77] placeholder:font-normal placeholder:text-[#8ba09c]';

export const MARG_CELL =
  'h-[20px] w-full border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-black uppercase outline-none focus:bg-white focus:shadow-[inset_0_0_0_1px_#0d5b57] disabled:text-[#6b7a77] placeholder:normal-case placeholder:text-[#8ba09c]';

export const MARG_BEVEL_OUT =
  'border-2 border-t-[#eef3f1] border-l-[#eef3f1] border-r-[#5f7370] border-b-[#5f7370]';

export const MARG_BEVEL_IN =
  'border-2 border-t-[#5f7370] border-l-[#5f7370] border-r-[#eef3f1] border-b-[#eef3f1]';

export const MARG_BTN = `${MARG_BEVEL_OUT} bg-[#c8d1ce] px-2 py-[1px] font-mono text-[12px] leading-[15px] text-black disabled:text-[#7d8c89]`;

const AMOUNT = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function margAmount(value: number): string {
  return AMOUNT.format(value);
}

export function margMoney(value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
