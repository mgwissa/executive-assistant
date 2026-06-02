import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { Auth } from './components/Auth';
import { AssistantPage } from './components/AssistantPage';
import { Calendar } from './components/Calendar';
import { Dashboard } from './components/Dashboard';
import { MemoryPage } from './components/MemoryPage';
import { OwedToMePage } from './components/OwedToMePage';
import { Profile } from './components/Profile';
import { RequireOptionalFeature } from './components/RequireOptionalFeature';
import { ResetPassword } from './components/ResetPassword';
import { TimeTrackingPage } from './components/TimeTrackingPage';
import { UsefulLinksPage } from './components/UsefulLinksPage';
import { Editor } from './components/Editor';
import { BookIcon, ChevronRightIcon } from './components/icons';
import { SideNav } from './components/SideNav';
import { Sidebar } from './components/Sidebar';
import { Tasks } from './components/Tasks';
import { TopBar } from './components/TopBar';
import { WorkNudgeHost } from './components/WorkNudgeHost';
import { WeeklyRoutinePage } from './components/WeeklyRoutinePage';
import { useNotebookRealtime } from './hooks/useNotebookRealtime';
import { eventsFetchIsoRange } from './lib/eventQueries';
import { debriefFetchRangeForDay } from './lib/meetingDebrief';
import { resolveCalendarTimeZone } from './lib/calendarWeek';
import { PENDING_NOTEBOOK_INVITE_KEY } from './lib/notebookSharing';
import { viewPath } from './lib/routes';
import { useAuthStore } from './store/useAuthStore';
import { useShellLayoutStore } from './store/useShellLayoutStore';
import { useEventsStore } from './store/useEventsStore';
import { useMeetingDebriefStore } from './store/useMeetingDebriefStore';
import { useNotebooksStore } from './store/useNotebooksStore';
import { useNotesStore } from './store/useNotesStore';
import { useProfileStore } from './store/useProfileStore';
import { useSharingStore } from './store/useSharingStore';
import { useTasksStore } from './store/useTasksStore';
import { useToastStore } from './store/useToastStore';
import { useTimeEntriesStore } from './store/useTimeEntriesStore';
import { useTimeProjectsStore } from './store/useTimeProjectsStore';
import { useUsefulLinksStore } from './store/useUsefulLinksStore';
import { useWeeklyRoutineStore } from './store/useWeeklyRoutineStore';

function NotesView() {
  const user = useAuthStore((s) => s.user);
  const notesSidebarCollapsed = useShellLayoutStore((s) => s.notesSidebarCollapsed);
  const toggleNotesSidebar = useShellLayoutStore((s) => s.toggleNotesSidebar);
  const activeNoteId = useNotesStore((s) => s.activeId);
  useNotebookRealtime(user?.id);

  // Mobile single-pane: list when no note selected, editor when one is open.
  // Tailwind md breakpoint (768px) toggles us back to the two-pane layout.
  const showSidebarOnMobile = !activeNoteId;

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Sidebar: visible on desktop always; on mobile only when no note open. */}
      <div
        className={[
          showSidebarOnMobile ? 'flex w-full' : 'hidden',
          'md:flex md:w-auto',
        ].join(' ')}
      >
        {notesSidebarCollapsed ? (
          <button
            type="button"
            onClick={toggleNotesSidebar}
            className="hidden h-full w-11 shrink-0 flex-col items-center gap-3 border-r border-border-strong bg-gradient-to-b from-surface-sunken via-surface-sunken to-brand-50/[0.12] pt-3 text-text-muted transition-colors hover:bg-black/[0.04] hover:text-text dark:to-brand-950/[0.12] dark:hover:bg-white/[0.05] md:flex"
            title="Show note list"
            aria-expanded={false}
          >
            <ChevronRightIcon className="h-5 w-5 shrink-0" />
            <BookIcon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          </button>
        ) : (
          <Sidebar />
        )}
      </div>

      {/* Editor: full width on mobile when a note is open. */}
      <main
        className={[
          showSidebarOnMobile ? 'hidden' : 'flex w-full',
          'md:flex md:w-auto md:min-w-0 md:flex-1',
          'min-w-0 flex-1 bg-surface',
        ].join(' ')}
      >
        <Editor />
      </main>
    </div>
  );
}

function Shell() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const mobileNavOpen = useShellLayoutStore((s) => s.mobileNavOpen);
  const closeMobileNav = useShellLayoutStore((s) => s.closeMobileNav);

  // Mobile nav drawer UX: close on Escape, lock background scroll while open.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileNav();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileNavOpen, closeMobileNav]);

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
  const fetchTimeEntries = useTimeEntriesStore((s) => s.fetchAll);
  const clearTimeEntries = useTimeEntriesStore((s) => s.clear);
  const fetchTimeProjects = useTimeProjectsStore((s) => s.fetchAll);
  const clearTimeProjects = useTimeProjectsStore((s) => s.clear);
  const fetchUsefulLinks = useUsefulLinksStore((s) => s.fetchAll);
  const clearUsefulLinks = useUsefulLinksStore((s) => s.clear);
  const clearWeeklyRoutine = useWeeklyRoutineStore((s) => s.clear);
  const fetchEventsRange = useEventsStore((s) => s.fetchRange);
  const clearEvents = useEventsStore((s) => s.clear);
  const fetchDebriefRange = useMeetingDebriefStore((s) => s.fetchRange);
  const clearDebrief = useMeetingDebriefStore((s) => s.clear);
  const clearToasts = useToastStore((s) => s.clear);

  useEffect(() => {
    if (user) {
      void fetchNotebooks(user.id).then(() => ensureDefaultNotebook(user.id));
      fetchNotes(user.id);
      fetchProfile(user.id);
      fetchTasks(user.id);
      fetchUsefulLinks(user.id);
      fetchTimeEntries(user.id);
      void fetchTimeProjects(user.id);
      const tz = resolveCalendarTimeZone(profile?.timezone);
      const { fromIso, toIso } = eventsFetchIsoRange(profile?.timezone);
      fetchEventsRange(user.id, fromIso, toIso);
      const debriefRange = debriefFetchRangeForDay(new Date(), tz);
      void fetchDebriefRange(user.id, debriefRange.fromIso, debriefRange.toIso);
    } else {
      clearNotebooks();
      clearNotes();
      clearSharing();
      clearProfile();
      clearTasks();
      clearUsefulLinks();
      clearTimeEntries();
      clearTimeProjects();
      clearWeeklyRoutine();
      clearEvents();
      clearDebrief();
      clearToasts();
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
    fetchDebriefRange,
    fetchTasks,
    clearTasks,
    fetchUsefulLinks,
    clearUsefulLinks,
    fetchTimeEntries,
    clearTimeEntries,
    fetchTimeProjects,
    clearTimeProjects,
    clearWeeklyRoutine,
    clearEvents,
    clearDebrief,
    clearToasts,
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
        navigate(viewPath('notes'), { replace: true });
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : 'Could not accept invite';
        window.alert(msg);
      }
    };

    void consumeInvite();
  }, [user, navigate]);

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
  }, [user, profile, applyEscalationFromProfile]);

  return (
    <div className="app-shell flex h-full min-h-0">
      {/* Persistent left rail on tablet/desktop. */}
      <div className="hidden md:flex">
        <SideNav />
      </div>

      {/* Mobile slide-out drawer. Rendered always so the slide animation can
          play on close; pointer events disabled when hidden. */}
      <div
        className={[
          'fixed inset-0 z-40 md:hidden',
          mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
        aria-hidden={!mobileNavOpen}
      >
        <button
          type="button"
          tabIndex={mobileNavOpen ? 0 : -1}
          aria-label="Close navigation"
          onClick={closeMobileNav}
          className={[
            'absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200',
            mobileNavOpen ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        />
        <div
          id="mobile-primary-nav"
          className={[
            'absolute inset-y-0 left-0 transition-transform duration-200 ease-out',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <SideNav mobile />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
      <WorkNudgeHost />
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

  if (!session) {
    return <Auth />;
  }

  return (
    <Routes>
      <Route path="reset-password" element={<ResetPassword />} />
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route
          path="assistant"
          element={
            <RequireOptionalFeature featureId="assistant">
              <AssistantPage />
            </RequireOptionalFeature>
          }
        />
        <Route path="calendar" element={<Calendar />} />
        <Route path="links" element={<UsefulLinksPage />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="owed" element={<OwedToMePage />} />
        <Route path="notes" element={<NotesView />} />
        <Route
          path="time"
          element={
            <RequireOptionalFeature featureId="time">
              <TimeTrackingPage />
            </RequireOptionalFeature>
          }
        />
        <Route
          path="routine"
          element={
            <RequireOptionalFeature featureId="routine">
              <WeeklyRoutinePage />
            </RequireOptionalFeature>
          }
        />
        <Route
          path="memory"
          element={
            <RequireOptionalFeature featureId="memory">
              <MemoryPage />
            </RequireOptionalFeature>
          }
        />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
