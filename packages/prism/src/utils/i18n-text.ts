/**
 * i18n-text — generic locale resolution for bilingual / multilingual
 * JSONB payloads stored on backend DTOs.
 *
 * Design goals:
 *
 *  - Zero hard-coded locale strings. Caller passes the viewer locale
 *    and (optionally) a fallback order; the helper does the rest.
 *    Adding a new locale to the platform is just config, not a code
 *    edit in every consumer.
 *  - Locale-agnostic API so it can serve marketplace categories,
 *    achievement titles, paysys coin names, future post translations
 *    — anywhere a `{ [lang]: string }` bag is stored.
 *  - O(1) in the happy path (direct map access) with a deterministic
 *    fallback walk.
 *
 * @module @omnitron-dev/prism/utils/i18n-text
 */

/** A bag of language-keyed strings. Keys are RFC 5646 language codes
 * (or just `'en'`, `'ru'` for simple two-locale platforms). */
export type I18nText = Record<string, string | undefined>;

/** Object shape that carries both a localised bag and a legacy
 * scalar field as final fallback — the canonical wire format for
 * DAOS categories, achievements etc. */
export interface I18nResolvable {
  /** Bilingual / multilingual bag. */
  nameI18n?: I18nText | null;
  /** Last-resort legacy fallback. The backend keeps this populated
   * even after migrating to JSONB so single-locale consumers keep
   * working without an immediate refactor. */
  name?: string | null;
}

/**
 * Resolve a `{ nameI18n, name }` object to the viewer-preferred
 * locale, walking through optional fallbacks before bottoming out
 * on the legacy scalar.
 *
 * @example
 * ```ts
 * const label = resolveI18n(category, 'ru', ['en']);
 * // → category.nameI18n.ru
 * //   ?? category.nameI18n.en
 * //   ?? category.name
 * //   ?? ''
 * ```
 *
 * @param obj      The resolvable record (e.g. a category DTO).
 * @param lang     Viewer's preferred language code.
 * @param fallback Ordered list of secondary languages to try before
 *                 the legacy scalar. Defaults to `['en']`.
 * @param field    Override the I18nText key (defaults to `nameI18n`)
 *                 + the legacy scalar key (defaults to `name`).
 *                 Useful for `descriptionI18n` / `description`.
 */
export function resolveI18n(
  obj: object | null | undefined,
  lang: string,
  fallback: readonly string[] = ['en'],
  field: { bag?: string; scalar?: string } = {},
): string {
  if (!obj) return '';
  const bagKey = field.bag ?? 'nameI18n';
  const scalarKey = field.scalar ?? 'name';
  const record = obj as Record<string, unknown>;
  const bag = (record[bagKey] ?? null) as Record<string, unknown> | null;

  if (bag) {
    const direct = typeof bag[lang] === 'string' ? (bag[lang] as string).trim() : '';
    if (direct) return direct;
    for (const f of fallback) {
      const v = typeof bag[f] === 'string' ? (bag[f] as string).trim() : '';
      if (v) return v;
    }
  }

  const legacy = record[scalarKey];
  if (typeof legacy === 'string' && legacy.trim()) return legacy;

  return '';
}

/**
 * Build a stable searchable haystack from an i18n object — all
 * known translations concatenated lower-case so a single `.includes`
 * check matches against any locale.
 *
 * Useful inside `Autocomplete.filterOptions` to make EN-only users
 * find RU-only entries.
 */
export function i18nHaystack(
  bag: object | null | undefined,
  extra: readonly string[] = [],
): string {
  if (!bag) return extra.join(' ').toLowerCase();
  const values = Object.values(bag as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string');
  return [...values, ...extra].join(' ').toLowerCase();
}
