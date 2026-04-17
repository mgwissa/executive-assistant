import { useEffect } from 'react';
import { Auth } from './components/Auth';
import { Calendar } from './components/Calendar';
import { Dashboard } from './components/Dashboard';
import { Editor } from './components/Editor';
import { Profile } from './components/Profile';
import { SideNav } from './components/SideNav';
import { Sidebar } from './components/Sidebar';
import { Tasks } from './components/Tasks';
import { TopBar } from './components/TopBar';
import { useAuthStore } from './store/useAuthStore';
import { useEventsStore } from './store/useEventsStore';
import { useNotesStore } from './store/useNotesStore';
import { useProfileStore } from './store/useProfileStore';
import { useTasksStore } from './store/useTasksStore';
import { useViewStore } from './store/useViewStore';
import { eventsFetchIsoRange } from './lib/eventQueries';

function NotesView() {
  return (
    <div className="flex h-full min-w-0 flex-1">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-surface">
        <Editor />
      </main>
    </div>
  );
}

function Shell() {
  const user = useAuthStore((s) => s.user);
  const fetchAll = useNotesStore((s) => s.fetchAll);
  const clearNotes = useNotesStore((s) => s.clear);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  const clearProfile = useProfileStore((s) => s.clear);
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const fetchTasks = useTasksStore((s) => s.fetchAll);
  const clearTasks = useTasksStore((s) => s.clear);
  const fetchEventsRange = useEventsStore((s) => s.fetchRange);
  const clearEvents = useEventsStore((s) => s.clear);
  const view = useViewStore((s) => s.view);

  useEffect(() => {
    if (user) {
      fetchAll(user.id);
      fetchProfile(user.id);
      fetchTasks(user.id);
      const { fromIso, toIso } = eventsFetchIsoRange(profile?.timezone);
      fetchEventsRange(user.id, fromIso, toIso);
    } else {
      clearNotes();
      clearProfile();
      clearTasks();
      clearEvents();
    }
  }, [
    user,
    profile?.timezone,
    fetchAll,
    clearNotes,
    fetchProfile,
    clearProfile,
    fetchEventsRange,
    fetchTasks,
    clearTasks,
    clearEvents,
  ]);

  useEffect(() => {
    if (!user || !profile) return;
    const tz = profile.timezone?.trim();
    if (tz) return;
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTz) return;
    updateProfile(user.id, { timezone: browserTz });
  }, [user, profile, updateProfile]);

  return (
    <div className="app-shell flex h-full">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1">
          {view === 'dashboard' && <Dashboard />}
          {view === 'calendar' && <Calendar />}
          {view === 'tasks' && <Tasks />}
          {view === 'notes' && <NotesView />}
          {view === 'profile' && <Profile />}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { session, loading, init } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Loading…
      </div>
    );
  }

  return session ? <Shell /> : <Auth />;
}
