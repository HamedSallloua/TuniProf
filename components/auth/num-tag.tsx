import type { ReactNode } from 'react';

// Renders the <num>...</num> tag of the messages: a phone number is always written left to
// right, even inside an Arabic sentence.
export const numTag = (chunks: ReactNode) => (
  <bdi dir="ltr" className="font-semibold">
    {chunks}
  </bdi>
);
