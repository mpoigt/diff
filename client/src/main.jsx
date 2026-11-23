import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { watchClientErrors } from './telemetry';

const endpoint = (import.meta.env.VITE_API_URL || 'http://localhost:33021').replace(/\/$/, '');

function App() {
  const [status, setStatus] = useState('Проверяем доступность сервера…');
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint + '/ready', { signal: controller.signal })
      .then((response) => setStatus(response.ok ? 'Сервер и PostgreSQL готовы' : 'Сервер пока не готов'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('Сервер недоступен');
      });
    return () => controller.abort();
  }, []);

  return <main style={{ maxWidth: '42rem', margin: '8vh auto', padding: '1.5rem', fontFamily: 'system-ui' }}>
    <h1>Diff Service</h1>
    <p role="status">{status}</p>
    <ul>
      <li><a href={endpoint + '/'}>Открыть сравнение файлов</a></li>
      <li><a href={endpoint + '/metrics.html'}>Метрики сервера</a></li>
    </ul>
  </main>;
}

void watchClientErrors().catch(() => console.warn('Client telemetry could not be initialized.'));
createRoot(document.getElementById('root')).render(<App />);
