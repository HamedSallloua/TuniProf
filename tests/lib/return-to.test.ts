import { describe, expect, it } from 'vitest';
import { parseReturnTo } from '@/lib/auth/return-to';
import {
  parseReply,
  parseReviewInput,
  parseReviewReport,
} from '@/lib/reviews/rules';

describe('return address after the reviewer sign-in', () => {
  it('accepts only /prof/{slug} addresses', () => {
    expect(parseReturnTo('/prof/wassima-chaaben-physique-sfax')).toBe(
      '/prof/wassima-chaaben-physique-sfax',
    );
    for (const bad of [
      'https://evil.example/prof/x',
      '//evil.example',
      '/prof/../admin',
      '/prof/x/y',
      '/prof/',
      '/admin',
      '/prof/X',
      '/prof/x?next=https://evil.example',
      '',
      null,
      undefined,
      42,
      `/prof/${'a'.repeat(200)}`,
    ]) {
      expect(parseReturnTo(bad)).toBeNull();
    }
  });
});

describe('review content rules', () => {
  it('needs a whole rating from 1 to 5; the comment is optional and trimmed', () => {
    expect(parseReviewInput({ rating: '5', comment: '  Super  ' })).toEqual({
      rating: 5,
      comment: 'Super',
    });
    expect(parseReviewInput({ rating: 3, comment: '' })).toEqual({
      rating: 3,
      comment: null,
    });
    for (const rating of ['', '0', '6', '2.5', 'x', undefined, null]) {
      expect(parseReviewInput({ rating, comment: '' })).toBeNull();
    }
    expect(
      parseReviewInput({ rating: 5, comment: 'x'.repeat(501) }),
    ).toBeNull();
    expect(
      parseReviewInput({ rating: 5, comment: 'x'.repeat(500) }),
    ).not.toBeNull();
  });

  it('a reply is text of 1 to 500 characters', () => {
    expect(parseReply('  Merci  ')).toBe('Merci');
    for (const bad of ['', '   ', 'x'.repeat(501), 5, null, undefined]) {
      expect(parseReply(bad)).toBeNull();
    }
  });

  it('a review report needs a known reason, and a note for "other"', () => {
    expect(parseReviewReport({ reason: 'fake_review', note: '' })).toEqual({
      reason: 'fake_review',
      note: null,
    });
    expect(parseReviewReport({ reason: 'other', note: ' ' })).toBeNull();
    expect(parseReviewReport({ reason: 'other', note: 'Explication' })).toEqual(
      {
        reason: 'other',
        note: 'Explication',
      },
    );
    expect(parseReviewReport({ reason: 'wrong_info', note: '' })).toBeNull();
  });
});
