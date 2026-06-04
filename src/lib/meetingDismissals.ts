import {
  appendMeetingRule,
  buildMeetingRule,
  DEFAULT_ALLOW_BACK_TO_BACK,
  DEFAULT_DEBRIEF_REQUIRED,
  DEFAULT_PREP_REQUIRED,
  eventsMatchingMeetingTitle,
  parseMeetingRules,
  removeMeetingRule,
  type MeetingRule,
} from './meetingTemperament';
import { useEventsStore } from '../store/useEventsStore';
import { useProfileStore } from '../store/useProfileStore';
import type { Json } from '../types/database';

export async function persistMeetingRule(
  userId: string,
  meetingTitle: string,
  flags: { prep_required?: boolean; allow_back_to_back?: boolean; debrief_required?: boolean },
) {
  const profile = useProfileStore.getState().profile;
  const rules = appendMeetingRule(
    parseMeetingRules(profile?.meeting_rules),
    buildMeetingRule(meetingTitle, flags),
  );
  if (profile) {
    useProfileStore.setState({ profile: { ...profile, meeting_rules: rules as Json } });
  }
  await useProfileStore.getState().updateProfile(userId, { meeting_rules: rules as Json });
  return rules;
}

export async function dismissPrepForMeeting(
  userId: string,
  eventId: string,
  meetingTitle: string,
  applyToAll: boolean,
) {
  const updateEvent = useEventsStore.getState().updateEvent;
  if (applyToAll) {
    await persistMeetingRule(userId, meetingTitle, { prep_required: false });
    for (const e of eventsMatchingMeetingTitle(useEventsStore.getState().events, meetingTitle)) {
      await updateEvent(e.id, { prep_required: false });
    }
  } else {
    await updateEvent(eventId, { prep_required: false });
  }
}

export async function dismissBackToBackForMeeting(
  userId: string,
  eventId: string,
  relatedEventId: string | undefined,
  meetingTitle: string,
  applyToAll: boolean,
) {
  const updateEvent = useEventsStore.getState().updateEvent;
  await updateEvent(eventId, { allow_back_to_back: true });
  if (relatedEventId) await updateEvent(relatedEventId, { allow_back_to_back: true });
  if (applyToAll) {
    await persistMeetingRule(userId, meetingTitle, { allow_back_to_back: true });
    for (const e of eventsMatchingMeetingTitle(useEventsStore.getState().events, meetingTitle)) {
      await updateEvent(e.id, { allow_back_to_back: true });
    }
  }
}

export async function dismissDebriefForMeeting(
  userId: string,
  eventId: string,
  meetingTitle: string,
  applyToAll: boolean,
) {
  const updateEvent = useEventsStore.getState().updateEvent;
  if (applyToAll) {
    await persistMeetingRule(userId, meetingTitle, { debrief_required: false });
    for (const e of eventsMatchingMeetingTitle(useEventsStore.getState().events, meetingTitle)) {
      await updateEvent(e.id, { debrief_required: false });
    }
  } else {
    await updateEvent(eventId, { debrief_required: false });
  }
}

export async function removeProfileMeetingRule(userId: string, ruleId: string) {
  const profile = useProfileStore.getState().profile;
  const rules = removeMeetingRule(parseMeetingRules(profile?.meeting_rules), ruleId);
  if (profile) {
    useProfileStore.setState({ profile: { ...profile, meeting_rules: rules as Json } });
  }
  await useProfileStore.getState().updateProfile(userId, { meeting_rules: rules as Json });
}

/** Clears title rules and restores default assistant flags on every calendar event. */
export async function resetMeetingAssistantPreferences(userId: string) {
  const profile = useProfileStore.getState().profile;
  if (profile) {
    useProfileStore.setState({ profile: { ...profile, meeting_rules: [] as Json } });
  }
  await useProfileStore.getState().updateProfile(userId, { meeting_rules: [] as Json });
  await useEventsStore.getState().resetAssistantFlags(userId);
}

export function displayTitlePattern(pattern: string): string {
  return pattern.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
}

export function describeMeetingRule(rule: MeetingRule): string {
  const parts: string[] = [];
  if (rule.prep_required === false) parts.push('No prep');
  if (rule.allow_back_to_back === true) parts.push('Back-to-back OK');
  if (rule.debrief_required === false) parts.push('No debrief');
  return parts.length > 0 ? parts.join(' · ') : 'Custom rule';
}

export {
  DEFAULT_ALLOW_BACK_TO_BACK,
  DEFAULT_DEBRIEF_REQUIRED,
  DEFAULT_PREP_REQUIRED,
};
