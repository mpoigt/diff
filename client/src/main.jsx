import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { request } from './api';
import { watchClientErrors } from './telemetry';
import { ComparisonList, Icon } from './ui';
import { useResource } from './useResource';
import './styles.css';

const History = lazy(() => import('./pages/History'));
const Details = lazy(() => import('./pages/Details'));
const Editor = lazy(() => import('./pages/Editor'));

void watchClientErrors().catch(() => console.warn('Client telemetry could not be initialized.'));

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /></span>;
}

function DiffPreview() {
  return <div className="preview-stage">
    <figure className="sample">
      <figcaption><span><Icon name="file" size={15} /> palette.css</span><span>Пример</span>
        <span className="sr-only">Во второй строке цвет кнопки изменился с #596078 на #4355ed.</span>
      </figcaption>
      <div className="sample-body" aria-hidden="true">
        <div><span>1</span><b /><code>.button {'{'}</code></div>
        <div className="sample-removed"><span>2</span><b>−</b><code>  color: <em>#596078</em>;</code></div>
        <div className="sample-added"><span>2</span><b>+</b><code>  color: <em>#4355ed</em>;</code></div>
        <div><span>3</span><b /><code>{'}'}</code></div>
      </div>
      <div className="sample-key" aria-hidden="true"><span><i /> исходная</span><span><i /> новая</span></div>
    </figure>
  </div>;
}

function Home() {
  const recent = useResource('/api/diffs?sort=-createdAt&limit=3&offset=0');
  return <>
    <section className="home-hero">
      <div className="hero-copy">
        <h1>Сравнение<br /><span>файлов<span className="hero-period">.</span></span></h1>
        <p>Сопоставьте две версии текста и посмотрите, какие строки изменились.</p>
        <div className="actions">
          <Link className="button primary" to="/diffs/new"><Icon name="plus" />Новое сравнение</Link>
          <Link className="button" to="/diffs">История <Icon name="arrow" size={15} /></Link>
        </div>
      </div>
      <DiffPreview />
    </section>
    <section className="recent-section" aria-labelledby="recent-heading">
      <div className="section-heading"><h2 id="recent-heading">Последние сравнения</h2>
        <Link className="text-link" to="/diffs">Вся история <Icon name="arrow" size={15} /></Link>
      </div>
      {!recent && <p className="notice" role="status">Загрузка сравнений…</p>}
      {recent?.error && <p className="notice error" role="alert">{recent.error}</p>}
      {recent?.data && (recent.data.items.length ? <ComparisonList items={recent.data.items} />
        : <p className="notice">Сохранённых сравнений пока нет.</p>)}
    </section>
  </>;
}

function SignIn({ onSession }) {
  const [register, setRegister] = useState(false);
  const [status, setStatus] = useState({});
  const navigate = useNavigate();
  const location = useLocation();

  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setStatus({ pending: true });
    try {
      const session = await request(register ? '/auth/register' : '/auth/login', { method: 'POST', body: values });
      onSession(session);
      navigate(location.state?.returnTo || '/diffs', { replace: true });
    } catch (error) {
      setStatus({ error: error.message });
    }
  }

  return <section className="auth-card">
    <BrandMark />
    <h1>{register ? 'Регистрация' : 'Вход в аккаунт'}</h1>
    <form onSubmit={submit}>
      <label>Электронная почта<input name="email" type="email" required placeholder="name@example.com" autoComplete="username" /></label>
      <label>Пароль<input name="password" type="password" required
        aria-describedby={register ? 'password-hint' : undefined} autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {register && <p className="form-hint" id="password-hint">От 8 символов. Используйте прописную и строчную латинские буквы, цифру и спецсимвол.</p>}
      {status.error && <p role="alert" className="notice error">{status.error}</p>}
      <button className="primary auth-submit" disabled={status.pending}>{status.pending ? 'Отправка…' : register ? 'Зарегистрироваться' : 'Войти'}<Icon name="arrow" size={16} /></button>
      <button className="auth-switch" type="button" disabled={status.pending} onClick={() => { setRegister(!register); setStatus({}); }}>
        {register ? 'У меня есть аккаунт' : 'Создать аккаунт'}
      </button>
    </form>
  </section>;
}

function App() {
  const [session, setSession] = useState(null);
  return <>
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <header className="site-header"><div className="nav-shell">
      <Link className="brand" to="/"><BrandMark /><span>Diff Service</span></Link>
      <nav className="site-nav" aria-label="Разделы">
        <NavLink to="/" end>Главная</NavLink>
        <NavLink to="/diffs" end>История</NavLink>
        <NavLink to="/diffs/new">Новое сравнение</NavLink>
      </nav>
      {session ? <div className="account">
        <span className="account-email">{session.user.email}</span>
        <button className="button-small" onClick={() => setSession(null)}>Выйти</button>
      </div> : <Link className="button button-small" to="/login"><Icon name="user" size={15} />Войти</Link>}
    </div></header>
    <main id="main-content" tabIndex="-1">
      <Suspense fallback={<p role="status" className="notice">Загрузка страницы…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<SignIn onSession={setSession} />} />
          <Route path="/diffs" element={<History />} />
          <Route path="/diffs/new" element={<Editor session={session} />} />
          <Route path="/diffs/:id" element={<Details session={session} />} />
          <Route path="/diffs/:id/edit" element={<Editor session={session} />} />
          <Route path="*" element={<section className="empty-state"><Icon name="file" size={28} /><h1>Страница не найдена</h1><Link className="button" to="/diffs">К истории</Link></section>} />
        </Routes>
      </Suspense>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
