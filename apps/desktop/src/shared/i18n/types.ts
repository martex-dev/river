/** A counted text in one language: a form for each plural category it uses (Intl.PluralRules). */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** One language's texts, by their English text. */
export type Dictionary = Record<string, string | PluralForms>;
