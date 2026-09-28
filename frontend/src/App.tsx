import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Landing from './pages/Landing';
import Rooms from './pages/Rooms';
import Recordings from './pages/Recordings';
import RoomPage from './pages/RoomPage';
import Meeting from './pages/Meeting';
import Audit from './pages/Audit';
import { Toasts } from './components/Common';
import { EsiriRoot } from './esiri/ui/EsiriRoot';
import { pageFromPath, setNavigator } from './esiri/nav';
import { useApp } from './store/appStore';
import { useEsiri } from './esiri/esiriStore';

function NavBridge() {
  const navigate = useNavigate();
  useEffect(() => setNavigator(navigate), [navigate]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const signedIn = useApp((s) => s.signedIn);
  return signedIn ? <>{children}</> : <Navigate to="/" replace />;
}

/** Remount the room page when the room changes (resets the selected tab). */
function RoomRoute() {
  const { roomId } = useParams();
  return <RoomPage key={roomId} />;
}

function Shell() {
  const panelOpen = useEsiri((s) => s.panelOpen);
  const onMeeting = pageFromPath(useLocation().pathname) === 'meeting';
  return (
    <div className={`app-shell ${panelOpen ? 'panel-open' : ''} ${onMeeting ? 'on-meeting' : ''}`}>
      <NavBridge />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/rooms" element={<RequireAuth><Rooms /></RequireAuth>} />
        <Route path="/recordings" element={<RequireAuth><Recordings /></RequireAuth>} />
        <Route path="/rooms/:roomId" element={<RequireAuth><RoomRoute /></RequireAuth>} />
        <Route path="/rooms/:roomId/meeting" element={<Meeting />} />
        <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
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
