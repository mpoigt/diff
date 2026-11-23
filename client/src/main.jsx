import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { request } from './api';
import { watchClientErrors } from './telemetry';
import './styles.css';

const History = lazy(() => import('./pages/History'));
const Details = lazy(() => import('./pages/Details'));
const Editor = lazy(() => import('./pages/Editor'));

void watchClientErrors().catch(() => console.warn('Client telemetry could not be initialized.'));

function Home() {
  return <section className="hero">
    <p className="eyebrow">Построчное сравнение текста</p>
    <h1>Сравнение файлов</h1>
    <p>Сопоставьте две версии файла и просмотрите добавленные и удалённые строки.</p>
    <div className="actions">
      <Link className="button primary" to="/diffs/new">Новое сравнение</Link>
      <Link className="button" to="/diffs">Открыть историю</Link>
    </div>
  </section>;
}

function SignIn({ onSession }) {
  const [register, setRegister] = useState(false);
  const [status, setStatus] = useState({});
  const navigate = useNavigate();

  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setStatus({ pending: true });
    try {
      const session = await request(register ? '/auth/register' : '/auth/login', { method: 'POST', body: values });
      onSession(session);
      navigate('/diffs');
    } catch (error) {
      setStatus({ error: error.message });
    }
  }

  return <section className="card narrow">
    <h1>{register ? 'Регистрация' : 'Вход'}</h1>
    <form onSubmit={submit}>
      <label>Электронная почта<input name="email" type="email" required autoComplete="username" /></label>
      <label>Пароль<input name="password" type="password" required
        autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {register && <p className="muted">Минимум 8 символов, включая прописную и строчную латинские буквы, цифру и спецсимвол.</p>}
      {status.error && <p role="alert" className="notice error">{status.error}</p>}
      <div className="actions">
        <button className="primary" disabled={status.pending}>{status.pending ? 'Отправка…' : register ? 'Зарегистрироваться' : 'Войти'}</button>
        <button type="button" disabled={status.pending} onClick={() => { setRegister(!register); setStatus({}); }}>
          {register ? 'У меня есть аккаунт' : 'Создать аккаунт'}
        </button>
      </div>
    </form>
  </section>;
}

function App() {
  const [session, setSession] = useState(null);
  return <>
    <header><div className="nav">
      <Link className="brand" to="/">Diff Service</Link>
      <nav aria-label="Разделы">
        <NavLink to="/diffs" end>История</NavLink>
        <NavLink to="/diffs/new">Новое сравнение</NavLink>
      </nav>
      {session ? <div className="account">
        <span>{session.user.email}</span>
        <button onClick={() => setSession(null)}>Выйти</button>
      </div> : <Link className="button" to="/login">Войти</Link>}
    </div></header>
    <main>
      <Suspense fallback={<p role="status" className="notice">Загрузка страницы…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<SignIn onSession={setSession} />} />
          <Route path="/diffs" element={<History />} />
          <Route path="/diffs/new" element={<Editor session={session} />} />
          <Route path="/diffs/:id" element={<Details session={session} />} />
          <Route path="/diffs/:id/edit" element={<Editor session={session} />} />
          <Route path="*" element={<section className="card"><h1>Страница не найдена</h1><Link to="/diffs">К истории</Link></section>} />
        </Routes>
      </Suspense>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
