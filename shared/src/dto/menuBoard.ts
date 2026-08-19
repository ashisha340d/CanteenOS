import type { MasterStatus } from '../enums';
import type { IsoDateTime, Uuid } from './common';

/**
 * The Digital Menu Board — the fullscreen bilingual menu shown on a screen above the counter.
 *
 * Two halves, and the seam between them is the whole design. *What* is on offer belongs to
 * Menu Master and is never restated here: a screen names a menu by its stable code and the
 * board renders whatever that published menu currently resolves to. *How* that menu is
 * presented — the house name, the typography, the column arrangement, the Today panel and the
 * ad rotation — is a property of the physical screen, because two screens in the same hall may
 * show the same menu at different sizes.
 *
 * Everything a board reads is public and read-only. A screen hangs on a wall, is opened by URL
 * with nobody signed in, and can neither price an item nor change one; editing lives in the
 * Admin Portal behind MASTER_WRITE, exactly like every other Menu Master surface.
 */

/* ------------------------------------------------------------------ presentation config */

/**
 * Typography and spacing, formerly the `Settings` sheet of the board's Excel workbook.
 *
 * Keys are carried over verbatim so the board's existing renderer reads them unchanged — it
 * maps each one onto a CSS custom property. The workbook's `FontWeight_*` cells are absent on
 * purpose: the board hardcodes its weights in CSS and has always ignored those cells, so
 * carrying them would create a field that silently does nothing.
 */
export interface MenuBoardTypography {
  Font_RestaurantName?: string;
  FontSize_RestaurantName?: number;
  Font_CategoryName?: string;
  FontSize_CategoryName?: number;
  Font_ItemName_EN?: string;
  FontSize_ItemName_EN?: number;
  Font_ItemName_HI?: string;
  FontSize_ItemName_HI?: number;
  Font_Price?: string;
  FontSize_Price?: number;
  /** Smallest size the auto-fit pass may shrink an item name to before it gives up. */
  FontSize_Min?: number;
  Padding_Header?: number;
  Padding_CategoryHeader?: number;
  Padding_Item?: number;
  Padding_Item_Horizontal?: number;
  Gap_Columns?: number;
  Gap_Outer?: number;
  Gap_Categories?: number;
}

/**
 * The house identity and the morning-menu window.
 *
 * `morningFrom`/`morningTo` are `HH:mm` on a 24-hour clock, never a date. They used to be Excel
 * time serials, which arrive over JSON as a 1899 timestamp — a shape the board's `parseTime`
 * cannot read, and one that would break the morning/all-day boundary silently.
 */
export interface MenuBoardIdentity {
  restaurantName?: string;
  restaurantNameHi?: string;
  /** Seconds each language is held before the specials ribbon swaps script. */
  langSwitchSeconds?: number;
  morningFrom?: string;
  morningTo?: string;
  eveningFrom?: string;
  eveningTo?: string;
}

/**
 * Where a category sits on the board.
 *
 * The canonical model is always three columns — narrow screens fold them for display only, so
 * a phone opening the board over the LAN can never flatten the arrangement the wall screen
 * depends on. `fonts` scales one category's type relative to the rest.
 */
export interface MenuBoardLayout {
  /** Three arrays of category names, in the order they are stacked. */
  columns?: string[][];
  /** Per-category type scale, 0.7–1.8, keyed by category name. */
  fonts?: Record<string, number>;
}

/**
 * The Today panel — clock, weather and the day's festival, floating over the grid.
 *
 * One box, one position: the weather card and the festival line live *inside* it rather than
 * being independently placed, exactly as the board has always drawn them. Moving "the weather
 * widget" means moving this panel. `x`/`y`/`w`/`h` are viewport percentages, not pixels, so a
 * layout arranged on an office monitor lands the same way on the physical screen it is meant
 * for.
 */
export interface MenuBoardPanelConfig {
  on?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Show the weather card inside the panel. */
  wx?: boolean;
  /** Show the festival line inside the panel. */
  fest?: boolean;
  /** Type scale for the clock and date inside the panel, 0.6–2.0. */
  fs?: number;
}

/** Where the panel's weather card gets its reading. Open-Meteo needs no API key. */
export interface MenuBoardWeatherConfig {
  lat?: number;
  lon?: number;
  /** Shown next to the reading — "Vrindavan", not a raw coordinate pair. */
  place?: string;
  unit?: 'C' | 'F';
  /**
   * Lift the weather card out of the Today panel and place it on its own.
   *
   * The card sat inside the panel because that is where the board has always drawn it, which
   * also meant it could only be moved by moving the clock and the festival line with it. A
   * screen whose panel belongs in one corner and whose weather belongs in another had no way to
   * say so. Off by default, so an existing board keeps the arrangement it has.
   */
  float?: boolean;
  /** Viewport percentages, used only while `float` is on. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Type scale for the reading and condition text, 0.6–2.0. */
  fs?: number;
}

/** The canvas celebration animation (diyas, petals, fireworks…) that plays on a festival day. */
export interface MenuBoardCelebrationConfig {
  on?: boolean;
  anim?: string;
  /** Minutes between plays. */
  everyMin?: number;
  /** How long one play lasts, in seconds. */
  forSec?: number;
}

/**
 * One festival day. `d` is `MM-DD` and repeats every year; a lunar festival whose date moves
 * needs a full `YYYY-MM-DD` and is re-entered by an operator each year rather than computed.
 */
export interface MenuBoardFestivalDay {
  d: string;
  n: string;
  /** Name in Hindi. */
  h?: string;
  /** Which celebration animation this day plays. */
  a?: string;
}

/** Where the festival calendar is imported from, so it doesn't have to be typed in by hand. */
export interface MenuBoardHolidaySyncConfig {
  /** Calendarific API key. Blank disables the import button. */
  key?: string;
  country?: string;
  lastSync?: string;
}

/** The periodic flourish that runs across category cards — a gentle "still alive" motion. */
export interface MenuBoardCardAnimationConfig {
  on?: boolean;
  /**
   * One of the named styles, or `random` — which plays each of them in turn on successive
   * sweeps rather than picking one at random, so a board running all day shows the whole
   * vocabulary instead of the same motion every five minutes.
   */
  style?: string;
  everyMin?: number;
}

/**
 * One rotating advertisement. Position is independent of every other ad — each occupies its own
 * slot on the board and they are never shown two at a time — so `x`/`y`/`w`/`h` describe that
 * one ad's box in viewport percentages, the same convention as `MenuBoardPanelConfig`.
 */
export interface MenuBoardAd {
  id: string;
  on?: boolean;
  title?: string;
  /** Title in Hindi. */
  hi?: string;
  text?: string;
  /** Free text, not a number — the board renders it after a ₹ only when it looks numeric. */
  price?: string;
  /**
   * Absolute URLs into the media library. One image holds for the ad's whole `forSec`; more
   * than one splits that time evenly between them and crossfades from one to the next, so a
   * dish with three angles gets three looks in the same slot instead of a slideshow that outran
   * the ad rotation.
   */
  images?: string[];
  /**
   * Menu items this ad is advertising, by `MenuBoardItemDto.id`.
   *
   * An ad used to be free text and a photograph, which meant advertising a dish involved
   * retyping its name and price and then remembering to retype them again when the kitchen
   * repriced it. Tagging the item instead makes the ad follow Menu Master: the board draws the
   * live name, Hindi name and price straight from the same snapshot that fills the grid, and an
   * item whose photo is already on file needs no photo pasted here at all.
   *
   * An id that no longer resolves is skipped rather than drawn blank — a dish can be retired
   * while an ad still names it, and a board must not stop for that.
   */
  items?: string[];
  /** Minutes between appearances. */
  everyMin?: number;
  /** How long one appearance is held on screen, in seconds. */
  forSec?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Type scale for this ad's own text, 0.6–2.0. */
  fs?: number;
  fsTitle?: number;
  fsHi?: number;
  fsText?: number;
  fsPrice?: number;
  /** Entrance keyframe name. */
  anim?: string;
  /** The photo's own box inside the ad, in percentages of the ad. */
  img?: { x?: number; y?: number; w?: number; h?: number; fit?: 'cover' | 'contain' };
}

/**
 * Everything about a screen that isn't the menu itself: the Today panel, the celebration and
 * card animations, the festival calendar, and the ad rotation. Used to be edited in an on-board
 * admin overlay that only existed while someone was standing at the screen; it is Admin Portal
 * configuration now, like everything else about a screen.
 */
export interface MenuBoardBoardConfig {
  panel?: MenuBoardPanelConfig;
  wx?: MenuBoardWeatherConfig;
  fx?: MenuBoardCelebrationConfig;
  hol?: MenuBoardHolidaySyncConfig;
  divAnim?: MenuBoardCardAnimationConfig;
  days?: MenuBoardFestivalDay[];
  ads?: MenuBoardAd[];
  /** How the rows inside every category are ordered. `menu` keeps Menu Master's own order. */
  sort?: 'menu' | 'name' | 'price';
  /**
   * Items shown under a different category on this screen only, as `itemId -> category name`.
   *
   * A hall often wants one dish read off the wall somewhere other than where the kitchen files
   * it — a lassi under Drinks rather than Sweets — without that becoming an argument about the
   * master menu. This moves it on this board and nowhere else: Menu Master, the POS and the
   * kiosk are untouched, and clearing the entry puts it straight back.
   */
  moves?: Record<string, string>;
  /** Per-category presentation overrides, keyed by the category's Menu Master name. */
  cats?: Record<string, MenuBoardCategoryOverride>;
}

export interface MenuBoardCategoryOverride {
  label?: string;
  labelHi?: string;
  fs?: number;
  /** Explicit placement; absent means the board's own column balancing decides. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** The full presentation blob a screen carries. Every field is optional; the board defaults. */
export interface MenuBoardConfig {
  identity?: MenuBoardIdentity;
  typography?: MenuBoardTypography;
  layout?: MenuBoardLayout;
  /** Today panel, celebration animations, festival calendar and the ad board. */
  board?: MenuBoardBoardConfig;
}

/* ------------------------------------------------------------------- the screen registry */

/** One physical menu screen, as the Admin Portal holds it. */
export interface MenuBoardScreenDto {
  id: Uuid;
  /** Stable, human-typed code that appears in the screen's URL. */
  code: string;
  name: string;
  /** Which Menu Master menu this screen shows, by `menus.code`. Blank defers to the POS default. */
  menuCode: string;
  /** Joined for display. Null when the code names no menu — including when it is blank. */
  menuName: string | null;
  /**
   * No longer drives anything. A board used to re-fetch on a timer at this interval; it now
   * holds a WebSocket open and refetches only when told to, which is instant instead of "within
   * `pollSeconds`" and costs nothing while nothing has changed. Kept on the row and the DTO so
   * an already-stored value isn't lost, but nothing schedules against it — see
   * `docs/API.md §17.8`.
   */
  pollSeconds: number;
  config: MenuBoardConfig;
  status: MasterStatus;
  /**
   * When a screen last asked for its snapshot. The only heartbeat a board has, and the only way
   * an operator two floors away can tell a screen that is switched off from one that is
   * switched on and showing the wrong thing.
   */
  lastSeenAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateMenuBoardScreenRequest {
  code: string;
  name: string;
  menuCode: string;
  pollSeconds?: number;
  config?: MenuBoardConfig;
  status?: MasterStatus;
}

export interface UpdateMenuBoardScreenRequest {
  code?: string;
  name?: string;
  menuCode?: string;
  pollSeconds?: number;
  config?: MenuBoardConfig;
  status?: MasterStatus;
}

/* ------------------------------------------------------------------------ the board feed */

/**
 * One priced line as the board draws it.
 *
 * Deliberately flat and deliberately *not* `ResolvedMenuItemDto`: a board renders a name, a
 * price and a photo, and has no use for variants, counters, printing routes or modifier ids.
 * Sending the resolved tree as-is would put the counter's routing configuration on a public
 * endpoint for no gain.
 *
 * An item with variants contributes one line per variant, so a "Half / Full" dish reads as two
 * priced rows the way it always has on this board.
 */
export interface MenuBoardItemDto {
  /** Stable across polls, so the board's keyed reconciler can diff without re-creating rows. */
  id: string;
  category: string;
  categoryHi: string;
  name: string;
  nameHi: string;
  price: string;
  /** Absolute, unsigned, cacheable URL into the Menu Master media library, or ''. */
  image: string;
  available: boolean;
  /**
   * Offered in the MORNING shift today, resolved from `menu_item_schedules`. During the
   * configured morning hours the board shows only these.
   */
  isMorning: boolean;
  /**
   * Highlighted in the specials ribbon. Always false for now: Menu Master has no "featured"
   * concept to resolve it from, and the ribbon already falls back to the whole menu when
   * nothing is picked, so an invented flag would be worse than an honest absence.
   */
  featured: boolean;
}

/** Everything a screen needs for one render, in one round trip. */
export interface MenuBoardSnapshotDto {
  screen: { code: string; name: string; pollSeconds: number };
  menu: { code: string; name: string };
  /**
   * Changes whenever the menu or the config does. Fetched once on load and again whenever the
   * `MENU_BOARD_CHANGED` socket event fires, so the board only ever re-renders on an actual
   * change rather than re-checking on a timer.
   */
  revision: string;
  config: MenuBoardConfig;
  items: MenuBoardItemDto[];
}

/** The revision-only response — cheaper than the full snapshot for the "did anything change?" check. */
export interface MenuBoardRevisionDto {
  revision: string;
}

/* --------------------------------------------------------------------------- realtime */

/**
 * The public, unauthenticated Socket.IO namespace a board connects to.
 *
 * Deliberately its own namespace rather than a room on the authenticated default namespace: a
 * board has no session and no bearer token to pass the socket middleware every other client
 * goes through, so it needs a connection that never runs that middleware at all. Socket.IO
 * namespaces have independent middleware stacks for exactly this reason.
 */
export const MENU_BOARD_SOCKET_NAMESPACE = '/menu-board';

/**
 * The one event this namespace ever emits. It carries no payload beyond a reason string for
 * logging — like every other realtime broadcast in this app (see `RealtimeGateway`), it is a
 * hint, not data: "something you render has changed", never *what*. The client already knows
 * how to ask for the truth (`GET /menu-board/revision`, then the full snapshot if it moved),
 * so duplicating that in the socket payload would just be a second copy to keep in sync.
 */
export const MENU_BOARD_CHANGED_EVENT = 'menu-board:changed';
