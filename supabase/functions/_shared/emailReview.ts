/** Concise mailbox evidence only. This module has no provider or sending client. */
export const EMAIL_REVIEW_MAILBOX = 'hello@autofinder.com' as const;
export const EMAIL_CATEGORIES = ['contact_preference', 'no_longer_shopping', 'vehicle_correction', 'buying_question', 'data_correction', 'product_feedback', 'purchase_feedback'] as const;
export type EmailCategory = typeof EMAIL_CATEGORIES[number];
export type EmailReviewStatus = 'needs_review' | 'reviewed' | 'handled' | 'no_action';
export type EmailCaseEvidence = {
  message_id: string; request_key: string; source_version: string; source_url: string;
  received_at: string; category: EmailCategory; customer_label: string;
  vehicle_context: string; request_summary: string; suggested_next_step: string;
};
export type EmailReviewCase = EmailCaseEvidence & {
  id: string; user_id: string; mailbox: string; review_status: EmailReviewStatus;
  decision_note: string; reviewed_source_version: string | null; reviewed_at: string | null;
  source_observed_at: string;
  created_at: string; updated_at: string;
};
export type EmailReviewIntake = {
  id: string; user_id: string; mailbox: string; run_key: string;
  covered_from: string; covered_through: string; complete: boolean;
  message_count: number; customer_reply_count: number; pages: number;
  limitations: string[]; seen_messages: { message_id: string; source_version: string }[];
  created_at: string;
};
export type EmailReviewEvent = {
  id: string; user_id: string; case_id: string; kind: 'source_update' | 'decision';
  before: Record<string, unknown> | null; after: Record<string, unknown>;
  created_at: string;
};

export function isOutlookMessageUrl(value: string): boolean {
  try {
    const u = new URL(value);
    const readPath = /^\/mail\/(?:[^/?#]+\/)*id\/[^/?#]+\/?$/i.test(u.pathname)
      || /^\/mail\/deeplink\/read\/[^/?#]+\/?$/i.test(u.pathname)
      || /^\/owa\/?$/i.test(u.pathname) && [...u.searchParams.keys()].some(k => k.toLowerCase() === 'itemid');
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && ['outlook.office.com', 'outlook.office365.com'].includes(u.hostname)
      && readPath
      && !/\/(compose|reply|replyall|forward)(\/|$)/i.test(u.pathname)
      && ![...u.searchParams].some(([k, v]) => ['action', 'cmd'].includes(k.toLowerCase()) && /^(send|compose|reply|forward)/i.test(v))
      && !Array.from(value).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127);
  } catch { return false; }
}

export function needsEmailReview(item: EmailReviewCase): boolean {
  return item.review_status === 'needs_review' || item.reviewed_source_version !== item.source_version;
}

/** Contact preferences are first, not a claim that suppression has occurred. */
export function compareEmailCases(a: EmailReviewCase, b: EmailReviewCase): number {
  const rank = (c: EmailReviewCase) => (needsEmailReview(c) ? 0 : 2) + (c.category === 'contact_preference' ? 0 : 1);
  return rank(a) - rank(b) || Date.parse(b.received_at) - Date.parse(a.received_at) || a.id.localeCompare(b.id);
}
