import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { WEEKLY_ROUTINE_TEMPLATE_VERSION } from '../lib/weeklyRoutineGuide';
import type { RoutineStatus } from '../lib/weeklyRoutine';
import type { RoutineItemState } from '../types';

type WeeklyRoutineState = {
  states: RoutineItemState[];
  loading: boolean;
  error: string | null;

  fetchRange: (userId: string, fromDate: string, toDate: string) => Promise<void>;
  setItemStatus: (
    userId: string,
    routineDate: string,
    itemId: string,
    status: RoutineStatus,
  ) => Promise<void>;
  clear: () => void;
};

function sameRoutineState(
  row: Pick<RoutineItemState, 'user_id' | 'routine_date' | 'item_id' | 'template_version'>,
  userId: string,
  routineDate: string,
  itemId: string,
): boolean {
  return (
    row.user_id === userId &&
    row.routine_date === routineDate &&
    row.item_id === itemId &&
    row.template_version === WEEKLY_ROUTINE_TEMPLATE_VERSION
  );
}

function mergeState(list: RoutineItemState[], next: RoutineItemState): RoutineItemState[] {
  const exists = list.some((row) =>
    sameRoutineState(row, next.user_id, next.routine_date, next.item_id),
  );
  if (!exists) return [...list, next];
  return list.map((row) =>
    sameRoutineState(row, next.user_id, next.routine_date, next.item_id) ? next : row,
  );
}

export const useWeeklyRoutineStore = create<WeeklyRoutineState>((set, get) => ({
  states: [],
  loading: false,
  error: null,

  fetchRange: async (userId, fromDate, toDate) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('routine_item_states')
      .select('*')
      .eq('user_id', userId)
      .eq('template_version', WEEKLY_ROUTINE_TEMPLATE_VERSION)
      .gte('routine_date', fromDate)
      .lte('routine_date', toDate)
      .order('routine_date', { ascending: true })
      .order('item_id', { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({ states: data ?? [], loading: false, error: null });
  },

  setItemStatus: async (userId, routineDate, itemId, status) => {
    const prev = get().states;
    set({ error: null });

    if (status === 'pending') {
      set({
        states: prev.filter((row) => !sameRoutineState(row, userId, routineDate, itemId)),
      });
      const { error } = await supabase
        .from('routine_item_states')
        .delete()
        .eq('user_id', userId)
        .eq('routine_date', routineDate)
        .eq('item_id', itemId)
        .eq('template_version', WEEKLY_ROUTINE_TEMPLATE_VERSION);

      if (error) set({ states: prev, error: error.message });
      return;
    }

    const completedAt = status === 'done' ? new Date().toISOString() : null;
    const optimistic: RoutineItemState = {
      id: `tmp-${userId}-${routineDate}-${itemId}`,
      user_id: userId,
      template_version: WEEKLY_ROUTINE_TEMPLATE_VERSION,
      routine_date: routineDate,
      item_id: itemId,
      status,
      completed_at: completedAt,
      notes: '',
      task_id: null,
      event_id: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    set({ states: mergeState(prev, optimistic) });

    const { data, error } = await supabase
      .from('routine_item_states')
      .upsert(
        {
          user_id: userId,
          template_version: WEEKLY_ROUTINE_TEMPLATE_VERSION,
          routine_date: routineDate,
          item_id: itemId,
          status,
          completed_at: completedAt,
        },
        { onConflict: 'user_id,routine_date,item_id,template_version' },
      )
      .select()
      .single();

    if (error || !data) {
      set({ states: prev, error: error?.message ?? 'Could not update routine item' });
      return;
    }

    set({ states: mergeState(get().states, data) });
  },

  clear: () => set({ states: [], loading: false, error: null }),
}));
