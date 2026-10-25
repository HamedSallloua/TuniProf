import { describe, expect, it } from 'vitest';
import { parseProfileForm } from '@/lib/profile/form';

const RANGE = { min: 5000, max: 300000 };
const GOV = '11111111-1111-4111-8111-111111111111';
const LEVEL = '22222222-2222-4222-8222-222222222222';
const ZONE = '33333333-3333-4333-8333-333333333333';
const SUBJECT = '44444444-4444-4444-8444-444444444444';
const SUBJECT_2 = '55555555-5555-4555-8555-555555555555';

function form(entries: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  const all: Record<string, string | string[]> = {
    fullName: 'Wassima Chaaben',
    diploma: 'high_school_teacher',
    experience: '5_10',
    bio: 'Professeure de physique depuis dix ans, je prépare au baccalauréat.',
    governorate: GOV,
    modes: ['at_home'],
    levels: [LEVEL],
    zones: [ZONE],
    subjects: [SUBJECT],
    [`rate_${SUBJECT}`]: '25',
    ...entries,
  };
  for (const [key, value] of Object.entries(all)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const strict = (data: FormData) =>
  parseProfileForm(data, { strict: true, rateRange: RANGE });
const draft = (data: FormData) =>
  parseProfileForm(data, { strict: false, rateRange: RANGE });

describe('profile form (strict: submit)', () => {
  it('accepts a complete form and returns clean typed values', () => {
    const result = strict(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      fullName: 'Wassima Chaaben',
      diploma: 'high_school_teacher',
      experience: '5_10',
      bio: 'Professeure de physique depuis dix ans, je prépare au baccalauréat.',
      governorateId: GOV,
      modes: ['at_home'],
      levelIds: [LEVEL],
      zoneIds: [ZONE],
      subjects: [{ subjectId: SUBJECT, rateMillimes: 25000 }],
    });
  });

  it('asks for every required field', () => {
    const result = strict(
      form({
        fullName: '',
        diploma: '',
        experience: '',
        bio: '',
        governorate: '',
        modes: [],
        levels: [],
        zones: [],
        subjects: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        'bio',
        'diploma',
        'experience',
        'fullName',
        'governorate',
        'levels',
        'modes',
        'subjects',
        'zones', // with no mode chosen, "online only" does not apply
      ].sort(),
    );
    expect(result.errors.levels).toEqual({ code: 'levelsRequired' });
    expect(result.errors.modes).toEqual({ code: 'modesRequired' });
  });

  it('zones are required, except when the only mode is online', () => {
    const noZone = strict(form({ zones: [] }));
    expect(noZone.ok).toBe(false);
    if (!noZone.ok)
      expect(noZone.errors.zones).toEqual({ code: 'zonesRequired' });

    expect(strict(form({ zones: [], modes: ['online'] })).ok).toBe(true);
    expect(strict(form({ zones: [], modes: ['online', 'at_home'] })).ok).toBe(
      false,
    );
  });

  it('validates the bio like the profile rules do', () => {
    const phone = strict(
      form({
        bio: 'Professeure expérimentée, appelez-moi au 22 345 678 pour un cours.',
      }),
    );
    expect(phone.ok).toBe(false);
    if (!phone.ok)
      expect(phone.errors.bio).toEqual({ code: 'bioContainsContact' });

    const short = strict(form({ bio: 'trop court' }));
    if (!short.ok) expect(short.errors.bio).toEqual({ code: 'bioTooShort' });
  });

  it('refuses values outside the lists, and malformed ids', () => {
    const result = strict(
      form({
        diploma: 'wizard',
        experience: '99',
        modes: ['teleport'],
        governorate: 'sfax',
        levels: ['x'],
        zones: ['y'],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const field of [
      'diploma',
      'experience',
      'modes',
      'governorate',
      'levels',
      'zones',
    ] as const) {
      expect(result.errors[field], field).toEqual({ code: 'invalidChoice' });
    }
  });

  it('ignores duplicated checkbox values', () => {
    const result = strict(
      form({ levels: [LEVEL, LEVEL], modes: ['at_home', 'at_home'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.levelIds).toEqual([LEVEL]);
  });
});

describe('hourly rates', () => {
  it('reads several subjects with their rates, comma or dot', () => {
    const result = strict(
      form({
        subjects: [SUBJECT, SUBJECT_2],
        [`rate_${SUBJECT}`]: '25,5',
        [`rate_${SUBJECT_2}`]: '40',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.subjects).toEqual([
        { subjectId: SUBJECT, rateMillimes: 25500 },
        { subjectId: SUBJECT_2, rateMillimes: 40000 },
      ]);
    }
  });

  it('refuses a rate outside 5 to 300 DT and says the allowed range', () => {
    const result = strict(form({ [`rate_${SUBJECT}`]: '4' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.rates?.[SUBJECT]).toEqual({
        code: 'rateOutOfRange',
        min: 5000,
        max: 300000,
      });
    }
    expect(strict(form({ [`rate_${SUBJECT}`]: '301' })).ok).toBe(false);
    expect(strict(form({ [`rate_${SUBJECT}`]: '5' })).ok).toBe(true);
    expect(strict(form({ [`rate_${SUBJECT}`]: '300' })).ok).toBe(true);
  });

  it('a ticked subject without a valid rate is an error, even in a draft', () => {
    for (const mode of [strict, draft]) {
      const result = mode(form({ [`rate_${SUBJECT}`]: '' }));
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.errors.rates?.[SUBJECT]?.code).toBe('rateInvalid');
    }
  });

  it('uses the range from the settings', () => {
    const result = parseProfileForm(form({ [`rate_${SUBJECT}`]: '9' }), {
      strict: true,
      rateRange: { min: 10000, max: 20000 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('"Autre" subject', () => {
  it('adds a custom subject with its rate', () => {
    const result = strict(
      form({ customName: 'Calcul mental', customRate: '15' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.subjects).toContainEqual({
        customName: 'Calcul mental',
        rateMillimes: 15000,
      });
    }
  });

  it('can be the only subject', () => {
    const result = strict(
      form({ subjects: [], customName: 'Calcul mental', customRate: '15' }),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a name with contact details, or a name without a rate', () => {
    const contact = strict(
      form({ customName: 'WhatsApp 22345678', customRate: '15' }),
    );
    expect(contact.ok).toBe(false);
    if (!contact.ok)
      expect(contact.errors.customSubject).toEqual({
        code: 'subjectNameInvalid',
      });

    const noRate = strict(
      form({ customName: 'Calcul mental', customRate: '' }),
    );
    expect(noRate.ok).toBe(false);
    if (!noRate.ok)
      expect(noRate.errors.rates?.custom?.code).toBe('rateInvalid');
  });
});

describe('draft saving (lenient)', () => {
  it('accepts an almost empty form', () => {
    const result = draft(
      form({
        fullName: '',
        diploma: '',
        experience: '',
        bio: '',
        governorate: '',
        modes: [],
        levels: [],
        zones: [],
        subjects: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input).toMatchObject({
        fullName: null,
        diploma: null,
        bio: null,
        governorateId: null,
        levelIds: [],
        subjects: [],
      });
    }
  });

  it('still refuses what is filled in wrongly', () => {
    const result = draft(form({ fullName: 'Sarah 22345678', bio: 'courte' }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(['bio', 'fullName']);
  });

  it('gives back what was typed, so the form can be shown again', () => {
    const result = draft(
      form({ fullName: 'Sarah 1', [`rate_${SUBJECT}`]: '999' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.values.fullName).toBe('Sarah 1');
      expect(result.values.subjects[SUBJECT]).toBe('999');
    }
  });
});

describe('photo field', () => {
  it('reports a chosen file, and the remove-photo tick', () => {
    const data = form();
    data.append(
      'photo',
      new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' }),
    );
    data.append('removePhoto', 'on');
    const result = strict(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.photoFile?.name).toBe('me.jpg');
      expect(result.removePhoto).toBe(true);
    }
  });

  it('an empty file field (no file chosen) means no photo change', () => {
    const data = form();
    data.append(
      'photo',
      new File([], '', { type: 'application/octet-stream' }),
    );
    const result = strict(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.photoFile).toBeNull();
  });
});
