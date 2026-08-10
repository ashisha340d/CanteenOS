/**
 * WhatsApp chat surface tokens.
 *
 * These are the literal values WhatsApp ships in its light theme. They deliberately sit apart
 * from `tokens.ts` (the MenuBoard Logistics Utility System) because the board feed is meant to
 * read as a WhatsApp group, while every other screen keeps the product's own identity.
 */

export const wa = {
  /* ------------------------------------------------------------ chrome */
  headerBg: '#008069',
  headerBgDark: '#006A5B',
  headerText: '#FFFFFF',
  headerSubtext: 'rgba(255,255,255,0.78)',
  headerIcon: '#FFFFFF',

  /* --------------------------------------------------------- wallpaper */
  wallpaper: '#EFEAE2',
  wallpaperInk: '#DCD3C6',

  /* ------------------------------------------------------------ bubbles */
  bubbleIn: '#FFFFFF',
  bubbleOut: '#D9FDD3',
  bubbleText: '#111B21',
  bubbleMeta: '#667781',
  bubbleMetaOut: '#667781',
  bubbleShadow: 'rgba(11,20,26,0.13)',

  /* -------------------------------------------------------------- ticks */
  tickSent: '#8696A0',
  tickRead: '#53BDEB',

  /* --------------------------------------------------------------- pills */
  datePillBg: '#FFFFFF',
  datePillText: '#54656F',
  systemPillBg: '#FCF5D8',
  systemPillText: '#54656F',

  /* ------------------------------------------------------------- compose */
  composeBg: '#F0F2F5',
  composeInputBg: '#FFFFFF',
  composeIcon: '#8696A0',
  composePlaceholder: '#8696A0',
  actionButton: '#00A884',
  actionButtonPressed: '#008069',

  /* --------------------------------------------------------------- reply */
  replyBarMine: '#06CF9C',
  replyBg: 'rgba(11,20,26,0.06)',
  replyBgOut: 'rgba(11,20,26,0.06)',

  /* ------------------------------------------------------------ recording */
  recordDot: '#EA0038',
  recordText: '#54656F',

  /* --------------------------------------------------------------- misc */
  link: '#027EB5',
  divider: 'rgba(11,20,26,0.08)',
  quotedText: '#667781',
} as const;

/** Bubble corner radius. WhatsApp uses a small, uniform 7.5pt with one squared-off tail corner. */
export const waRadius = {
  bubble: 7.5,
  bubbleTail: 0,
  pill: 999,
} as const;

/**
 * The sender-name colours WhatsApp cycles through in a group. Assigned by a stable hash of the
 * name so a person keeps the same colour for the life of the conversation.
 */
const WA_SENDER_COLORS = [
  '#E542A3',
  '#1F7AEC',
  '#00A5F4',
  '#DFAE3D',
  '#5E35B1',
  '#00897B',
  '#B8860B',
  '#E67C73',
  '#039BE5',
  '#0B8043',
  '#3949AB',
  '#D81B60',
  '#C0CA33',
  '#F4511E',
] as const;

export function waSenderColor(name: string | null | undefined): string {
  const text = name ?? '?';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return WA_SENDER_COLORS[hash % WA_SENDER_COLORS.length] as string;
}

/** Avatar background tones, matching WhatsApp's default contact circles. */
const WA_AVATAR_COLORS = [
  '#6B7C85',
  '#A67C52',
  '#4E8D7C',
  '#8D6E9B',
  '#B07C5A',
  '#5A7CA6',
  '#9B6E6E',
  '#6E9B7C',
] as const;

export function waAvatarColor(name: string | null | undefined): string {
  const text = name ?? '?';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 17 + text.charCodeAt(index)) >>> 0;
  }
  return WA_AVATAR_COLORS[hash % WA_AVATAR_COLORS.length] as string;
}
