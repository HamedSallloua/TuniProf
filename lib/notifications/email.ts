// Sending e-mail (spec 8.1: one transactional provider). The owner has not chosen one yet
// (decided at M12), so the site only talks to this small interface.

export type OutgoingEmail = { to: string; subject: string; text: string };

export interface EmailProvider {
  /** Throws when the message could not be sent; the job tries again later. */
  send(email: OutgoingEmail): Promise<void>;
}

/** Development only: writes the e-mail in the terminal instead of sending it. */
export const devEmailProvider: EmailProvider = {
  async send(email) {
    console.info(
      `[dev e-mail] to ${email.to} | ${email.subject}\n${email.text}\n`,
    );
  },
};

/**
 * The provider in use. In production there is none until the owner chooses one: e-mails then
 * simply stay queued (pending) and nothing is lost.
 */
export function getEmailProvider(): EmailProvider | null {
  return process.env.NODE_ENV === 'production' ? null : devEmailProvider;
}
