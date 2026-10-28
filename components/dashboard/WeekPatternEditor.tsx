'use client';

import { useLocale, useTranslations } from 'next-intl';
import { inputClass } from '@/components/auth/styles';
import { weekdayName } from '@/lib/dashboard/format';
import type { Rule } from '@/lib/dashboard/schedule';

// The seven weekday rows of the group wizard and of "Modifier calendrier" (spec 5.2 step 3):
// tick a day, choose 1 to 3 sessions, give each a start and an end time.

export type Slot = { startTime: string; endTime: string };
export type Days = Record<number, Slot[]>;

export const DEFAULT_SLOTS: Slot[] = [
  { startTime: '08:00', endTime: '10:00' },
  { startTime: '10:00', endTime: '12:00' },
  { startTime: '14:00', endTime: '16:00' },
];

export function rulesFromDays(days: Days): Rule[] {
  return Object.entries(days).flatMap(([weekday, slots]) =>
    slots.map((slot, index) => ({
      weekday: Number(weekday),
      slotNo: index + 1,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
  );
}

export function daysFromRules(rules: Rule[]): Days {
  const days: Days = {};
  for (const rule of [...rules].sort((a, b) => a.slotNo - b.slotNo)) {
    days[rule.weekday] = [
      ...(days[rule.weekday] ?? []),
      {
        startTime: rule.startTime.slice(0, 5),
        endTime: rule.endTime.slice(0, 5),
      },
    ];
  }
  return days;
}

export function WeekPatternEditor({
  days,
  onChange,
  dayErrors,
}: {
  days: Days;
  onChange: (days: Days) => void;
  /** weekday -> a code of groups.wizard.ruleErrors */
  dayErrors: Map<number, string>;
}) {
  const t = useTranslations('groups.wizard');
  const locale = useLocale();

  const toggleDay = (weekday: number) => {
    const next = { ...days };
    if (next[weekday]) delete next[weekday];
    else next[weekday] = [DEFAULT_SLOTS[0]];
    onChange(next);
  };

  const setCount = (weekday: number, count: number) => {
    const slots = days[weekday] ?? [];
    onChange({
      ...days,
      [weekday]: Array.from(
        { length: count },
        (_, i) => slots[i] ?? DEFAULT_SLOTS[i],
      ),
    });
  };

  const setSlot = (weekday: number, index: number, patch: Partial<Slot>) =>
    onChange({
      ...days,
      [weekday]: days[weekday].map((slot, i) =>
        i === index ? { ...slot, ...patch } : slot,
      ),
    });

  return (
    <ul className="space-y-3">
      {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
        const slots = days[weekday];
        const errorCode = dayErrors.get(weekday);
        return (
          <li
            key={weekday}
            className="rounded-card border border-border bg-surface p-3"
          >
            <label className="flex min-h-11 items-center gap-3 font-medium">
              <input
                type="checkbox"
                checked={Boolean(slots)}
                onChange={() => toggleDay(weekday)}
                className="size-5 accent-primary"
              />
              {weekdayName(weekday, locale, 'long')}
            </label>

            {slots && (
              <div className="mt-2 space-y-3 ps-8">
                <div className="flex items-center gap-3">
                  <label htmlFor={`count-${weekday}`} className="text-sm">
                    {t('slotsCount')}
                  </label>
                  <select
                    id={`count-${weekday}`}
                    value={slots.length}
                    onChange={(event) =>
                      setCount(weekday, Number(event.target.value))
                    }
                    className={inputClass + ' !w-20'}
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[auto_1fr_1fr] items-end gap-2"
                  >
                    <span className="pb-3 text-sm text-muted">
                      {t('slotLabel', { n: index + 1 })}
                    </span>
                    <div className="space-y-1">
                      <label
                        htmlFor={`s-${weekday}-${index}`}
                        className="block text-xs"
                      >
                        {t('startTime')}
                      </label>
                      <input
                        id={`s-${weekday}-${index}`}
                        type="time"
                        dir="ltr"
                        value={slot.startTime}
                        onChange={(event) =>
                          setSlot(weekday, index, {
                            startTime: event.target.value,
                          })
                        }
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor={`e-${weekday}-${index}`}
                        className="block text-xs"
                      >
                        {t('endTime')}
                      </label>
                      <input
                        id={`e-${weekday}-${index}`}
                        type="time"
                        dir="ltr"
                        value={slot.endTime}
                        onChange={(event) =>
                          setSlot(weekday, index, {
                            endTime: event.target.value,
                          })
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                ))}
                {errorCode && (
                  <p role="alert" className="text-sm text-accent">
                    {t(`ruleErrors.${errorCode}` as 'ruleErrors.none')}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** weekday -> first error code, from the result of validateRules on `rules`. */
export function dayErrorsOf(
  rules: Rule[],
  check:
    { ok: true } | { ok: false; errors: { index: number; code: string }[] },
): Map<number, string> {
  const result = new Map<number, string>();
  if (check.ok) return result;
  for (const entry of check.errors) {
    const rule = rules[entry.index];
    if (rule && !result.has(rule.weekday)) result.set(rule.weekday, entry.code);
  }
  return result;
}
