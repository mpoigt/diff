import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { canEdit, diffPath, request } from '../api';
import { useResource } from '../useResource';

export default function Details({ session }) {
  const { id } = useParams();
  const result = useResource(diffPath(id));
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const diff = result?.data;

  async function remove() {
    if (!window.confirm('Удалить это сравнение?')) return;
    setDeleting(true);
    setError('');
    try {
      await request(diffPath(id), { method: 'DELETE', token: session.accessToken });
      navigate('/diffs');
    } catch (failure) {
      setError(failure.message);
      setDeleting(false);
    }
  }

  return <>
    <Link to="/diffs">К списку сравнений</Link>
    {!result && <p className="notice" role="status">Загрузка сравнения…</p>}
    {result?.error && <p className="notice error" role="alert">{result.error}</p>}
    {diff && <section>
      <div className="page-heading">
        <div><h1>{diff.title}</h1><div className="muted files">{diff.fileA.name} → {diff.fileB.name}</div></div>
        <div className="actions">
          {canEdit(session, diff) && <Link className="button" to={`/diffs/${id}/edit`}>Редактировать</Link>}
          {session?.user.role === 'admin' && <button disabled={deleting} onClick={remove}>Удалить</button>}
        </div>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="badges"><span className="added">Добавлено {diff.stats.added}</span>
        <span className="removed">Удалено {diff.stats.removed}</span><span>Схожесть {diff.stats.similarity}%</span></div>
      <div className="changes" aria-label="Построчные различия">
        {diff.changes.map((line, index) => <div className={line.type} key={index}>
          <span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span>
          <code>{line.content}</code>
        </div>)}
      </div>
    </section>}
  </>;
}
