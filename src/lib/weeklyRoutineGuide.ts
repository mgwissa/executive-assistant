export const WEEKLY_ROUTINE_TEMPLATE_VERSION = 'weekly-product-leader-v1';

export type RoutineWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export type RoutineItemKind = 'time-block' | 'ritual';

export type RoutineAutomationTarget = 'calendar' | 'task' | 'both' | 'none';

export type RoutineAutomation = {
  target: RoutineAutomationTarget;
  cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  defaultDurationMinutes?: number;
};

export type RoutineTimeBlock = {
  id: string;
  kind: 'time-block';
  weekday: RoutineWeekday;
  sortOrder: number;
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  why?: string;
  primaryHat?: 'PO' | 'PM' | 'Project Manager' | 'Designer' | 'Market Watcher';
  automation: RoutineAutomation;
};

export type RoutineRitual = {
  id: string;
  kind: 'ritual';
  sortOrder: number;
  title: string;
  days: RoutineWeekday[];
  durationMinutes: number;
  output: string;
  automation: RoutineAutomation;
};

export type RoutineCadence = {
  id: string;
  title: string;
  cadence: 'monthly' | 'quarterly';
  items: string[];
};

export type RoutineAntiPattern = {
  id: string;
  title: string;
  alternative: string;
};

export type RoutineDay = {
  weekday: RoutineWeekday;
  label: string;
  theme: string;
  summary: string;
  primaryHat: RoutineTimeBlock['primaryHat'];
};

export const ROUTINE_WEEKDAYS: RoutineWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
];

export const ROUTINE_DAYS: RoutineDay[] = [
  {
    weekday: 'monday',
    label: 'Monday',
    theme: 'Strategy & Alignment Day',
    summary: 'Own the week: set priorities, communicate the plan, and unblock the team.',
    primaryHat: 'PM',
  },
  {
    weekday: 'tuesday',
    label: 'Tuesday',
    theme: 'Design & Build Day',
    summary: 'Protect design output and developer collaboration. Minimize meetings.',
    primaryHat: 'Designer',
  },
  {
    weekday: 'wednesday',
    label: 'Wednesday',
    theme: 'Delivery & Unblocking Day',
    summary: 'Check sprint health, clear blockers, and move quick wins forward.',
    primaryHat: 'Project Manager',
  },
  {
    weekday: 'thursday',
    label: 'Thursday',
    theme: 'Collaboration & Review Day',
    summary: 'Use the day for demos, design crits, planning sessions, and user contact.',
    primaryHat: 'Designer',
  },
  {
    weekday: 'friday',
    label: 'Friday',
    theme: 'Review, Learn & Plan Day',
    summary: 'Reflect, improve, and prepare next week. Keep meetings light.',
    primaryHat: 'Market Watcher',
  },
];

export const ROUTINE_TIME_BLOCKS: RoutineTimeBlock[] = [
  block('monday-triage', 'monday', 10, '08:00', '08:10', 'Morning triage', 'Check Slack/email and update task list.', 'Prevents surprises derailing the day.', 'Project Manager', 'daily', 'task'),
  block('monday-goals', 'monday', 20, '08:10', '08:30', 'Weekly goal-setting', 'Pick 3 outcomes for the week.', 'Keeps you outcome-focused instead of task-busy.', 'PM', 'weekly', 'task'),
  block('monday-metrics', 'monday', 30, '08:30', '09:00', 'Metrics review', "Check last week's KPIs.", 'Data-driven decisions start with data.', 'PM', 'weekly', 'both'),
  block('monday-standup', 'monday', 15, '09:00', '09:15', 'Team standup', 'Run standup or post an async update.', 'Alignment and blocker detection early.', 'Project Manager', 'daily', 'calendar'),
  block('monday-backlog', 'monday', 75, '09:15', '10:30', 'Roadmap & backlog review', "Ensure this week's sprint aligns to the roadmap.", 'Keeps the team pointed at the right work.', 'PO', 'weekly', 'both'),
  block('monday-stakeholders', 'monday', 90, '10:30', '12:00', 'Stakeholder comms', 'Batch stakeholder updates and async messages.', 'Keeps stakeholders informed proactively.', 'PM', 'weekly', 'task'),
  block('monday-market-lite', 'monday', 60, '12:00', '13:00', 'Lunch + light market scan', 'Take lunch and spend 10 minutes on newsletters or competitor news.', 'Stay current without a dedicated block.', 'Market Watcher', 'weekly', 'none'),
  block('monday-deep-work', 'monday', 150, '13:00', '15:30', 'Product decision deep work', 'Write PRDs, specs, or product decisions.', 'Hard thinking needs a protected focus block.', 'PM', 'weekly', 'calendar'),
  block('monday-design-review', 'monday', 60, '15:30', '16:30', 'Design review or desk work', 'Review designs or move creative work forward.', 'Visual output requires dedicated creative time.', 'Designer', 'weekly', 'calendar'),
  block('monday-close', 'monday', 30, '16:30', '17:00', 'Day close', "Update task status and tomorrow's top 3.", 'Prevents Monday carry-over buildup.', 'Project Manager', 'daily', 'task'),

  block('tuesday-triage', 'tuesday', 10, '08:00', '08:10', 'Morning triage', 'Quick scan only.', 'Protect the design day.', 'Project Manager', 'daily', 'task'),
  block('tuesday-standup', 'tuesday', 20, '08:10', '08:30', 'Standup or async update', 'Share status and check alignment.', 'Keeps the team connected before deep work.', 'Project Manager', 'daily', 'calendar'),
  block('tuesday-design', 'tuesday', 210, '08:30', '12:00', 'Design block', 'Work on wireframes, prototypes, and user flows.', 'Requires long uninterrupted focus.', 'Designer', 'weekly', 'calendar'),
  block('tuesday-lunch', 'tuesday', 60, '12:00', '13:00', 'Lunch', 'Take a real break.', undefined, undefined, 'daily', 'none'),
  block('tuesday-dev-pairing', 'tuesday', 90, '13:00', '14:30', 'Dev pairing / handoff', 'Pair with devs, hand off design, or write tickets.', 'Clarity here saves dev time later.', 'Designer', 'weekly', 'both'),
  block('tuesday-refinement', 'tuesday', 60, '14:30', '15:30', 'Backlog refinement', 'Estimate effort and clarify acceptance criteria with dev when possible.', 'Keeps upcoming work ready.', 'PO', 'weekly', 'both'),
  block('tuesday-feedback', 'tuesday', 60, '15:30', '16:30', 'User feedback review', 'Review support tickets, analytics sessions, reviews, or NPS comments.', 'Closes the feedback loop regularly.', 'PM', 'weekly', 'task'),
  block('tuesday-close', 'tuesday', 30, '16:30', '17:00', 'Day close', 'Update design files and tracker status.', undefined, 'Project Manager', 'daily', 'task'),

  block('wednesday-triage', 'wednesday', 10, '08:00', '08:10', 'Morning triage', 'Check the essentials and update your task list.', undefined, 'Project Manager', 'daily', 'task'),
  block('wednesday-standup', 'wednesday', 20, '08:10', '08:30', 'Blocker-focused standup', 'Focus standup on blockers today.', 'Wednesday blockers become Friday deadline risk.', 'Project Manager', 'daily', 'calendar'),
  block('wednesday-sprint-health', 'wednesday', 60, '08:30', '09:30', 'Sprint health check', 'Review tracker and flag at-risk items.', 'Catch scope creep or slippage early.', 'Project Manager', 'weekly', 'both'),
  block('wednesday-syncs', 'wednesday', 30, '09:30', '10:00', 'Stakeholder quick syncs', 'Keep syncs lean: max 2 x 15 minutes.', 'Use async where possible.', 'PM', 'weekly', 'calendar'),
  block('wednesday-stories', 'wednesday', 120, '10:00', '12:00', 'Story/spec deep work', 'Write user stories, acceptance criteria, and specs.', "Fills the next sprint's ready backlog.", 'PO', 'weekly', 'calendar'),
  block('wednesday-lunch', 'wednesday', 60, '12:00', '13:00', 'Lunch', 'Take a real break.', undefined, undefined, 'daily', 'none'),
  block('wednesday-ux-review', 'wednesday', 120, '13:00', '15:00', 'Design work or UX review', 'Review usability or iterate on designs.', 'Mid-week design gives time to iterate before Friday.', 'Designer', 'weekly', 'calendar'),
  block('wednesday-dev-questions', 'wednesday', 60, '15:00', '16:00', 'Answer dev questions', 'Respond to open questions from the dev team.', 'Unblocks downstream work.', 'Project Manager', 'daily', 'task'),
  block('wednesday-admin', 'wednesday', 60, '16:00', '17:00', 'Admin and docs', 'Handle email, docs, Confluence, or Notion updates.', 'Keeps documentation current.', 'Project Manager', 'weekly', 'task'),

  block('thursday-triage', 'thursday', 10, '08:00', '08:10', 'Morning triage', 'Check the essentials and update your task list.', undefined, 'Project Manager', 'daily', 'task'),
  block('thursday-standup', 'thursday', 20, '08:10', '08:30', 'Standup', 'Share status and check alignment.', undefined, 'Project Manager', 'daily', 'calendar'),
  block('thursday-user-session', 'thursday', 60, '08:30', '09:30', 'User interview or usability session', 'Schedule fortnightly to maintain user contact.', 'Keeps you grounded in real user behavior.', 'PM', 'biweekly', 'calendar'),
  block('thursday-design-crit', 'thursday', 90, '09:30', '11:00', 'Design crit', 'Run internal design review.', 'Gets early feedback before dev starts.', 'Designer', 'weekly', 'calendar'),
  block('thursday-review-prep', 'thursday', 60, '11:00', '12:00', 'Sprint review prep', 'Curate what to demo and draft release notes when relevant.', 'Makes review time sharper.', 'Project Manager', 'weekly', 'task'),
  block('thursday-lunch', 'thursday', 60, '12:00', '13:00', 'Lunch', 'Take a real break.', undefined, undefined, 'daily', 'none'),
  block('thursday-demo', 'thursday', 90, '13:00', '14:30', 'Sprint review / demo', 'Demo progress to stakeholders when it is review week.', 'Shows real progress and builds alignment.', 'PM', 'weekly', 'calendar'),
  block('thursday-retro', 'thursday', 60, '14:30', '15:30', 'Retro or planning prep', 'Run retro when needed, otherwise prepare planning.', 'Improves the team and aligns the next sprint.', 'Project Manager', 'weekly', 'calendar'),
  block('thursday-planning', 'thursday', 60, '15:30', '16:30', 'Next sprint planning', 'Plan or refine the next sprint.', 'Ensures Monday is unblocked.', 'PO', 'weekly', 'both'),
  block('thursday-close', 'thursday', 30, '16:30', '17:00', 'Day close', 'Update the roadmap tracker.', undefined, 'Project Manager', 'daily', 'task'),

  block('friday-triage', 'friday', 10, '08:00', '08:10', 'Morning triage', 'Check the essentials and update your task list.', undefined, 'Project Manager', 'daily', 'task'),
  block('friday-metrics', 'friday', 50, '08:10', '09:00', 'Weekly metrics review', 'Review metrics and update the dashboard.', 'End-of-week data becomes Monday insight.', 'PM', 'weekly', 'both'),
  block('friday-market-scan', 'friday', 60, '09:00', '10:00', 'Market scan', 'Review competitors, industry news, and user communities.', 'Dedicated market intelligence block.', 'Market Watcher', 'weekly', 'task'),
  block('friday-personal-retro', 'friday', 60, '10:00', '11:00', 'Personal retrospective', "Review what worked and what did not.", 'Compounds your own learning.', 'PM', 'weekly', 'task'),
  block('friday-update', 'friday', 60, '11:00', '12:00', 'Weekly stakeholder update', 'Write a weekly update for stakeholders and the team.', 'Transparent communication builds trust.', 'PM', 'weekly', 'task'),
  block('friday-lunch', 'friday', 60, '12:00', '13:00', 'Lunch', 'Take a real break.', undefined, undefined, 'daily', 'none'),
  block('friday-next-week', 'friday', 90, '13:00', '14:30', 'Next week preparation', 'Block calendar and prioritize backlog.', 'Monday starts with execution, not planning.', 'PO', 'weekly', 'both'),
  block('friday-admin', 'friday', 60, '14:30', '15:30', 'Admin catch-up', 'Catch up on documentation and admin.', undefined, 'Project Manager', 'weekly', 'task'),
  block('friday-explore', 'friday', 30, '15:30', '16:00', 'Explore and experiment', 'Explore new tools, read articles, or experiment.', 'Innovation time is worth protecting.', 'Market Watcher', 'weekly', 'calendar'),
  block('friday-close', 'friday', 30, '16:00', '16:30', 'Week close', 'Send updates and set out-of-office if needed.', undefined, 'Project Manager', 'weekly', 'task'),
];

export const ROUTINE_RITUALS: RoutineRitual[] = [
  ritual('ritual-metrics-review', 10, 'Metrics Review', ['monday', 'friday'], 30, 'Know your numbers and flag metrics moving the wrong way.', 'both'),
  ritual('ritual-backlog-grooming', 20, 'Backlog Grooming', ['monday'], 90, 'Keep the top 10 items estimated, described, and ready to pull into sprint.', 'both'),
  ritual('ritual-stakeholder-update', 30, 'Stakeholder Update', ['friday'], 30, 'Written summary of progress, decisions, and blockers.', 'task'),
  ritual('ritual-market-scan', 40, 'Market Scan', ['friday'], 30, 'Competitors, industry blogs, user community, and rival job postings.', 'task'),
  ritual('ritual-user-feedback-review', 50, 'User Feedback Review', ['tuesday'], 30, 'Support tickets, reviews, and NPS comments to keep the user voice present.', 'task'),
  ritual('ritual-design-review', 60, 'Design Review', ['tuesday', 'thursday'], 60, 'Review in-progress design with the team and catch issues early.', 'calendar'),
  ritual('ritual-personal-retro', 70, 'Personal Retro', ['friday'], 30, 'Ask what you accomplished, avoided, and should improve next week.', 'task'),
  ritual('ritual-sprint-health-check', 80, 'Sprint Health Check', ['wednesday'], 30, 'Check whether the sprint is on track and what needs attention.', 'both'),
];

export const ROUTINE_CADENCES: RoutineCadence[] = [
  {
    id: 'monthly-cadence',
    title: 'Monthly cadence',
    cadence: 'monthly',
    items: [
      'Deep metrics review: trends, cohort analysis, NPS.',
      'Roadmap review: confirm the horizon is still accurate.',
      '1:1s with key stakeholders.',
      'Competitive landscape update.',
      'Team health check.',
    ],
  },
  {
    id: 'quarterly-cadence',
    title: 'Quarterly cadence',
    cadence: 'quarterly',
    items: [
      'Full roadmap planning session: refresh Now / Next / Later.',
      'OKR or goal setting with the team.',
      'User research sprint with 3-5 user interviews.',
      'Design system audit.',
      'Retrospective on the quarter.',
      'Market analysis: pricing, positioning, and feature gaps.',
    ],
  },
];

export const MARKET_SCAN_CHECKLIST = [
  'Check 2-3 competitor websites or changelogs for new releases.',
  'Read 1 industry newsletter.',
  'Scan user communities for emerging pain points.',
  'Check app store or review-site feedback for competitors.',
  'Note pricing or positioning changes.',
  'Log findings in your changelog or roadmap template.',
];

export const MARKET_SCAN_SOURCES = [
  'Competitor changelogs',
  'G2 or Capterra reviews',
  'Reddit and forums',
  'Industry newsletters',
  'Twitter and LinkedIn follows',
  'Competitor job postings',
  'Hacker News',
  'Product Hunt launches',
];

export const ROUTINE_ANTI_PATTERNS: RoutineAntiPattern[] = [
  { id: 'anti-inbox-days', title: 'Inbox-driven days', alternative: 'Time-box email and Slack. Start with your top priority, not notifications.' },
  { id: 'anti-all-hats', title: 'All hats simultaneously', alternative: 'Assign each day a primary hat and context-switch deliberately.' },
  { id: 'anti-no-user-contact', title: 'No user contact for weeks', alternative: 'Block fortnightly user calls, even if they are only 30 minutes.' },
  { id: 'anti-roadmap-promise', title: 'Roadmap as a promise', alternative: 'Treat the roadmap as a prioritized hypothesis and communicate direction.' },
  { id: 'anti-skipping-retros', title: 'Skipping retros when busy', alternative: 'Use retros to reduce future waste, especially when busy.' },
  { id: 'anti-designing-meetings', title: 'Designing in meetings', alternative: 'Use async reviews and recorded walkthroughs where possible.' },
  { id: 'anti-loudness', title: 'Prioritizing by loudness', alternative: 'Use a prioritization model such as RICE instead of stakeholder volume.' },
  { id: 'anti-monthly-metrics', title: 'Metrics only monthly', alternative: 'Review metrics weekly for early signals, monthly for lagging trends.' },
];

function block(
  id: string,
  weekday: RoutineWeekday,
  sortOrder: number,
  startTime: string,
  endTime: string,
  title: string,
  description: string,
  why: string | undefined,
  primaryHat: RoutineTimeBlock['primaryHat'] | undefined,
  cadence: RoutineAutomation['cadence'],
  target: RoutineAutomationTarget,
): RoutineTimeBlock {
  return {
    id,
    kind: 'time-block',
    weekday,
    sortOrder,
    startTime,
    endTime,
    title,
    description,
    why,
    primaryHat,
    automation: { target, cadence, defaultDurationMinutes: minutesBetween(startTime, endTime) },
  };
}

function ritual(
  id: string,
  sortOrder: number,
  title: string,
  days: RoutineWeekday[],
  durationMinutes: number,
  output: string,
  target: RoutineAutomationTarget,
): RoutineRitual {
  return {
    id,
    kind: 'ritual',
    sortOrder,
    title,
    days,
    durationMinutes,
    output,
    automation: { target, cadence: 'weekly', defaultDurationMinutes: durationMinutes },
  };
}

function minutesBetween(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
