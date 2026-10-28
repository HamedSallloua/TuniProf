import { describe, expect, it } from 'vitest';
import {
  CHANNELS_BY_KIND,
  NOTIFICATION_KINDS,
} from '@/lib/notifications/kinds';
import { renderMessage, renderNotification } from '@/lib/notifications/render';
import { dueReminder } from '@/lib/notifications/schedule';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe('which reminder is due', () => {
  it('sends the smallest threshold that still covers the days left', () => {
    expect(dueReminder(31 * DAY)).toBeNull();
    expect(dueReminder(30 * DAY)).toBe(30);
    expect(dueReminder(20 * DAY)).toBe(30);
    expect(dueReminder(8 * DAY)).toBe(30);
    expect(dueReminder(7 * DAY)).toBe(7);
    expect(dueReminder(5 * DAY)).toBe(7);
    expect(dueReminder(2 * DAY)).toBe(7);
    expect(dueReminder(1 * DAY)).toBe(1);
    expect(dueReminder(6 * HOUR)).toBe(1);
  });

  it('sends nothing once the plan has ended', () => {
    expect(dueReminder(0)).toBeNull();
    expect(dueReminder(-1000)).toBeNull();
  });
});

describe('the channels of each message (spec 9)', () => {
  it('every kind has at least one channel, and the on-site notice is never missing', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(CHANNELS_BY_KIND[kind].length).toBeGreaterThan(0);
      expect(CHANNELS_BY_KIND[kind]).toContain('site');
    }
  });

  it('expiry reminders and warnings use every channel; reviews stay on the site', () => {
    for (const kind of [
      'plan_expiring',
      'plan_expired',
      'grace_ending',
    ] as const) {
      expect([...CHANNELS_BY_KIND[kind]].sort()).toEqual([
        'email',
        'site',
        'whatsapp',
      ]);
    }
    expect(CHANNELS_BY_KIND.review_published).toEqual(['site']);
    expect(CHANNELS_BY_KIND.review_report_outcome).toEqual(['site']);
  });
});

describe('the text of a message', () => {
  const params = {
    name: 'Wassima Chaaben',
    reason: 'incomplete_info',
    note: null,
    reference: 'TTP-12345',
    days: 7,
    date: '2027-01-05T10:00:00.000Z',
    rating: 5,
    outcome: 'upheld',
  };

  it.each(['fr', 'ar'] as const)(
    'every kind has a title and a text in %s, with every value filled in',
    (locale) => {
      for (const kind of NOTIFICATION_KINDS) {
        const { title, body } = renderNotification(kind, params, locale);
        expect(title, `${kind} title`).not.toBe('');
        expect(body, `${kind} body`).not.toBe('');
        // A raw {placeholder} or a missing-key marker would reach a teacher as it is.
        for (const text of [title, body]) {
          expect(text, `${kind}`).not.toMatch(/[{}]/);
          expect(text, `${kind}`).not.toContain('notifications.kinds');
        }
      }
    },
  );

  it('writes the reason with its label, and the note when there is one', () => {
    const plain = renderNotification('profile_rejected', params, 'fr').body;
    expect(plain).toContain('Informations incomplètes');
    const withNote = renderNotification(
      'profile_rejected',
      { ...params, note: 'Ajoutez votre diplôme' },
      'fr',
    ).body;
    expect(withNote).toContain(
      'Informations incomplètes (Ajoutez votre diplôme)',
    );
  });

  it('writes dates in the language and the time zone of Tunisia', () => {
    // 23:30 UTC on 31 December is already 1 January in Tunis (UTC+1).
    const body = renderNotification(
      'plan_expired',
      { date: '2026-12-31T23:30:00.000Z' },
      'fr',
    ).body;
    expect(body).toContain('1 janvier 2027');
  });

  it('says "demain" for one day and the number of days otherwise', () => {
    expect(
      renderNotification('plan_expiring', { ...params, days: 1 }, 'fr').body,
    ).toContain('demain');
    expect(
      renderNotification('plan_expiring', { ...params, days: 30 }, 'fr').body,
    ).toContain('30 jours');
  });

  it('tells the two outcomes of a report apart', () => {
    const upheld = renderNotification(
      'review_report_outcome',
      { outcome: 'upheld' },
      'fr',
    ).body;
    const dismissed = renderNotification(
      'review_report_outcome',
      { outcome: 'dismissed' },
      'fr',
    ).body;
    expect(upheld).toContain('retenu');
    expect(upheld).not.toBe(dismissed);
    expect(dismissed).toContain("n'a pas été retenu");
  });

  it('builds a complete message: greeting, text, signature', () => {
    const fr = renderMessage('plan_expired', params, 'fr');
    expect(fr.subject).toBe('Votre abonnement est terminé');
    expect(fr.text.startsWith('Bonjour Wassima Chaaben,')).toBe(true);
    expect(fr.text.trimEnd().endsWith("L'équipe TuniProf")).toBe(true);

    const ar = renderMessage('plan_expired', params, 'ar');
    expect(ar.text.startsWith('مرحبًا Wassima Chaaben،')).toBe(true);
    expect(ar.text).toContain('TuniProf');
  });

  it('greets without a name when there is none', () => {
    expect(
      renderMessage(
        'plan_expired',
        { ...params, name: null },
        'fr',
      ).text.startsWith('Bonjour,'),
    ).toBe(true);
  });
});
