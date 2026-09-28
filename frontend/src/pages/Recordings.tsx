import { CompactHeader, PageFooter } from '../components/Header';
import { RecordingList } from '../components/RecordingList';
import { useT } from '../i18n';
import { useApp } from '../store/appStore';
import { DashboardTabs } from './Rooms';
import './Rooms.css';

export default function Recordings() {
  const t = useT();
  const recordings = useApp((s) => s.recordings);
  const sorted = [...recordings].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="page dash">
      <CompactHeader />
      <DashboardTabs active="recordings" />
      <main className="dash-main">
        <div className="container">
          <h2 className="section-title">{t('recordings.allTitle')}</h2>
          <div className="card" style={{ padding: 8 }}>
            <RecordingList recordings={sorted} showRoom />
          </div>
        </div>
      </main>
      <PageFooter />
    </div>
  );
}
