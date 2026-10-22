import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { FullHeader } from '../components/Header';
import { ez } from '../components/esiriProps';
import { useT } from '../i18n';
import { useApp } from '../store/appStore';
import { useSession } from '../esiri/session';
import './Landing.css';

export default function Landing() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const language = useApp((s) => s.language);
  const setLanguage = useApp((s) => s.setLanguage);
  const signIn = useApp((s) => s.signIn);
  const authed = useSession((s) => s.status === 'authed');
  const rooms = useApp((s) => s.rooms);
  const [token, setToken] = useState(params.get('token') ?? '');
  const [error, setError] = useState<'empty' | 'invalid' | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const p = params.get('token');
    if (p) setToken(p);
  }, [params]);

  const join = (e?: FormEvent) => {
    e?.preventDefault();
    const clean = token.trim().toUpperCase();
    if (!clean) return setError('empty');
    const room = rooms.find((r) => r.token.toUpperCase() === clean);
    if (!room) return setError('invalid');
    setError(null);
    navigate(`/rooms/${room.id}/meeting`);
  };

  return (
    <div className="page landing">
      <FullHeader />
      <main className="landing-main">
        <section className="landing-card">
          <div className="landing-card-top">
            <div className="lang-box">
              <button
                className={`lang-btn ${language === 'sw' ? 'active' : ''}`}
                onClick={() => setLanguage('sw')}
                {...ez('landing.lang.sw', t('landing.swahili'), { state: language === 'sw' ? 'selected' : 'unselected' })}
              >
                {t('landing.swahili')}
              </button>
              <button
                className={`lang-btn ${language === 'en' ? 'active' : ''}`}
                onClick={() => setLanguage('en')}
                {...ez('landing.lang.en', t('landing.english'), { state: language === 'en' ? 'selected' : 'unselected' })}
              >
                {t('landing.english')}
              </button>
              <button
                className="gear-btn"
                aria-label={t('landing.settings')}
                title={t('landing.settings')}
                onClick={() => setShowSettings((v) => !v)}
              >
                <Settings size={18} />
              </button>
            </div>
            {showSettings && <div className="settings-hint">{t('landing.settingsHint')}</div>}
          </div>

          <p className="tagline">“{t('landing.tagline')}”</p>

          <form className="token-box" onSubmit={join}>
            <input
              className={`token-input ${error ? 'invalid' : ''}`}
              placeholder={t('landing.tokenPlaceholder')}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError(null);
              }}
              aria-label={t('landing.tokenPlaceholder')}
              aria-invalid={!!error}
              {...ez('landing.token-input', t('landing.tokenPlaceholder'))}
            />
            <button type="submit" className="btn btn-primary join-btn" {...ez('landing.join-btn', t('landing.startMeeting'), { sensitive: true })}>
              {t('landing.startMeeting')}
            </button>
          </form>
          {error && (
            <div className="token-error" role="alert" data-testid="token-error">
              {t(error === 'empty' ? 'landing.tokenEmpty' : 'landing.tokenInvalid')}
            </div>
          )}

          <div className="reserve-box">
            <button
              className="reserve-btn"
              onClick={() => {
                // Single sign-on: the NURU account is the e-Mikutano account.
                if (authed) {
                  signIn();
                  navigate('/rooms');
                } else navigate('/hub/login?next=/rooms');
              }}
              {...ez('landing.reserve-btn', t('landing.reserve'))}
            >
              {t('landing.reserve')}
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <p className="footer-mobile">{t('footer.mobile')}</p>
          <div className="store-pills">
            {['App Store', 'Google Play', 'Linux', 'Windows', 'macOS'].map((s) => (
              <span className="store-pill" key={s}>
                {s}
              </span>
            ))}
          </div>
          <ul className="footer-links">
            <li><a href="#" onClick={(e) => e.preventDefault()}>{t('footer.quickAssistance')}</a></li>
            <li><a href="#" onClick={(e) => e.preventDefault()}>{t('footer.releaseNote')}</a></li>
            <li><a href="#" onClick={(e) => e.preventDefault()}>{t('footer.userManual')}</a></li>
            <li><a href="#" onClick={(e) => e.preventDefault()}>{t('footer.faq')}</a></li>
          </ul>
        </div>
        <div className="copyright">{t('footer.copyright')}</div>
      </footer>
    </div>
  );
}
