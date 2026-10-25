import { describe, expect, it } from 'vitest';
import {
  cleanLine,
  cleanParagraphs,
  detectContactInfo,
  formatMillimesInput,
  isProfileComplete,
  listMissingFields,
  parseRateToMillimes,
  validateBio,
  validateCustomSubjectName,
  validateFullName,
  type ProfileSnapshot,
} from '@/lib/profile/rules';

const RANGE = { min: 5000, max: 300000 };

describe('full name (2 to 60 characters)', () => {
  it.each([
    'Wassima Chaaben',
    'Mohamed-Ali Ben Salah',
    "Sami O'Neil",
    'Jean P. Dupont',
    'سارة بن علي',
    'Ép',
  ])('accepts %s', (name) => {
    expect(validateFullName(name).ok).toBe(true);
  });

  it('cleans extra spaces and invisible characters', () => {
    expect(validateFullName('  Sarah ​  Ben   Ali ')).toEqual({
      ok: true,
      value: 'Sarah Ben Ali',
    });
  });

  it('refuses too short and too long names', () => {
    expect(validateFullName('A')).toEqual({ ok: false, error: 'nameLength' });
    expect(validateFullName('   ')).toEqual({ ok: false, error: 'nameLength' });
    expect(validateFullName('a'.repeat(60)).ok).toBe(true);
    expect(validateFullName('a'.repeat(61))).toEqual({
      ok: false,
      error: 'nameLength',
    });
  });

  it('refuses digits, symbols and markup', () => {
    for (const name of [
      'Prof 22345678',
      'Sarah <b>',
      'Sarah@home',
      'Sarah_Ben',
      '12',
      '-Sarah',
    ]) {
      expect(validateFullName(name), name).toEqual({
        ok: false,
        error: 'nameChars',
      });
    }
  });
});

describe('contact details in text (spec 4.2: phone numbers, links and social handles)', () => {
  const GOOD =
    'Professeur de mathématiques depuis 10 ans, je prépare au baccalauréat et aux concours. Cours clairs et progressifs.';

  it('lets a normal bio through', () => {
    expect(detectContactInfo(GOOD)).toBeNull();
    expect(
      detectContactInfo(
        'Plus de 12 ans d’expérience, 300 élèves, classes de 4ème et 5ème.',
      ),
    ).toBeNull();
    expect(
      detectContactInfo('Diplômé en 2015-2020, cours à Sfax de 8h à 20h.'),
    ).toBeNull();
    expect(
      detectContactInfo('أدرّس الرياضيات منذ 10 سنوات لجميع المستويات'),
    ).toBeNull();
  });

  it.each([
    '22345678',
    'Appelez le 22 345 678 svp',
    'mon numéro: 22.345.678',
    'tel 22-345-678',
    '+216 22 345 678',
    '00216 22345678',
    '(+216) 22/345/678',
    'اتصل بي ٢٢٣٤٥٦٧٨',
    'رقمي ٢٢ ٣٤٥ ٦٧٨',
    'joignez-moi au 2 2 3 4 5 6 7 8',
  ])('detects the phone number in %j', (text) => {
    expect(detectContactInfo(text)).toBe('phone');
  });

  it.each([
    'voir https://monsite.tn',
    'http://exemple.com/profil',
    'www.mes-cours.tn',
    'sur mescours.com',
    'ecole.tn pour plus',
    'bit.ly/abc',
    'موقعي cours-math.tn',
  ])('detects the link in %j', (text) => {
    expect(detectContactInfo(text)).toBe('link');
  });

  it.each([
    '@sarah_prof',
    'suivez @prof.maths',
    'écrivez à sarah@gmail.com',
    '@ sarah',
  ])('detects the handle or e-mail in %j', (text) => {
    expect(detectContactInfo(text)).toBe('handle');
  });

  it.each([
    'contactez-moi sur WhatsApp',
    'Whats app disponible',
    'ma page Facebook',
    'instagram: sarahprof',
    'sur Telegram',
    'tiktok',
    'Snapchat',
    'Viber',
    'wa.me/21622345678',
    'راسلني على واتساب',
    'صفحتي على فيسبوك',
    'انستغرام',
  ])('detects the messaging or social app in %j', (text) => {
    expect(detectContactInfo(text)).not.toBeNull();
  });

  it('does not flag words that merely contain app names', () => {
    expect(detectContactInfo('Une méthode instagrammable')).toBeNull();
    expect(detectContactInfo('Fbi, fbx')).toBeNull();
  });
});

describe('bio (30 to 600 characters, no contact details)', () => {
  const ok = 'Professeur de mathématiques avec dix ans d’expérience en lycée.';

  it('accepts a normal bio and keeps the line breaks', () => {
    expect(validateBio(ok).ok).toBe(true);
    expect(validateBio(`${ok}\n\nCours à domicile.`)).toEqual({
      ok: true,
      value: `${ok}\n\nCours à domicile.`,
    });
  });

  it('counts exactly 30 and 600 characters as valid, and one more or less as invalid', () => {
    expect(validateBio('a'.repeat(30)).ok).toBe(true);
    expect(validateBio('a'.repeat(29))).toEqual({
      ok: false,
      error: 'bioTooShort',
    });
    expect(validateBio('a'.repeat(600)).ok).toBe(true);
    expect(validateBio('a'.repeat(601))).toEqual({
      ok: false,
      error: 'bioTooLong',
    });
  });

  it('refuses a bio with a phone number, a link or a handle, and says which', () => {
    expect(validateBio(`${ok} Tél 22 345 678`)).toEqual({
      ok: false,
      error: 'bioContainsContact',
      contact: 'phone',
    });
    expect(validateBio(`${ok} Voir www.monsite.tn`)).toEqual({
      ok: false,
      error: 'bioContainsContact',
      contact: 'link',
    });
    expect(validateBio(`${ok} Suivez @sarah`)).toMatchObject({
      error: 'bioContainsContact',
      contact: 'handle',
    });
    expect(validateBio(`${ok} WhatsApp`)).toMatchObject({
      error: 'bioContainsContact',
      contact: 'app',
    });
  });

  it('cannot be fooled by padding with spaces or invisible characters', () => {
    expect(validateBio(' '.repeat(40)).ok).toBe(false);
    expect(
      validateBio(`${ok.slice(0, 10)}​${ok.slice(10)} 2​2 345 678`).ok,
    ).toBe(false);
  });
});

describe('custom subject ("Autre")', () => {
  it('accepts a short subject name', () => {
    expect(validateCustomSubjectName('Théâtre').ok).toBe(true);
    expect(validateCustomSubjectName('Calcul mental / logique').ok).toBe(true);
    expect(validateCustomSubjectName('الخط العربي').ok).toBe(true);
  });

  it('refuses empty, long, contact and markup', () => {
    for (const name of [
      '',
      'a',
      'x'.repeat(41),
      'WhatsApp 22345678',
      '<script>',
      'maths@home',
      '123',
    ]) {
      expect(validateCustomSubjectName(name), name).toEqual({
        ok: false,
        error: 'subjectNameInvalid',
      });
    }
  });
});

describe('hourly rate (5 to 300 DT, typed in DT, kept in millimes)', () => {
  it.each([
    ['5', 5000],
    ['25', 25000],
    ['25.5', 25500],
    ['25,5', 25500],
    ['25.500', 25500],
    ['25,05', 25050],
    ['25.005', 25005],
    ['300', 300000],
    [' 40 ', 40000],
    ['٤٠', 40000],
  ])('reads %j as %i millimes', (text, expected) => {
    expect(parseRateToMillimes(text, RANGE)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it('refuses amounts outside the range, boundaries included', () => {
    expect(parseRateToMillimes('4.999', RANGE)).toEqual({
      ok: false,
      error: 'rateOutOfRange',
    });
    expect(parseRateToMillimes('300.001', RANGE)).toEqual({
      ok: false,
      error: 'rateOutOfRange',
    });
    expect(parseRateToMillimes('0', RANGE)).toEqual({
      ok: false,
      error: 'rateOutOfRange',
    });
  });

  it('refuses anything that is not an amount', () => {
    for (const text of [
      '',
      'abc',
      '-5',
      '1e3',
      '25.5555',
      '25,,5',
      '25 DT',
      '1.2.3',
      '12345',
    ]) {
      expect(parseRateToMillimes(text, RANGE), text).toMatchObject({
        ok: false,
      });
    }
  });

  it('follows the range given by the settings', () => {
    expect(parseRateToMillimes('9', { min: 10000, max: 20000 })).toEqual({
      ok: false,
      error: 'rateOutOfRange',
    });
    expect(parseRateToMillimes('15', { min: 10000, max: 20000 })).toEqual({
      ok: true,
      value: 15000,
    });
  });

  it('writes millimes back the way they are typed', () => {
    expect(formatMillimesInput(25000)).toBe('25');
    expect(formatMillimesInput(25500)).toBe('25.5');
    expect(formatMillimesInput(25050)).toBe('25.05');
    expect(formatMillimesInput(25005)).toBe('25.005');
  });
});

describe('text cleaning', () => {
  it('removes control and invisible characters', () => {
    expect(cleanLine('a\u0000b‮c​d')).toBe(
      'a bcd', // the control character becomes a space; invisible ones disappear
    );
  });

  it('keeps paragraphs but not runs of blank lines', () => {
    expect(cleanParagraphs('a\r\n\r\n\r\n\r\nb  c\n')).toBe('a\n\nb c');
  });
});

describe('completeness (mirrors the SQL function)', () => {
  const full: ProfileSnapshot = {
    fullName: 'Sarah',
    diploma: 'student',
    experience: '1_3',
    bio: 'x'.repeat(40),
    governorateId: 'g',
    modes: ['at_home'],
    levelCount: 1,
    subjectCount: 1,
    zoneCount: 1,
    phoneVerified: true,
  };

  it('a full profile is complete', () => {
    expect(listMissingFields(full)).toEqual([]);
    expect(isProfileComplete(full)).toBe(true);
  });

  it('lists what is missing, field by field', () => {
    expect(
      listMissingFields({ ...full, fullName: null, bio: null, levelCount: 0 }),
    ).toEqual(['fullName', 'bio', 'levels']);
    expect(listMissingFields({ ...full, modes: [], zoneCount: 0 })).toEqual([
      'modes',
      'zones',
    ]);
  });

  it('zones are optional only when the sole mode is online', () => {
    expect(
      isProfileComplete({ ...full, modes: ['online'], zoneCount: 0 }),
    ).toBe(true);
    expect(
      isProfileComplete({
        ...full,
        modes: ['online', 'at_home'],
        zoneCount: 0,
      }),
    ).toBe(false);
    expect(
      isProfileComplete({ ...full, modes: ['at_teacher'], zoneCount: 0 }),
    ).toBe(false);
  });

  it('needs a verified phone', () => {
    expect(isProfileComplete({ ...full, phoneVerified: false })).toBe(false);
  });
});
