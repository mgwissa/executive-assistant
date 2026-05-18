/**
 * Tiny Resend client used by the email notification Edge Functions.
 *
 * Env required:
 *  - RESEND_API_KEY
 *  - RESEND_FROM_EMAIL (e.g. `Notes <notifications@your-domain.com>`. Resend's
 *    test sandbox `onboarding@resend.dev` is fine for first deploys, but you
 *    can only send to your own verified address until you add a domain.)
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!from) throw new Error('RESEND_FROM_EMAIL is not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

/** Escape user-supplied text for safe inclusion in HTML email bodies. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
