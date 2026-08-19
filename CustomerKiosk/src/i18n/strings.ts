/**
 * Two languages, one file.
 *
 * Every guest-facing word lives here — a screen never carries an English literal, because the
 * hall is bilingual and a half-translated kiosk reads worse than a monolingual one. Dish names
 * come from the Menu Master's own `nameHi` columns, not from this file.
 *
 * There are two tables and three modes: `BOTH` renders each label twice from the same two
 * tables rather than needing a third, which is why nothing here is a pre-joined string.
 */

const en = {
  'menu.tapToAdd': 'Tap a dish to add it',
  'menu.searchNothing': 'Nothing on the menu right now',
  'menu.searchNothingBody': 'The kitchen has not published any dishes for this counter yet.',
  'menu.loading': 'Laying out the menu',
  'menu.unavailable': 'Finished for today',
  'menu.chooseSize': 'Choose a size',
  'menu.from': 'from',
  'menu.pureVeg': 'Pure vegetarian',
  'menu.language': 'Language',
  'menu.all': 'Everything',
  'menu.sections': 'Sections of the menu',
  'menu.sectionEmpty': 'Nothing left in this section',
  'menu.sectionEmptyBody': 'Tap Everything to see the rest of the menu.',

  'cart.title': 'Your order',
  'cart.subtitle': 'Add more, or pay and collect your token.',
  'cart.empty': 'Your order is empty',
  'cart.emptyBody': 'Add a dish from the menu to begin.',
  'cart.addMore': 'Add more dishes',
  'cart.itemCount_one': '{count} item',
  'cart.itemCount_other': '{count} items',
  'cart.remove': 'Remove',
  'cart.taxNote': 'Prices include applicable GST. The bill shows the split.',
  'cart.payNow': 'Pay by UPI',
  'cart.review': 'Review order',
  'cart.total': 'Total',

  'nudge.drinksTitle': 'Something to drink?',
  'nudge.drinksBody': 'Most guests add one. Tap to include it — or carry on.',
  'nudge.sweetsTitle': 'A sweet to finish?',
  'nudge.sweetsBody': 'Freshly made today. Tap to include it — or carry on.',
  'nudge.skip': 'No thanks, continue',
  'nudge.continue': 'Continue to payment',

  'eta.ready': 'Ready in about {minutes} min',
  'eta.by': 'around {clock}',
  'eta.unknown': 'The counter will call your token',

  'pay.title': 'Scan to pay',
  'pay.body': 'Open any UPI app, scan this code, and pay the exact amount.',
  'pay.amount': 'Amount to pay',
  'pay.waiting': 'Waiting for your payment',
  'pay.demoBanner': 'Demonstration mode — no payment gateway is connected yet.',
  'pay.demoConfirm': 'Mark payment received (demo)',
  'pay.cancel': 'Cancel and go back',
  'pay.settling': 'Confirming your payment',
  'pay.placing': 'Sending your order to the kitchen',
  'pay.failed': 'That did not go through',
  'pay.retry': 'Try again',

  'done.thanks': 'Thank you',
  'done.blessing': 'Your prasad is being prepared.',
  'done.token': 'Token',
  'done.collect': 'Collect at the counter when your token is called.',
  'done.newOrder': 'Start a new order',
  'done.returning': 'Returning to the menu in {seconds}s',

  'print.working': 'Printing your GST bill',
  'print.done': 'Bill printed',
  'print.failed': 'The bill did not print',
  'print.again': 'Print again',

  'wa.offer': 'Want the bill on WhatsApp?',
  'wa.offerBody': 'Enter your mobile number and we will send the GST bill to it.',
  'wa.number': 'Mobile number',
  'wa.send': 'Send my bill',
  'wa.skip': 'No thanks',
  'wa.sending': 'Sending your bill',
  'wa.sent': 'Sent to {phone}',
  'wa.failed': 'The bill could not be sent',
  'wa.clear': 'Clear',
  'wa.delete': 'Delete last digit',

  'idle.title': 'Still ordering?',
  'idle.body': 'Your order will be cleared for the next guest in {seconds}s.',
  'idle.continue': "I'm still here",
  'idle.clear': 'Clear and start again',

  'setup.title': 'Which stand is this?',
  'setup.body':
    'A staff member signs in once and picks the stand. Everything about it is set in the Admin Portal.',
  'setup.identifier': 'Staff username, phone or email',
  'setup.password': 'Password',
  'setup.signIn': 'Sign in',
  'setup.signingIn': 'Signing in',
  'setup.pick': 'Registered stands',
  'setup.pickBody': 'Tap the stand this tablet is standing at.',
  'setup.noDevices': 'No kiosk has been registered yet.',
  'setup.noDevicesBody':
    'Open the Admin Portal, go to Kiosks, and register this stand. It will appear here within a minute.',
  'setup.launch': 'Start serving',
  'setup.exit': 'Device settings',
  'setup.close': 'Close',
  'setup.reload': 'Look again',
  'setup.printer': 'Receipt printer',
  'setup.printerUsb': 'Pair a USB printer',
  'setup.printerUsbPaired': 'USB printer paired',
  'setup.printerUsbUnsupported': 'This browser cannot reach a USB printer',
  'setup.printerNetwork': 'Counter printer on the network',
  'setup.printerBody':
    'A USB printer is paired here because a browser will only hand a device to a gesture made at the machine it is plugged into. Which route this stand prefers is set in the Admin Portal.',
  'setup.printerTest': 'Print a test slip',
  'setup.managed': 'Set in the Admin Portal',
  'setup.managedBody':
    'The menu, the payee, the skin, the language, the GSTIN and the address on the bill are all set once in the Admin Portal and followed by every kiosk.',
  'setup.unknownDevice': 'This tablet is set to a stand that no longer exists. Pick it again.',

  'error.generic': 'Something went wrong. Please ask a staff member for help.',
  'error.offline': 'The counter system is unreachable. Please ask a staff member for help.',
  'error.retry': 'Try again',
} as const;

export type StringKey = keyof typeof en;

const hi: Record<StringKey, string> = {
  'menu.tapToAdd': 'जोड़ने के लिए व्यंजन पर स्पर्श करें',
  'menu.searchNothing': 'अभी कोई व्यंजन उपलब्ध नहीं',
  'menu.searchNothingBody': 'इस काउंटर के लिए अभी कोई मेन्यू प्रकाशित नहीं हुआ है।',
  'menu.loading': 'मेन्यू तैयार हो रहा है',
  'menu.unavailable': 'आज के लिए समाप्त',
  'menu.chooseSize': 'आकार चुनें',
  'menu.from': 'से',
  'menu.pureVeg': 'शुद्ध शाकाहारी',
  'menu.language': 'भाषा',
  'menu.all': 'सब कुछ',
  'menu.sections': 'मेन्यू के विभाग',
  'menu.sectionEmpty': 'इस विभाग में अभी कुछ नहीं',
  'menu.sectionEmptyBody': 'पूरा मेन्यू देखने के लिए “सब कुछ” चुनें।',

  'cart.title': 'आपका ऑर्डर',
  'cart.subtitle': 'और जोड़ें, या भुगतान करके टोकन लें।',
  'cart.empty': 'आपका ऑर्डर खाली है',
  'cart.emptyBody': 'शुरू करने के लिए मेन्यू से कोई व्यंजन जोड़ें।',
  'cart.addMore': 'और व्यंजन जोड़ें',
  'cart.itemCount_one': '{count} वस्तु',
  'cart.itemCount_other': '{count} वस्तुएँ',
  'cart.remove': 'हटाएँ',
  'cart.taxNote': 'मूल्य में जीएसटी सम्मिलित है। बिल में विवरण दिया गया है।',
  'cart.payNow': 'यूपीआई से भुगतान करें',
  'cart.review': 'ऑर्डर देखें',
  'cart.total': 'कुल',

  'nudge.drinksTitle': 'साथ में कुछ पीने के लिए?',
  'nudge.drinksBody': 'अधिकांश अतिथि एक अवश्य लेते हैं। जोड़ने के लिए स्पर्श करें।',
  'nudge.sweetsTitle': 'अंत में कुछ मीठा?',
  'nudge.sweetsBody': 'आज ही बना हुआ। जोड़ने के लिए स्पर्श करें।',
  'nudge.skip': 'नहीं, आगे बढ़ें',
  'nudge.continue': 'भुगतान की ओर बढ़ें',

  'eta.ready': 'लगभग {minutes} मिनट में तैयार',
  'eta.by': 'लगभग {clock} तक',
  'eta.unknown': 'काउंटर आपका टोकन पुकारेगा',

  'pay.title': 'भुगतान हेतु स्कैन करें',
  'pay.body': 'कोई भी यूपीआई ऐप खोलें, यह कोड स्कैन करें और पूरी राशि का भुगतान करें।',
  'pay.amount': 'देय राशि',
  'pay.waiting': 'आपके भुगतान की प्रतीक्षा',
  'pay.demoBanner': 'प्रदर्शन मोड — अभी कोई भुगतान गेटवे जुड़ा नहीं है।',
  'pay.demoConfirm': 'भुगतान प्राप्त दर्ज करें (डेमो)',
  'pay.cancel': 'रद्द करें और वापस जाएँ',
  'pay.settling': 'भुगतान की पुष्टि हो रही है',
  'pay.placing': 'आपका ऑर्डर रसोई को भेजा जा रहा है',
  'pay.failed': 'भुगतान पूरा नहीं हो सका',
  'pay.retry': 'पुनः प्रयास करें',

  'done.thanks': 'धन्यवाद',
  'done.blessing': 'आपका प्रसाद तैयार किया जा रहा है।',
  'done.token': 'टोकन',
  'done.collect': 'टोकन पुकारे जाने पर काउंटर से प्राप्त करें।',
  'done.newOrder': 'नया ऑर्डर आरंभ करें',
  'done.returning': '{seconds} सेकंड में मेन्यू पर वापस',

  'print.working': 'आपका जीएसटी बिल छप रहा है',
  'print.done': 'बिल छप गया',
  'print.failed': 'बिल नहीं छप सका',
  'print.again': 'पुनः छापें',

  'wa.offer': 'बिल व्हाट्सएप पर चाहिए?',
  'wa.offerBody': 'अपना मोबाइल नंबर लिखें, जीएसटी बिल उसी पर भेज देंगे।',
  'wa.number': 'मोबाइल नंबर',
  'wa.send': 'मेरा बिल भेजें',
  'wa.skip': 'नहीं, धन्यवाद',
  'wa.sending': 'आपका बिल भेजा जा रहा है',
  'wa.sent': '{phone} पर भेज दिया',
  'wa.failed': 'बिल नहीं भेजा जा सका',
  'wa.clear': 'साफ़ करें',
  'wa.delete': 'अंतिम अंक मिटाएँ',

  'idle.title': 'क्या आप अभी ऑर्डर कर रहे हैं?',
  'idle.body': 'अगले अतिथि के लिए आपका ऑर्डर {seconds} सेकंड में हटा दिया जाएगा।',
  'idle.continue': 'मैं यहीं हूँ',
  'idle.clear': 'हटाकर पुनः आरंभ करें',

  'setup.title': 'यह कौन-सा स्टैंड है?',
  'setup.body':
    'कर्मचारी एक बार साइन इन करके स्टैंड चुनते हैं। बाकी सब एडमिन पोर्टल में तय होता है।',
  'setup.identifier': 'कर्मचारी उपयोगकर्ता नाम, फ़ोन या ईमेल',
  'setup.password': 'पासवर्ड',
  'setup.signIn': 'साइन इन',
  'setup.signingIn': 'साइन इन हो रहा है',
  'setup.pick': 'पंजीकृत स्टैंड',
  'setup.pickBody': 'यह टैबलेट जिस स्टैंड पर है, उसे चुनें।',
  'setup.noDevices': 'अभी कोई कियोस्क पंजीकृत नहीं है।',
  'setup.noDevicesBody':
    'एडमिन पोर्टल में Kiosks खोलकर इस स्टैंड को पंजीकृत करें। यह एक मिनट में यहाँ दिखेगा।',
  'setup.launch': 'सेवा आरंभ करें',
  'setup.exit': 'डिवाइस सेटिंग',
  'setup.close': 'बंद करें',
  'setup.reload': 'पुनः देखें',
  'setup.printer': 'बिल प्रिंटर',
  'setup.printerUsb': 'यूएसबी प्रिंटर जोड़ें',
  'setup.printerUsbPaired': 'यूएसबी प्रिंटर जुड़ा है',
  'setup.printerUsbUnsupported': 'यह ब्राउज़र यूएसबी प्रिंटर तक नहीं पहुँच सकता',
  'setup.printerNetwork': 'नेटवर्क पर काउंटर प्रिंटर',
  'setup.printerBody':
    'यूएसबी प्रिंटर यहीं जोड़ना पड़ता है, क्योंकि ब्राउज़र डिवाइस केवल उसी मशीन पर किए गए स्पर्श को देता है। कौन-सा रास्ता पहले आज़माया जाए, यह एडमिन पोर्टल में तय है।',
  'setup.printerTest': 'परीक्षण पर्ची छापें',
  'setup.managed': 'एडमिन पोर्टल में तय',
  'setup.managedBody':
    'मेन्यू, भुगतान खाता, स्किन, भाषा, जीएसटीआईएन और बिल का पता — सब एडमिन पोर्टल में एक बार तय होते हैं और हर कियोस्क उसी का पालन करता है।',
  'setup.unknownDevice': 'यह टैबलेट जिस स्टैंड पर सेट था वह अब नहीं है। कृपया पुनः चुनें।',

  'error.generic': 'कुछ त्रुटि हुई। कृपया कर्मचारी से सहायता लें।',
  'error.offline': 'काउंटर सिस्टम से संपर्क नहीं हो पा रहा। कृपया कर्मचारी से सहायता लें।',
  'error.retry': 'पुनः प्रयास करें',
};

/** English first, because a mixed queue reads the Latin line for the price and the layout. */
export const STRINGS = { en, hi } as const;

export const LANGUAGE_MODE_LABEL = {
  EN: 'English',
  HI: 'हिंदी',
  BOTH: 'दोनों · Both',
} as const;
