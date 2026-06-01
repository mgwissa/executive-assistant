import type { ReactElement } from 'react';
import type { SVGProps } from 'react';
import {
  CalendarIcon,
  BookIcon,
  BrainIcon,
  CheckSquareIcon,
  ClockIcon,
  HomeIcon,
  InboxIcon,
  LinkIcon,
  NoteIcon,
  UserIcon,
} from '../components/icons';
import type { View } from './routes';
import type { Profile } from '../types';

/** IDs for optional features the user can turn on in Profile (`profiles.enabled_addons`). */
export const OPTIONAL_FEATURE_IDS = ['time', 'routine', 'assistant'] as const;
export type OptionalFeatureId = (typeof OPTIONAL_FEATURE_IDS)[number];

export function isOptionalFeatureId(value: string): value is OptionalFeatureId {
  return (OPTIONAL_FEATURE_IDS as readonly string[]).includes(value);
}

export function sortOptionalFeatureIds(ids: string[] | null | undefined): OptionalFeatureId[] {
  const set = new Set<string>(ids ?? []);
  return OPTIONAL_FEATURE_IDS.filter((id) => set.has(id));
}

export function isOptionalFeatureEnabled(
  profile: Profile | null | undefined,
  id: OptionalFeatureId,
): boolean {
  return !!(profile?.enabled_addons ?? []).includes(id);
}

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

export type NavAccent = 'brand' | 'blue' | 'purple' | 'amber' | 'green';

export type NavItemDef = {
  id: View;
  label: string;
  Icon: IconComponent;
  accent: NavAccent;
};

export const OPTIONAL_FEATURE_NAV: Record<
  OptionalFeatureId,
  { label: string; description: string; Icon: IconComponent; accent: NavAccent }
> = {
  time: {
    label: 'Time tracking',
    description:
      'Run timers, optional tasks and projects, editable history grouped by day.',
    Icon: ClockIcon,
    accent: 'blue',
  },
  routine: {
    label: 'Weekly routine',
    description:
      'Follow a product-leader operating rhythm with daily blocks, rituals, and progress tracking.',
    Icon: BookIcon,
    accent: 'purple',
  },
  assistant: {
    label: 'Executive Assistant',
    description:
      'Proactive daily briefings, blind-spot detection, schedule gap analysis, and decision prompts when work keeps slipping.',
    Icon: BrainIcon,
    accent: 'brand',
  },
};

const CORE_NAV_ORDER: NavItemDef[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: HomeIcon, accent: 'purple' },
  { id: 'links', label: 'Links', Icon: LinkIcon, accent: 'brand' },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon, accent: 'blue' },
  { id: 'tasks', label: 'Tasks', Icon: CheckSquareIcon, accent: 'amber' },
  { id: 'owed', label: 'Owed to me', Icon: InboxIcon, accent: 'green' },
  { id: 'notes', label: 'Notes', Icon: NoteIcon, accent: 'brand' },
];

export const PROFILE_NAV_ITEM: NavItemDef = {
  id: 'profile',
  label: 'Profile',
  Icon: UserIcon,
  accent: 'green',
};

export function buildSideNavItems(
  profileEnabledFeatureIds: string[] | null | undefined,
): NavItemDef[] {
  const featureIds = sortOptionalFeatureIds(profileEnabledFeatureIds);
  const featureItems: NavItemDef[] = featureIds.map((id) => {
    const def = OPTIONAL_FEATURE_NAV[id];
    return {
      id,
      label: def.label,
      Icon: def.Icon,
      accent: def.accent,
    };
  });
  return [...CORE_NAV_ORDER, ...featureItems, PROFILE_NAV_ITEM];
}
