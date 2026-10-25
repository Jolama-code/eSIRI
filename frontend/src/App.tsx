import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Landing from './pages/Landing';
import Rooms from './pages/Rooms';
import Recordings from './pages/Recordings';
import RoomPage from './pages/RoomPage';
import Meeting from './pages/Meeting';
import Audit from './pages/Audit';
import Login from './hub/Login';
import Today from './hub/Today';
import Tasks from './hub/Tasks';
import Meetings from './hub/Meetings';
import { MinutesDetail, MinutesList } from './hub/Minutes';
import { Activity, Notifications, Settings, Systems } from './hub/MorePages';
import { GmsCompose, GmsLogin, GmsMailbox } from './gms/Gms';
import { WerisDashboard, WerisPdp, WerisProjects, WerisTasks } from './weris/Weris';
import { WerisIndividualReport, WerisReports } from './weris/Report';
import { Toasts } from './components/Common';
import { EsiriRoot } from './esiri/ui/EsiriRoot';
import { setNavigator, systemFromPath } from './esiri/nav';
import { useEsiri } from './esiri/esiriStore';
import { useSession } from './esiri/session';
import { Orb } from './esiri/ui/Orb';

function NavBridge() {
  const navigate = useNavigate();
  useEffect(() => setNavigator(navigate), [navigate]);
  return null;
}

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--nuru-frost)' }} data-testid="splash">
      <Orb size={96} state="thinking" />
    </div>
  );
}

/** Single sign-on: every system needs the NURU session (signing in to the Hub signs in everywhere). */
export function RequireNuru({ children, login = '/hub/login' }: { children: ReactNode; login?: string }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'checking') return <Splash />;
  if (status === 'anon') return <Navigate to={`${login}?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

/** Remount the room page when the room changes (resets the selected tab). */
function RoomRoute() {
  const { roomId } = useParams();
  return <RoomPage key={roomId} />;
}

function Shell() {
  const panelOpen = useEsiri((s) => s.panelOpen);
  const location = useLocation();
  const onMeeting = /^\/rooms\/[^/]+\/meeting/.test(location.pathname);
  const system = systemFromPath(location.pathname);
  return (
    <div className={`app-shell sys-${system} ${panelOpen ? 'panel-open' : ''} ${onMeeting ? 'on-meeting' : ''}`}>
      <NavBridge />
      <Routes>
        {/* NURU Hub */}
        <Route path="/hub/login" element={<Login />} />
        <Route path="/hub" element={<RequireNuru><Today /></RequireNuru>} />
        <Route path="/hub/tasks" element={<RequireNuru><Tasks /></RequireNuru>} />
        <Route path="/hub/meetings" element={<RequireNuru><Meetings /></RequireNuru>} />
        <Route path="/hub/minutes" element={<RequireNuru><MinutesList /></RequireNuru>} />
        <Route path="/hub/minutes/:jobId" element={<RequireNuru><MinutesDetail /></RequireNuru>} />
        <Route path="/hub/notifications" element={<RequireNuru><Notifications /></RequireNuru>} />
        <Route path="/hub/systems" element={<RequireNuru><Systems /></RequireNuru>} />
        <Route path="/hub/activity" element={<RequireNuru><Activity /></RequireNuru>} />
        <Route path="/hub/settings" element={<RequireNuru><Settings /></RequireNuru>} />
        <Route path="/hub/*" element={<Navigate to="/hub" replace />} />

        {/* GMS mock */}
        <Route path="/gms/login" element={<GmsLogin />} />
        <Route path="/gms" element={<Navigate to="/gms/inbox" replace />} />
        <Route path="/gms/compose" element={<RequireNuru login="/gms/login"><GmsCompose /></RequireNuru>} />
        <Route path="/gms/:folder" element={<RequireNuru login="/gms/login"><GmsMailbox /></RequireNuru>} />
        <Route path="/gms/:folder/:mailId" element={<RequireNuru login="/gms/login"><GmsMailbox /></RequireNuru>} />

        {/* WERIS mock */}
        <Route path="/weris" element={<RequireNuru><WerisDashboard /></RequireNuru>} />
        <Route path="/weris/projects" element={<RequireNuru><WerisProjects /></RequireNuru>} />
        <Route path="/weris/pdp" element={<RequireNuru><WerisPdp /></RequireNuru>} />
        <Route path="/weris/tasks" element={<RequireNuru><WerisTasks /></RequireNuru>} />
        <Route path="/weris/reports" element={<RequireNuru><WerisReports /></RequireNuru>} />
        <Route path="/weris/reports/individual" element={<RequireNuru><WerisIndividualReport /></RequireNuru>} />
        <Route path="/weris/*" element={<Navigate to="/weris" replace />} />

        {/* e-Mikutano */}
        <Route path="/" element={<Landing />} />
        <Route path="/rooms" element={<RequireNuru><Rooms /></RequireNuru>} />
        <Route path="/recordings" element={<RequireNuru><Recordings /></RequireNuru>} />
        <Route path="/rooms/:roomId" element={<RequireNuru><RoomRoute /></RequireNuru>} />
        <Route path="/rooms/:roomId/meeting" element={<Meeting />} />
        <Route path="/audit" element={<RequireNuru><Audit /></RequireNuru>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
      <EsiriRoot />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
