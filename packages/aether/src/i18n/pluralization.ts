/**
 * Pluralization Rules
 *
 * Implements Unicode CLDR plural rules for different languages
 */

import type { PluralForm } from './types.js';

/**
 * Plural rule function
 */
export type PluralRuleFunction = (count: number) => PluralForm;

/**
 * English plural rules (also for many other languages)
 * one: 1
 * other: 0, 2-999...
 */
function englishPlurals(count: number): PluralForm {
  if (count === 1) return 'one';
  return 'other';
}

/**
 * Arabic plural rules
 * zero: 0
 * one: 1
 * two: 2
 * few: 3-10
 * many: 11-99
 * other: 100-999...
 */
function arabicPlurals(count: number): PluralForm {
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  if (count === 2) return 'two';
  if (count >= 3 && count <= 10) return 'few';
  if (count >= 11 && count <= 99) return 'many';
  return 'other';
}

/**
 * Russian plural rules
 * one: 1, 21, 31, 41, 51, 61...
 * few: 2-4, 22-24, 32-34...
 * many: 0, 5-20, 25-30, 35-40...
 * other: 1.5, 2.5...
 */
function russianPlurals(count: number): PluralForm {
  if (count % 1 !== 0) return 'other';

  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

/**
 * Polish plural rules
 * one: 1
 * few: 2-4, 22-24, 32-34...
 * many: 0, 5-21, 25-31...
 * other: 1.5, 2.5...
 */
function polishPlurals(count: number): PluralForm {
  if (count % 1 !== 0) return 'other';
  if (count === 1) return 'one';

  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

/**
 * Czech/Slovak plural rules
 * one: 1
 * few: 2-4
 * many: fractional numbers
 * other: 0, 5-999...
 */
function czechPlurals(count: number): PluralForm {
  if (count === 1) return 'one';
  if (count >= 2 && count <= 4) return 'few';
  if (count % 1 !== 0) return 'many';
  return 'other';
}

/**
 * French plural rules
 * one: 0, 1
 * other: 2-999...
 */
function frenchPlurals(count: number): PluralForm {
  if (count === 0 || count === 1) return 'one';
  return 'other';
}

/**
 * Lithuanian plural rules
 * one: 1, 21, 31, 41...
 * few: 2-9, 22-29, 32-39...
 * many: fractional numbers
 * other: 0, 10-20, 30, 40...
 */
function lithuanianPlurals(count: number): PluralForm {
  if (count % 1 !== 0) return 'many';

  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 9 && (mod100 < 11 || mod100 > 19)) return 'few';
  return 'other';
}

/**
 * Icelandic plural rules
 * one: 1, 21, 31... (but not 11)
 * other: everything else
 */
function icelandicPlurals(count: number): PluralForm {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'one';
  return 'other';
}

/**
 * Japanese/Korean/Chinese plural rules
 * No plural forms - always use "other"
 */
function noPluralPlurals(_count: number): PluralForm {
  return 'other';
}

/**
 * Plural rules map by language code
 */
export const PLURAL_RULES: Record<string, PluralRuleFunction> = {
  // English and similar languages
  en: englishPlurals,
  de: englishPlurals,
  nl: englishPlurals,
  sv: englishPlurals,
  da: englishPlurals,
  no: englishPlurals,
  es: englishPlurals,
  it: englishPlurals,
  pt: englishPlurals,
  el: englishPlurals,
  fi: englishPlurals,
  et: englishPlurals,
  hu: englishPlurals,
  tr: englishPlurals,

  // French and similar
  fr: frenchPlurals,

  // Arabic
  ar: arabicPlurals,

  // Russian and similar
  ru: russianPlurals,
  uk: russianPlurals,
  be: russianPlurals,

  // Polish
  pl: polishPlurals,

  // Czech/Slovak
  cs: czechPlurals,
  sk: czechPlurals,

  // Lithuanian
  lt: lithuanianPlurals,

  // Icelandic
  is: icelandicPlurals,

  // No plural forms
  ja: noPluralPlurals,
  ko: noPluralPlurals,
  zh: noPluralPlurals,
  vi: noPluralPlurals,
  th: noPluralPlurals,
  id: noPluralPlurals,
};

/**
 * Get plural rule function for locale
 */
export function getPluralRule(locale: string): PluralRuleFunction {
  // Try exact match first
  if (PLURAL_RULES[locale]) {
    return PLURAL_RULES[locale];
  }

  // Try language code without region (e.g., 'en' from 'en-US')
  const language = locale.split('-')[0];
  if (language && PLURAL_RULES[language]) {
    return PLURAL_RULES[language];
  }

  // Default to English rules
  return englishPlurals;
}

/**
 * Select plural form from message
 */
export function selectPluralForm(
  count: number,
  forms: Record<string, string>,
  locale: string,
): string {
  const rule = getPluralRule(locale);
  const form = rule(count);

  // Try to find exact form
  if (forms[form]) {
    return forms[form];
  }

  // Fallback to 'other' if available
  if (forms.other) {
    return forms.other;
  }

  // Return first available form as last resort
  const firstKey = Object.keys(forms)[0];
  return firstKey && forms[firstKey] ? forms[firstKey] : '';
}
