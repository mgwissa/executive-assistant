/** Saved conversational decisions. No calendar mutations or inferred attendance. */
export type PlannedMeeting = {
  eventId: string;
  title: string;
  startAt: string;
  endAt: string;
};

export type MeetingChoice = {
  meetings: [PlannedMeeting, PlannedMeeting];
  selectedEventId: string;
};

export type PlanQuestion = {
  id: string;
  prompt: string;
  taskId?: string;
  status: 'open' | 'resolved';
};

export type DayPlan = {
  meetingChoices: MeetingChoice[];
  questions: PlanQuestion[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

function meeting(value: unknown): value is PlannedMeeting {
  if (!record(value)) return false;
  return text(value.eventId, 100) && text(value.title, 500)
    && typeof value.startAt === 'string' && typeof value.endAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value.startAt)
    && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value.endAt)
    && Number.isFinite(Date.parse(value.startAt)) && Number.isFinite(Date.parse(value.endAt))
    && Date.parse(value.endAt) > Date.parse(value.startAt);
}

export function meetingSnapshotKey(value: PlannedMeeting): string {
  return JSON.stringify([value.eventId, value.title, Date.parse(value.startAt), Date.parse(value.endAt)]);
}

/** Strict at capture; malformed saved JSON is ignored by the read path. */
export function validateDayPlan(value: unknown): string | null {
  if (!record(value)) return 'stats.dayPlan must be an object';
  if (!Array.isArray(value.meetingChoices) || value.meetingChoices.length > 20) {
    return 'dayPlan.meetingChoices must be an array of at most 20 choices';
  }
  const selected = new Set<string>();
  const skipped = new Set<string>();
  const pairs = new Set<string>();
  for (const choice of value.meetingChoices) {
    if (!record(choice) || !Array.isArray(choice.meetings) || choice.meetings.length !== 2
      || !choice.meetings.every(meeting) || !text(choice.selectedEventId, 100)) {
      return 'each meeting choice requires two complete occurrence snapshots and selectedEventId';
    }
    const [a, b] = choice.meetings as [PlannedMeeting, PlannedMeeting];
    if (a.eventId === b.eventId || ![a.eventId, b.eventId].includes(choice.selectedEventId)) {
      return 'selectedEventId must identify one of two distinct meetings';
    }
    if (Date.parse(a.startAt) >= Date.parse(b.endAt) || Date.parse(b.startAt) >= Date.parse(a.endAt)) {
      return 'a meeting choice must refer to overlapping occurrences';
    }
    const pair = [meetingSnapshotKey(a), meetingSnapshotKey(b)].sort().join('|');
    if (pairs.has(pair)) return 'duplicate meeting choice; replace the existing choice';
    pairs.add(pair);
    for (const candidate of [a, b]) {
      const key = meetingSnapshotKey(candidate);
      (candidate.eventId === choice.selectedEventId ? selected : skipped).add(key);
    }
  }
  if ([...selected].some((key) => skipped.has(key))) return 'meeting choices contradict each other';
  if (!Array.isArray(value.questions) || value.questions.length > 3) {
    return 'dayPlan.questions must be an array of at most three questions';
  }
  const ids = new Set<string>();
  for (const question of value.questions) {
    if (!record(question) || !text(question.id, 120) || !text(question.prompt, 500)
      || (question.taskId !== undefined && !text(question.taskId, 100))
      || !['open', 'resolved'].includes(String(question.status))) {
      return 'each plan question requires id, prompt, and status open or resolved';
    }
    if (ids.has(question.id)) return 'duplicate plan question id';
    ids.add(question.id);
  }
  return null;
}

export function parseDayPlan(value: unknown): DayPlan {
  return validateDayPlan(value) === null ? value as DayPlan : { meetingChoices: [], questions: [] };
}

/** Omitted decision fields survive brief reruns; [] deliberately clears one field. */
export function mergeBriefStats(previous: unknown, incoming: unknown): Record<string, unknown> {
  const before = record(previous) ? previous : {};
  const after = record(incoming) ? incoming : {};
  const stats = { ...before, ...after };
  if (Object.hasOwn(after, 'dayPlan')) {
    if (!record(after.dayPlan)) throw new Error('stats.dayPlan must be an object');
    const oldPlan = parseDayPlan(before.dayPlan);
    const plan = { ...oldPlan, ...after.dayPlan };
    const error = validateDayPlan(plan);
    if (error) throw new Error(error);
    // A routine rerun must not reopen an identical question already answered.
    plan.questions = (plan.questions as PlanQuestion[]).map((question) => {
      const answered = oldPlan.questions.find((old) => old.id === question.id
        && old.prompt === question.prompt && old.taskId === question.taskId && old.status === 'resolved');
      return answered && question.status === 'open' ? { ...question, status: 'resolved' as const } : question;
    });
    stats.dayPlan = plan;
  }
  return stats;
}

/** A changed/cancelled/missing occurrence invalidates its old answer, fail closed. */
export function resolveMeetingChoices(meetings: PlannedMeeting[], plan: DayPlan): {
  selectedKeys: Set<string>;
  skippedKeys: Set<string>;
} {
  const current = new Set(meetings.map(meetingSnapshotKey));
  const selectedKeys = new Set<string>();
  const skippedKeys = new Set<string>();
  for (const choice of plan.meetingChoices) {
    if (!choice.meetings.every((candidate) => current.has(meetingSnapshotKey(candidate)))) continue;
    for (const candidate of choice.meetings) {
      const key = meetingSnapshotKey(candidate);
      (candidate.eventId === choice.selectedEventId ? selectedKeys : skippedKeys).add(key);
    }
  }
  return { selectedKeys, skippedKeys };
}
