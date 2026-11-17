export { EMAIL_REVIEW_MAILBOX, compareEmailCases, isOutlookMessageUrl, needsEmailReview } from '../../supabase/functions/_shared/emailReview.ts';
export type { EmailCategory, EmailReviewCase, EmailReviewEvent, EmailReviewIntake, EmailReviewStatus } from '../../supabase/functions/_shared/emailReview.ts';

export const EMAIL_CATEGORY_LABELS = {
  contact_preference: 'Contact preference / opt-out',
  no_longer_shopping: 'No longer shopping',
  vehicle_correction: 'Vehicle correction',
  buying_question: 'Buying / pricing / availability',
  data_correction: 'Email / data correction',
  product_feedback: 'Product / data-quality feedback',
  purchase_feedback: 'Purchase / success feedback',
} as const;
export const EMAIL_STATUS_LABELS = {
  needs_review: 'Needs review', reviewed: 'Reviewed — handling unverified',
  handled: 'Handled — your report', no_action: 'No action — your decision',
} as const;
