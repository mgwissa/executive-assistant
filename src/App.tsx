import { useEffect } from 'react';
import { Auth } from './components/Auth';
import { Calendar } from './components/Calendar';
import { Dashboard } from './components/Dashboard';
import { Editor } from './components/Editor';
import { EmergencyBanner } from './components/EmergencyBanner';
import { EmergencyMode } from './components/EmergencyMode';
import { Profile } from './components/Profile';
import { SideNav } from './components/SideNav';
import { Sidebar } from './components/Sidebar';
import { Tasks } from './components/Tasks';
import { TopBar } from './components/TopBar';
import { useCriticalOverload } from './hooks/useCriticalOverload';
import { useNotebookRealtime } from './hooks/useNotebookRealtime';
import { PENDING_NOTEBOOK_INVITE_KEY } from './lib/notebookSharing';
import { useAuthStore } from './store/useAuthStore';
import { useEmergencyStore } from './store/useEmergencyStore';
import { useEventsStore } from './store/useEventsStore';
import { useNotebooksStore } from './store/useNotebooksStore';
import { useNotesStore } from './store/useNotesStore';
import { useProfileStore } from './store/useProfileStore';
import { useSharingStore } from './store/useSharingStore';
import { useTasksStore } from './store/useTasksStore';
import { useViewStore } from './store/useViewStore';
import { eventsFetchIsoRange } from './lib/eventQueries';

function NotesView() {
  const user = useAuthStore((s) => s.user);
  useNotebookRealtime(user?.id);
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
  const emergency = useCriticalOverload();
  const bypassEmergency = useEmergencyStore((s) => s.bypass);
  const setBypassEmergency = useEmergencyStore((s) => s.setBypass);
  const clearEmergency = useEmergencyStore((s) => s.clear);

  useEffect(() => {
    if (!emergency.active) setBypassEmergency(false);
  }, [emergency.active, setBypassEmergency]);

  useEffect(() => () => clearEmergency(), [clearEmergency]);

  const fetchNotebooks = useNotebooksStore((s) => s.fetchAll);
  const ensureDefaultNotebook = useNotebooksStore((s) => s.ensureDefault);
  const clearNotebooks = useNotebooksStore((s) => s.clear);
  const fetchNotes = useNotesStore((s) => s.fetchAll);
  const clearNotes = useNotesStore((s) => s.clear);
  const clearSharing = useSharingStore((s) => s.clear);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  const clearProfile = useProfileStore((s) => s.clear);
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const fetchTasks = useTasksStore((s) => s.fetchAll);
  const applyEscalationFromProfile = useTasksStore((s) => s.applyEscalationFromProfile);
  const clearTasks = useTasksStore((s) => s.clear);
  const fetchEventsRange = useEventsStore((s) => s.fetchRange);
  const clearEvents = useEventsStore((s) => s.clear);
  const view = useViewStore((s) => s.view);

  useEffect(() => {
    if (user) {
      void fetchNotebooks(user.id).then(() => ensureDefaultNotebook(user.id));
      fetchNotes(user.id);
      fetchProfile(user.id);
      fetchTasks(user.id);
      const { fromIso, toIso } = eventsFetchIsoRange(profile?.timezone);
      fetchEventsRange(user.id, fromIso, toIso);
    } else {
      clearNotebooks();
      clearNotes();
      clearSharing();
      clearProfile();
      clearTasks();
      clearEvents();
    }
  }, [
    user,
    profile?.timezone,
    fetchNotebooks,
    ensureDefaultNotebook,
    clearNotebooks,
    fetchNotes,
    clearNotes,
    clearSharing,
    fetchProfile,
    clearProfile,
    fetchEventsRange,
    fetchTasks,
    clearTasks,
    clearEvents,
  ]);

  useEffect(() => {
    if (!user) return;

    const consumeInvite = async () => {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('invite');
      const fromStorage = sessionStorage.getItem(PENDING_NOTEBOOK_INVITE_KEY);
      const token = fromUrl ?? fromStorage;
      if (!token) return;

      sessionStorage.removeItem(PENDING_NOTEBOOK_INVITE_KEY);
      if (fromUrl) {
        params.delete('invite');
        const search = params.toString();
        const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', next);
      }

      try {
        const notebookId = await useSharingStore.getState().acceptInvite(token);
        await useNotebooksStore.getState().fetchAll(user.id);
        await useNotesStore.getState().fetchAll(user.id);
        useNotebooksStore.getState().setActiveNotebook(notebookId);
        useViewStore.getState().setView('notes');
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : 'Could not accept invite';
        window.alert(msg);
      }
    };

    void consumeInvite();
  }, [user]);

  useEffect(() => {
    if (!user || !profile) return;
    const tz = profile.timezone?.trim();
    if (tz) return;
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTz) return;
    updateProfile(user.id, { timezone: browserTz });
  }, [user, profile, updateProfile]);

  useEffect(() => {
    if (!user || !profile) return;
    void applyEscalationFromProfile(user.id);
  }, [user, profile?.user_id, profile?.priority_escalation, applyEscalationFromProfile]);

  const showEmergency = emergency.active && !bypassEmergency;
  const showEmergencyBanner = emergency.active && bypassEmergency;

  if (showEmergency) {
    return (
      <div className="app-shell flex h-full min-h-0 flex-col">
        <EmergencyMode reason={emergency} onExit={() => setBypassEmergency(true)} />
      </div>
    );
  }

  return (
    <div className="app-shell flex h-full min-h-0">
      <SideNav />
      <div className="flex min-h-0 flex-1 flex-col">
        {showEmergencyBanner ? <EmergencyBanner reason={emergency} /> : null}
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

  useEffect(() => {
    if (loading) return;
    if (session) return;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (!invite) return;
    sessionStorage.setItem(PENDING_NOTEBOOK_INVITE_KEY, invite);
    params.delete('invite');
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
  }, [loading, session]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Loading…
      </div>
    );
  }

  return session ? <Shell /> : <Auth />;
}
