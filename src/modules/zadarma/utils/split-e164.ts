// Splits an E.164-without-plus phone number into its country calling-code and
// subscriber portions. Used by `findPersonIdByClientNumber` to add a country
// guard to the fuzzy "endsWith last 9 digits" pass — without the guard, two
// different-country numbers sharing the last 9 digits collapse onto each
// other, returning the wrong Person.
//
// The prefix table covers Europe + key markets and is intentionally small
// (hand-rolled, ~30 entries) instead of pulling in libphonenumber-js (~100KB).
// Longest prefixes are listed first; the first prefix that matches wins.
//
// When the number does not start with any known prefix we return
// `callingCode: null` and the caller should fall back to the cc-blind match
// (matches the pre-issue-53 behaviour, no regressions).

// Most-specific prefixes (3-digit) before generic (1-digit). Order matters.
const PREFIX_TABLE: readonly string[] = [
  // 3-digit codes (Eastern Europe, Baltics, smaller markets)
  '380', // Ukraine
  '375', // Belarus
  '370', // Lithuania
  '371', // Latvia
  '372', // Estonia
  '373', // Moldova
  '374', // Armenia
  '376', // Andorra
  '377', // Monaco
  '381', // Serbia
  '385', // Croatia
  '386', // Slovenia
  '387', // Bosnia and Herzegovina
  '389', // North Macedonia
  '420', // Czech Republic
  '421', // Slovakia
  '423', // Liechtenstein
  '358', // Finland
  '359', // Bulgaria
  '351', // Portugal
  '352', // Luxembourg
  '353', // Ireland
  '354', // Iceland
  '356', // Malta
  '357', // Cyprus
  '995', // Georgia
  '994', // Azerbaijan
  '998', // Uzbekistan
  '996', // Kyrgyzstan
  '992', // Tajikistan
  // 2-digit codes (most of Western Europe + key markets)
  '30', // Greece
  '31', // Netherlands
  '32', // Belgium
  '33', // France
  '34', // Spain
  '36', // Hungary
  '39', // Italy
  '40', // Romania
  '41', // Switzerland
  '43', // Austria
  '44', // United Kingdom
  '45', // Denmark
  '46', // Sweden
  '47', // Norway
  '48', // Poland
  '49', // Germany
  '51', // Peru
  '52', // Mexico
  '53', // Cuba
  '54', // Argentina
  '55', // Brazil
  '56', // Chile
  '57', // Colombia
  '58', // Venezuela
  '60', // Malaysia
  '61', // Australia
  '62', // Indonesia
  '63', // Philippines
  '64', // New Zealand
  '65', // Singapore
  '66', // Thailand
  '81', // Japan
  '82', // South Korea
  '84', // Vietnam
  '86', // China
  '90', // Turkey
  '91', // India
  '92', // Pakistan
  '93', // Afghanistan
  '94', // Sri Lanka
  '95', // Myanmar
  '98', // Iran
  // 1-digit codes (last because they would otherwise shadow longer matches)
  '7', // Russia / Kazakhstan
  '1', // North America (US/CA)
];

export type SplitE164 = {
  callingCode: string | null;
  subscriber: string;
};

export const splitE164 = (e164NoPlus: string | null | undefined): SplitE164 => {
  if (!e164NoPlus) return { callingCode: null, subscriber: '' };
  const digits = e164NoPlus.replace(/\D+/g, '');
  if (!digits) return { callingCode: null, subscriber: '' };
  for (const prefix of PREFIX_TABLE) {
    if (digits.startsWith(prefix)) {
      return {
        callingCode: prefix,
        subscriber: digits.slice(prefix.length),
      };
    }
  }
  return { callingCode: null, subscriber: digits };
};
