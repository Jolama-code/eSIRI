import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { faBell, faEnvelopeOpenText, faFileLines, faListCheck } from '@fortawesome/free-solid-svg-icons';
import { useT } from '../i18n';
import { useApp } from '../store/appStore';
import { HttpError, login, patchMe } from '../esiri/session';
import { Orb } from '../esiri/ui/Orb';
import { IconShape } from './ui';
import './hub.css';

export default function Login() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const language = useApp((s) => s.language);
  const setLanguage = useApp((s) => s.setLanguage);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t('login.missing'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const user = await login(username.trim(), password);
      // The device keeps the language chosen on it; the account follows.
      if (user.language !== language) void patchMe({ language });
      const next = params.get('next');
      navigate(next && next.startsWith('/') ? next : '/hub', { replace: true });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) setError(t('login.invalid'));
      else if (err instanceof HttpError) setError(language === 'sw' ? err.messageSw : err.message);
      else setError(t('login.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-art">
        <img className="art-bg" src="/brand/circuit-header.png" alt="" aria-hidden="true" />
        <div className="art-orb">
          <Orb size={120} state="idle" />
        </div>
        <h2>{t('login.artTitle')}</h2>
        <p>{t('login.artText')}</p>
        <div className="art-points">
          <div className="art-point"><IconShape icon={faBell} tone="white" size={34} /> {t('login.point1')}</div>
          <div className="art-point"><IconShape icon={faEnvelopeOpenText} tone="white" size={34} /> {t('login.point2')}</div>
          <div className="art-point"><IconShape icon={faListCheck} tone="white" size={34} /> {t('login.point3')}</div>
          <div className="art-point"><IconShape icon={faFileLines} tone="white" size={34} /> {t('login.point4')}</div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit} noValidate>
          <img className="login-logo" src="/brand/nuru-logo-stacked.svg" alt="NURU — Msaidizi wako wa kidijitali" />
          <div className="login-lang" role="group" aria-label={t('esiri.language')}>
            <button type="button" className={language === 'sw' ? 'on' : ''} onClick={() => setLanguage('sw')} data-testid="login-lang-sw">
              Kiswahili
            </button>
            <button type="button" className={language === 'en' ? 'on' : ''} onClick={() => setLanguage('en')} data-testid="login-lang-en">
              English
            </button>
          </div>
          <h1 className="t-section" style={{ textAlign: 'center' }}>{t('login.title')}</h1>
          <div className="field">
            <label htmlFor="login-user">{t('login.username')}</label>
            <input id="login-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="login-username" />
          </div>
          <div className="field">
            <label htmlFor="login-pass">{t('login.password')}</label>
            <input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
          </div>
          {error && <div className="login-error" role="alert" data-testid="login-error">{error}</div>}
          <button className="hbtn login-submit" type="submit" disabled={busy} data-testid="login-submit">
            {busy ? t('login.signingIn') : t('login.submit')}
          </button>
          <div className="login-demo">
            <b>{t('login.demoTitle')}</b> {t('login.demoHint')}
            <div className="accts">
              {['jolama', 'halima', 'baraka'].map((u) => (
                <button type="button" key={u} onClick={() => setUsername(u)}>
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="login-foot">{t('login.footer')}</div>
        </form>
      </section>
    </div>
  );
}
