import { describe, expect, it } from 'vitest';
import {
  matchStudent,
  searchStudents,
  type SearchableStudent,
} from '@/lib/students/search';

const student = (
  fullName: string,
  extra: Partial<SearchableStudent> = {},
): SearchableStudent => ({
  fullName,
  phone: null,
  note: null,
  groupNames: [],
  ...extra,
});

const names = (list: SearchableStudent[], query: string) =>
  searchStudents(list, query).map((r) => r.student.fullName);

describe('the student search (spec 5.6, 5.7)', () => {
  const all = [
    student('Sarah Ben Ali', { phone: '+21622345678' }),
    student('Mohamed Trabelsi', { phone: '+21698111222' }),
    student('Rania Mohamed'),
    student('Moez Gharbi', {
      note: 'frère de Sarah',
      groupNames: ['Math 4ème'],
    }),
    student('Zied Karray', { groupNames: ['Sarahouni physique'] }),
  ];

  it('matches words from their start: "Mo" finds Mohamed, "sa" finds Sarah, "ham" finds nobody', () => {
    expect(names(all, 'Mo')).toEqual([
      'Moez Gharbi',
      'Mohamed Trabelsi',
      'Rania Mohamed',
    ]);
    expect(names(all, 'sa')).toContain('Sarah Ben Ali');
    expect(names(all, 'ham')).toEqual([]);
  });

  it('needs every word typed: "mo tra" finds Mohamed Trabelsi only', () => {
    expect(names(all, 'mo tra')).toEqual(['Mohamed Trabelsi']);
    expect(names(all, 'tra mo')).toEqual(['Mohamed Trabelsi']);
  });

  it('ignores capitals, accents and Arabic diacritics', () => {
    const list = [
      student('Élodie Brûlé'),
      student('مُحَمَّد أحمد'),
      student('Hèdi'),
    ];
    expect(names(list, 'ELODIE')).toEqual(['Élodie Brûlé']);
    expect(names(list, 'brule')).toEqual(['Élodie Brûlé']);
    expect(names(list, 'محمد')).toEqual(['مُحَمَّد أحمد']);
    expect(names(list, 'احمد')).toEqual(['مُحَمَّد أحمد']);
    expect(names(list, 'hedi')).toEqual(['Hèdi']);
  });

  it('matches phone digits anywhere in the number, with spaces and a +216 typed or not', () => {
    expect(names(all, '22 345')).toEqual(['Sarah Ben Ali']);
    expect(names(all, '98111')).toEqual(['Mohamed Trabelsi']);
    expect(names(all, '+216 98 111 222')).toEqual(['Mohamed Trabelsi']);
    expect(names(all, '345678')).toEqual(['Sarah Ben Ali']);
    expect(searchStudents(all, '22 345')[0].match).toBe('phone');
  });

  it('does not search phones with a single digit', () => {
    expect(names(all, '2')).toEqual([]);
  });

  it('also finds the note and the name of a group, by word start', () => {
    expect(matchStudent(all[3], 'frère')).toBe('note');
    expect(matchStudent(all[3], 'frere')).toBe('note');
    expect(matchStudent(all[3], 'math')).toBe('group');
    expect(matchStudent(all[3], 'ème')).toBeNull();
  });

  it('ranks the name first, then the phone, then the note, then the group name', () => {
    // "sarah": a name (Sarah Ben Ali), a note (Moez), a group name (Zied).
    expect(
      searchStudents(all, 'sarah').map((r) => [r.student.fullName, r.match]),
    ).toEqual([
      ['Sarah Ben Ali', 'name'],
      ['Moez Gharbi', 'note'],
      ['Zied Karray', 'group'],
    ]);
  });

  it('shows everybody in alphabetical order when nothing is typed', () => {
    expect(searchStudents(all, '   ').map((r) => r.student.fullName)).toEqual([
      'Moez Gharbi',
      'Mohamed Trabelsi',
      'Rania Mohamed',
      'Sarah Ben Ali',
      'Zied Karray',
    ]);
    expect(searchStudents(all, '')[0].match).toBeNull();
  });
});
