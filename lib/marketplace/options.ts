import type { FormCatalogue } from '@/lib/profile/catalogue';
import { pickName } from '@/lib/profile/catalogue';

// The catalogue as the options of the search selects: slug as value, name in the page language.

export type SelectOption = { value: string; label: string };
export type DelegationSelectOption = SelectOption & { governorate: string };

export function toSearchOptions(catalogue: FormCatalogue, locale: string) {
  const governorateSlug = new Map(
    catalogue.governorates.map((g) => [g.id, g.slug]),
  );
  return {
    governorates: catalogue.governorates.map((g) => ({
      value: g.slug,
      label: pickName(g, locale),
    })),
    delegations: catalogue.delegations.flatMap((d) => {
      const governorate = governorateSlug.get(d.governorateId);
      return governorate
        ? [{ value: d.slug, label: pickName(d, locale), governorate }]
        : [];
    }),
    levels: catalogue.levels.map((l) => ({
      value: l.slug,
      label: pickName(l, locale),
    })),
    subjects: catalogue.subjects.map((s) => ({
      value: s.slug,
      label: pickName(s, locale),
    })),
  };
}
