import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The board speaks Hindi or English, and the counter person decides which — a flag button in the
 * top bar, remembered on the device rather than per station, because the person choosing is the
 * person standing there and they meet the language before a station is ever picked (sign-in,
 * station chooser, lock screen).
 *
 * Modern spoken Hindi, not literary Hindi: the words a counter actually uses. Where the kitchen
 * says an English word out loud — ऑर्डर, आइटम, काउंटर, सेटिंग, स्टेशन — that is the word here,
 * written in Devanagari, because translating it into a Sanskritised equivalent nobody says
 * would make the screen harder to read, not more Hindi.
 *
 * Two flat objects rather than a locale framework, with the English one typed as `typeof hi`:
 * a key added to one and forgotten in the other is a compile error, which is the only guarantee
 * that actually matters on a screen nobody will proofread twice.
 */
const hi = {
  /* ------------------------------------------------------------------ common */
  loading: 'लोड हो रहा है…',
  cancel: 'रद्द करें',
  save: 'सेव करें',
  close: 'बंद करें',
  retry: 'दोबारा कोशिश करें',

  /* ------------------------------------------------------------- sign in */
  appName: 'सर्विस KDS',
  staffSignIn: 'स्टाफ लॉगिन',
  username: 'यूज़रनेम',
  password: 'पासवर्ड',
  signIn: 'लॉगिन करें',
  continue: 'आगे बढ़ें',
  useMpin: 'MPIN से लॉगिन करें',
  usePassword: 'पासवर्ड से लॉगिन करें',
  signingInAs: 'लॉगिन हो रहा है',
  signOut: 'लॉगआउट',
  signOutInstead: 'लॉगआउट करें',
  signInFailed: 'लॉगिन नहीं हो सका। कनेक्शन जाँच लें।',
  mpinRejected: 'MPIN गलत है। दोबारा डालें या पासवर्ड से लॉगिन करें।',
  mpinLocked: 'कई बार गलत MPIN। अब पासवर्ड से लॉगिन करें।',
  deleteDigit: 'एक अंक मिटाएँ',
  back: 'पीछे',

  /* --------------------------------------------------------------- lock */
  screenLocked: 'स्क्रीन लॉक है',
  tapMpinToUnlock: 'बोर्ड खोलने के लिए अपना MPIN डालें',
  lockScreen: 'स्क्रीन लॉक करें',
  noUserRemembered: 'इस स्क्रीन पर कोई यूज़र सेव नहीं है। लॉगआउट करके दोबारा लॉगिन करें।',
  mpinNotAccepted: 'MPIN गलत है। दोबारा कोशिश करें।',
  tooManyAttempts: 'कई बार गलत MPIN। लॉगआउट करके दोबारा लॉगिन करें।',

  /* ------------------------------------------------------------ station */
  chooseStation: 'इस स्क्रीन का स्टेशन चुनें',
  chooseStationHint: 'चुनाव याद रखा जाएगा — अगली बार यह स्क्रीन सीधे वहीं खुलेगी।',
  counterDisplay: 'काउंटर स्क्रीन',
  kitchenDisplay: 'किचन स्क्रीन',
  customerDisplay: 'ग्राहक स्क्रीन (CDS)',
  noCounters: 'कोई काउंटर सेट नहीं है।',
  noKitchenGroups: 'कोई किचन ग्रुप सेट नहीं है।',
  stationsFailed: 'स्टेशन लोड नहीं हो सके। कनेक्शन जाँच लें।',
  changeStation: 'स्टेशन बदलें',

  /* -------------------------------------------------------------- board */
  serviceKds: 'सर्विस KDS',
  kitchenBoardSubtitle: 'किचन स्क्रीन — सिर्फ़ देखने के लिए, सर्व काउंटर करता है',
  loadingBoard: 'बोर्ड लोड हो रहा है…',
  boardLoadFailed: 'बोर्ड लोड नहीं हो सका।',
  nothingQueued: 'कोई ऑर्डर बाकी नहीं। काउंटर खाली है।',
  nothingForKitchen: 'इस किचन के लिए अभी कुछ नहीं है।',
  starting: 'शुरू हो रहा है…',
  cannotReach: 'काउंटर सिस्टम से कनेक्ट नहीं हो पा रहा',
  retryingSoon: 'कुछ सेकंड में दोबारा कोशिश हो रही है…',

  /* -------------------------------------------------------------- chips */
  chipOrders: 'ऑर्डर',
  chipItems: 'आइटम',
  chipServedToday: 'आज सर्व',
  chipAvg: 'औसत',
  chipLate: 'लेट',

  /* --------------------------------------------------------- order card */
  unserved: 'बाकी',
  served: 'सर्व हो गया',
  gotIt: 'देख लिया',
  markServed: 'सर्व करें',
  markUnserved: 'सर्व नहीं हुआ — वापस लाएँ',
  serveAll: 'सब सर्व करें',
  exchange: 'बदलें…',
  unservedCount: (n: number) => `${n} बाकी`,
  newOrder: 'नया',
  overdue: 'समय निकल गया',
  dueIn: (time: string) => `${time} में देना है`,

  /* -------------------------------------------------------------- tabs */
  tabMyOrders: 'मेरे ऑर्डर',
  tabQueue: 'क़तार',
  tabMenuItems: 'मेन्यू आइटम',
  tabCompleted: 'पूरे हुए',

  /* -------------------------------------------------------------- queue */
  queue: 'क़तार',
  queueItems: (n: number) => `${n} आइटम`,
  colSn: 'क्र.',
  colItemName: 'आइटम का नाम',
  colQty: 'मात्रा',
  colInHand: 'बचा है',
  nothingOutstanding: 'कुछ बाकी नहीं है।',
  smallerText: 'अक्षर छोटे करें',
  biggerText: 'अक्षर बड़े करें',
  resizeQueue: 'क़तार का आकार बदलें',

  /* --------------------------------------------------------- menu items */
  searchStationMenu: 'इस स्टेशन का मेन्यू खोजें…',
  noDishesMatch: 'कोई आइटम नहीं मिला।',
  loadingMenuFile: 'मेन्यू लोड हो रहा है…',
  menuFileFailed: 'मेन्यू लोड नहीं हो सका।',
  available: 'उपलब्ध',
  finished: 'खत्म',
  finishedHint: 'खत्म लगाएँ — शिफ्ट बदलने तक मेन्यू बोर्ड से हट जाएगा',
  putBackHint: 'वापस लाएँ — मेन्यू बोर्ड पर भी दिखने लगेगा',
  rename: 'नाम बदलें',
  renameOnThisScreen: 'सिर्फ़ इस स्क्रीन पर नाम बदलें',
  backToMasterName: 'असली नाम पर लौटें',
  setQty: 'मात्रा डालें',
  qtyInHand: 'मात्रा जो पास है',
  registerQty: 'यह मात्रा दर्ज करें',
  left: 'बचा',
  of: 'में से',
  sold: 'बिका',
  masterName: 'असली नाम',
  itemsCount: (n: number) => `${n} आइटम`,
  changesStayHere: 'बदलाव सिर्फ़ इस स्टेशन पर',
  morningShift: 'सुबह की शिफ्ट',
  eveningShift: 'शाम की शिफ्ट',

  /* --------------------------------------------------------- completed */
  loadingServed: 'सर्व किए आइटम लोड हो रहे हैं…',
  servedLoadFailed: 'सर्व किए आइटम लोड नहीं हो सके।',
  nothingServedYet: 'इस स्टेशन पर अभी कुछ सर्व नहीं हुआ।',
  revert: 'वापस लाएँ',
  itemsServed: (n: number) => `${n} आइटम`,

  /* ---------------------------------------------------------- settings */
  displaySettings: 'स्क्रीन सेटिंग',
  background: 'बैकग्राउंड',
  skinLight: 'हल्का',
  skinDark: 'गहरा',
  skinSystem: 'सिस्टम',
  textSize: 'अक्षर का आकार',
  densityCompact: 'छोटा',
  densityDefault: 'सामान्य',
  densityLight: 'बड़ा',
  cardSize: 'कार्ड का आकार',
  outOfStationDetection: 'काउंटर पर नहीं — अपने आप पता लगाएँ',
  off: 'बंद',
  minutesShort: (n: number) => `${n} मिनट`,
  stepAwayNow: 'अभी काउंटर से हट रहे हैं',
  backAtStation: 'काउंटर पर वापस',

  /* ---------------------------------------------------------- language */
  language: 'भाषा',
  languageHindi: 'हिन्दी',
  languageEnglish: 'English',
  switchToEnglish: 'English में देखें',
  switchToHindi: 'हिन्दी में देखें',

  /* ------------------------------------------------------ out of station */
  away: 'काउंटर पर नहीं',
  atStation: 'काउंटर पर',
  awayBanner: 'काउंटर पर कोई नहीं — ऑर्डर आते रहेंगे और अलार्म बजता रहेगा',
  imBack: 'मैं आ गया',
  awayToggleOn: 'काउंटर से हट रहे हैं — ऐसा दर्ज करें',
  awayToggleOff: 'काउंटर पर वापस दर्ज करें',

  /* -------------------------------------------------------- exchange */
  exchangeTitle: 'ऑर्डर बदलें',
  exchangeLinesToReturn: 'जो आइटम वापस हो रहे हैं',
  exchangeAdditions: 'जो आइटम बदले में देंगे',
  exchangeSearch: 'आइटम खोजें…',
  exchangeValue: 'वापस हुए आइटम की कीमत',
  exchangeMatch: 'कीमत बराबर है',
  exchangeOff: 'कीमत बराबर नहीं है',
  exchangeApply: 'बदल दें',
  exchangeFailed: 'बदलाव नहीं हो सका।',

  /* ----------------------------------------------------- celebration */
  boardClear: 'सारे ऑर्डर पूरे हो गए',

  /* ------------------------------------------------------------- chat */
  chatTitle: 'ऑफ़िस से बातचीत',
  chatSubtitle: 'एडमिन और इस काउंटर के बीच',
  chatOpen: 'मैसेज खोलें',
  chatMinimize: 'छोटा करें',
  chatPlaceholder: 'यहाँ मैसेज लिखें…',
  chatSend: 'भेजें',
  chatSending: 'भेजा जा रहा है…',
  chatSendFailed: 'मैसेज नहीं गया। दोबारा कोशिश करें।',
  chatEmpty: 'अभी कोई मैसेज नहीं है।',
  chatLoading: 'मैसेज लोड हो रहे हैं…',
  chatLoadFailed: 'मैसेज लोड नहीं हो सके।',
  chatFromAdmin: 'ऑफ़िस',
  chatFromCounter: 'काउंटर',
  chatUnread: (n: number) => `${n} नए मैसेज`,
  chatBellRang: 'ऑफ़िस से घंटी बज रही है',
  chatBellDismiss: 'देख लिया',
  chatAnswer: 'सुन लिया',
  chatAnswerHint: 'घंटी बंद करने के लिए हरा बटन दबाएँ',
  chatTyping: 'ऑफ़िस लिख रहा है…',
  chatResize: 'खिड़की का आकार बदलें',
  chatDropOrder: 'ऑर्डर यहाँ छोड़ें — मैसेज उसी के बारे में जाएगा',
  chatRemoveOrder: 'ऑर्डर हटाएँ',
  chatDragHint: 'ऑर्डर को यहाँ खींच कर लाएँ',
  chatAboutOrder: (orderNumber: string) => `ऑर्डर #${orderNumber} के बारे में`,
  chatShowOrder: 'ऑर्डर देखें',
  chatOrderTagged: 'इस ऑर्डर पर मैसेज है — देखने के लिए दबाएँ',
  chatOnOrder: 'मैसेज',
  chatUnreadShort: (n: number) => `${n} नया`,
  chatOpenForOrder: 'मैसेज पढ़ें',
  chatTranslated: 'हिन्दी में',
  chatShowOriginal: 'मूल मैसेज देखें',
  chatShowTranslated: 'हिन्दी में देखें',
  chatOffline: 'कनेक्शन नहीं है — मैसेज बाद में जाएगा',
  chatJustNow: 'अभी',
  chatAutoTranslate: 'हिन्दी में अपने आप',
  chatAutoTranslateOn: 'हर मैसेज अपने आप हिन्दी में दिखेगा',
  chatAutoTranslateOff: 'मैसेज जैसा आया वैसा दिखेगा',
  chatTranslating: 'हिन्दी में बदला जा रहा है…',

  /* ------------------------------------------------------------- cds */
  welcome: 'पधारिए!',
  thankYou: 'आपके ऑर्डर के लिए धन्यवाद',
  yourOrder: 'आपका ऑर्डर',
  billNo: (n: string) => `बिल #${n}`,
  runningTotal: 'अब तक कुल',
  toPay: 'देना है',
  subtotal: 'कुल',
  discount: 'छूट',
  tax: 'टैक्स',
  itemsAppearHere: 'जैसे-जैसे आइटम जुड़ेंगे यहाँ दिखेंगे।',
  scanToPay: 'पेमेंट के लिए स्कैन करें · UPI',
  amount: 'रकम',
  anyUpiApp: 'किसी भी UPI ऐप से',
  billSettled: 'बिल पूरा हुआ',
  collectReceipt: 'धन्यवाद, अपनी रसीद ले लें',
  stepUpToCounter: 'कृपया काउंटर पर आइए।',
  billLoadFailed: 'बिल लोड नहीं हो सका।',
  betweenBills: 'राधे राधे',
};

/** The shape both languages must satisfy. A missing key fails the build, not the shift. */
export type Dictionary = typeof hi;

const en: Dictionary = {
  /* ------------------------------------------------------------------ common */
  loading: 'Loading…',
  cancel: 'Cancel',
  save: 'Save',
  close: 'Close',
  retry: 'Try again',

  /* ------------------------------------------------------------- sign in */
  appName: 'Service KDS',
  staffSignIn: 'Staff sign in',
  username: 'Username',
  password: 'Password',
  signIn: 'Sign in',
  continue: 'Continue',
  useMpin: 'Sign in with MPIN',
  usePassword: 'Sign in with password',
  signingInAs: 'Signing in as',
  signOut: 'Sign out',
  signOutInstead: 'Sign out instead',
  signInFailed: 'Could not sign in. Check the connection.',
  mpinRejected: 'That MPIN is wrong. Try again or sign in with your password.',
  mpinLocked: 'Too many wrong MPINs. Use your password now.',
  deleteDigit: 'Delete a digit',
  back: 'Back',

  /* --------------------------------------------------------------- lock */
  screenLocked: 'Screen locked',
  tapMpinToUnlock: 'Enter your MPIN to open the board',
  lockScreen: 'Lock the screen',
  noUserRemembered: 'No user is saved on this screen. Sign out and sign in again.',
  mpinNotAccepted: 'That MPIN is wrong. Try again.',
  tooManyAttempts: 'Too many wrong MPINs. Sign out and sign in again.',

  /* ------------------------------------------------------------ station */
  chooseStation: 'Choose this screen’s station',
  chooseStationHint: 'The choice is remembered — next time this screen opens straight there.',
  counterDisplay: 'Counter screen',
  kitchenDisplay: 'Kitchen screen',
  customerDisplay: 'Customer screen (CDS)',
  noCounters: 'No counters are set up.',
  noKitchenGroups: 'No kitchen groups are set up.',
  stationsFailed: 'Could not load the stations. Check the connection.',
  changeStation: 'Change station',

  /* -------------------------------------------------------------- board */
  serviceKds: 'Service KDS',
  kitchenBoardSubtitle: 'Kitchen screen — view only, the counter serves',
  loadingBoard: 'Loading the board…',
  boardLoadFailed: 'Could not load the board.',
  nothingQueued: 'Nothing left to serve. The counter is clear.',
  nothingForKitchen: 'Nothing for this kitchen right now.',
  starting: 'Starting…',
  cannotReach: 'Cannot reach the counter system',
  retryingSoon: 'Trying again in a few seconds…',

  /* -------------------------------------------------------------- chips */
  chipOrders: 'Orders',
  chipItems: 'Items',
  chipServedToday: 'Served today',
  chipAvg: 'Average',
  chipLate: 'Late',

  /* --------------------------------------------------------- order card */
  unserved: 'Pending',
  served: 'Served',
  gotIt: 'Got it',
  markServed: 'Serve',
  markUnserved: 'Not served — bring it back',
  serveAll: 'Serve all',
  exchange: 'Exchange…',
  unservedCount: (n: number) => `${n} pending`,
  newOrder: 'New',
  overdue: 'Overdue',
  dueIn: (time: string) => `Due in ${time}`,

  /* -------------------------------------------------------------- tabs */
  tabMyOrders: 'My orders',
  tabQueue: 'Queue',
  tabMenuItems: 'Menu items',
  tabCompleted: 'Completed',

  /* -------------------------------------------------------------- queue */
  queue: 'Queue',
  queueItems: (n: number) => `${n} items`,
  colSn: 'S.No.',
  colItemName: 'Item name',
  colQty: 'Qty',
  colInHand: 'In hand',
  nothingOutstanding: 'Nothing outstanding.',
  smallerText: 'Smaller text',
  biggerText: 'Bigger text',
  resizeQueue: 'Resize the queue',

  /* --------------------------------------------------------- menu items */
  searchStationMenu: 'Search this station’s menu…',
  noDishesMatch: 'No items found.',
  loadingMenuFile: 'Loading the menu…',
  menuFileFailed: 'Could not load the menu.',
  available: 'Available',
  finished: 'Finished',
  finishedHint: 'Mark finished — it leaves the menu board until the shift turns over',
  putBackHint: 'Put it back — it shows on the menu board again',
  rename: 'Rename',
  renameOnThisScreen: 'Rename on this screen only',
  backToMasterName: 'Back to the real name',
  setQty: 'Set the quantity',
  qtyInHand: 'Quantity in hand',
  registerQty: 'Register this quantity',
  left: 'left',
  of: 'of',
  sold: 'sold',
  masterName: 'Real name',
  itemsCount: (n: number) => `${n} items`,
  changesStayHere: 'Changes stay on this station',
  morningShift: 'Morning shift',
  eveningShift: 'Evening shift',

  /* --------------------------------------------------------- completed */
  loadingServed: 'Loading served items…',
  servedLoadFailed: 'Could not load the served items.',
  nothingServedYet: 'Nothing served at this station yet.',
  revert: 'Bring it back',
  itemsServed: (n: number) => `${n} items`,

  /* ---------------------------------------------------------- settings */
  displaySettings: 'Screen settings',
  background: 'Background',
  skinLight: 'Light',
  skinDark: 'Dark',
  skinSystem: 'System',
  textSize: 'Text size',
  densityCompact: 'Small',
  densityDefault: 'Normal',
  densityLight: 'Large',
  cardSize: 'Card size',
  outOfStationDetection: 'Away from the counter — detect it automatically',
  off: 'Off',
  minutesShort: (n: number) => `${n} min`,
  stepAwayNow: 'Stepping away now',
  backAtStation: 'Back at the counter',

  /* ---------------------------------------------------------- language */
  language: 'Language',
  languageHindi: 'हिन्दी',
  languageEnglish: 'English',
  switchToEnglish: 'View in English',
  switchToHindi: 'View in Hindi',

  /* ------------------------------------------------------ out of station */
  away: 'Away',
  atStation: 'At the counter',
  awayBanner: 'Nobody at the counter — orders keep arriving and the alarm keeps ringing',
  imBack: 'I’m back',
  awayToggleOn: 'Stepping away — record it',
  awayToggleOff: 'Record being back at the counter',

  /* -------------------------------------------------------- exchange */
  exchangeTitle: 'Exchange the order',
  exchangeLinesToReturn: 'Items coming back',
  exchangeAdditions: 'Items going out instead',
  exchangeSearch: 'Search items…',
  exchangeValue: 'Value of the returned items',
  exchangeMatch: 'The value matches',
  exchangeOff: 'The value does not match',
  exchangeApply: 'Exchange',
  exchangeFailed: 'Could not exchange.',

  /* ----------------------------------------------------- celebration */
  boardClear: 'Every order is done',

  /* ------------------------------------------------------------- chat */
  chatTitle: 'Office chat',
  chatSubtitle: 'Between the admin and this counter',
  chatOpen: 'Open messages',
  chatMinimize: 'Minimise',
  chatPlaceholder: 'Write a message…',
  chatSend: 'Send',
  chatSending: 'Sending…',
  chatSendFailed: 'The message did not go. Try again.',
  chatEmpty: 'No messages yet.',
  chatLoading: 'Loading messages…',
  chatLoadFailed: 'Could not load the messages.',
  chatFromAdmin: 'Office',
  chatFromCounter: 'Counter',
  chatUnread: (n: number) => `${n} new messages`,
  chatBellRang: 'The office is ringing',
  chatBellDismiss: 'Got it',
  chatAnswer: 'Answer',
  chatAnswerHint: 'Press the green button to stop the ringing',
  chatTyping: 'The office is typing…',
  chatResize: 'Resize the window',
  chatDropOrder: 'Drop the order here — the message goes with it',
  chatRemoveOrder: 'Remove the order',
  chatDragHint: 'Drag an order here',
  chatAboutOrder: (orderNumber: string) => `About order #${orderNumber}`,
  chatShowOrder: 'Show the order',
  chatOrderTagged: 'There is a message about this order — tap to read it',
  chatOnOrder: 'Message',
  chatUnreadShort: (n: number) => `${n} new`,
  chatOpenForOrder: 'Read the message',
  chatTranslated: 'In Hindi',
  chatShowOriginal: 'Show the original',
  chatShowTranslated: 'Show in Hindi',
  chatOffline: 'No connection — the message will go later',
  chatJustNow: 'just now',
  chatAutoTranslate: 'Auto Hindi',
  chatAutoTranslateOn: 'Every message is shown in Hindi automatically',
  chatAutoTranslateOff: 'Messages are shown as they were written',
  chatTranslating: 'Translating…',

  /* ------------------------------------------------------------- cds */
  welcome: 'Welcome!',
  thankYou: 'Thank you for your order',
  yourOrder: 'Your order',
  billNo: (n: string) => `Bill #${n}`,
  runningTotal: 'Running total',
  toPay: 'To pay',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  itemsAppearHere: 'Items appear here as they are added.',
  scanToPay: 'Scan to pay · UPI',
  amount: 'Amount',
  anyUpiApp: 'With any UPI app',
  billSettled: 'Bill settled',
  collectReceipt: 'Thank you, please collect your receipt',
  stepUpToCounter: 'Please step up to the counter.',
  billLoadFailed: 'Could not load the bill.',
  betweenBills: 'राधे राधे',
};

export type KdsLang = 'hi' | 'en';

const DICTIONARIES: Record<KdsLang, Dictionary> = { hi, en };

/**
 * The all-clear phrases, in the order given by the front desk. One is picked at random each
 * time the board runs dry. Deliberately not translated — these are devotional phrases the
 * counter says out loud, not interface copy, and an English rendering of them would be wrong
 * in both languages.
 */
export const CELEBRATION_PHRASES = [
  'श्रीमत् सद्गुरु सरकार की जय',
  'राधे राधे',
  'हरि बोल',
  'जय राधे जय कृष्ण',
  'हर हर महादेव',
  'जय श्री राम',
] as const;

/* ------------------------------------------------------------------ preference */

const LANG_KEY = 'menuboard.kds.lang';

/**
 * Device-level, not per station: the sign-in page, the station chooser and the lock screen all
 * render before any station exists, and they are exactly the screens a new person meets first.
 */
export function readLang(): KdsLang {
  return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'hi';
}

function saveLang(lang: KdsLang): void {
  localStorage.setItem(LANG_KEY, lang);
}

interface LanguageApi {
  lang: KdsLang;
  t: Dictionary;
  setLang: (lang: KdsLang) => void;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageApi | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<KdsLang>(readLang);

  const setLang = useCallback((next: KdsLang): void => {
    saveLang(next);
    setLangState(next);
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<LanguageApi>(
    () => ({
      lang,
      t: DICTIONARIES[lang],
      setLang,
      toggle: () => setLang(lang === 'hi' ? 'en' : 'hi'),
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function useLanguageApi(): LanguageApi {
  const value = useContext(LanguageContext);
  if (value === null) {
    throw new Error('useT/useLang used outside <LanguageProvider>');
  }
  return value;
}

/** The strings, in whichever language the screen is set to. */
export function useT(): Dictionary {
  return useLanguageApi().t;
}

/** The language itself, for the flag switch and for choosing a dish's Hindi name. */
export function useLang(): Omit<LanguageApi, 't'> {
  const { lang, setLang, toggle } = useLanguageApi();
  return { lang, setLang, toggle };
}

/**
 * A dish's name in the chosen language. Hindi only when there is a Hindi name to show —
 * falling back to the English name is always better than an empty label on a wall screen.
 */
export function pickName(lang: KdsLang, name: string, nameHi: string | null | undefined): string {
  if (lang !== 'hi') return name;
  const hindi = nameHi?.trim() ?? '';
  return hindi === '' ? name : hindi;
}
