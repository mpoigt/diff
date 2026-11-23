import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { canEdit, diffPath, request } from '../api';
import { useResource } from '../useResource';

function Form({ diff, session }) {
  const [status, setStatus] = useState({});
  const navigate = useNavigate();

  async function save(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      title: fields.title,
      fileA: { name: fields.fileAName, content: fields.fileAContent },
      fileB: { name: fields.fileBName, content: fields.fileBContent },
    };
    setStatus({ pending: true });
    try {
      const saved = await request(diff ? diffPath(diff.id) : '/api/diffs', {
        body, method: diff ? 'PATCH' : 'POST', token: session.accessToken,
      });
      navigate(`/diffs/${saved.id}`);
    } catch (error) {
      setStatus({ error: error.message });
    }
  }

  return <section className="card">
    <h1>{diff ? 'Редактирование сравнения' : 'Новое сравнение'}</h1>
    <form onSubmit={save}>
      <label>Название<input name="title" maxLength={120} required defaultValue={diff?.title} /></label>
      <div className="file-editors">
        {['A', 'B'].map((suffix) => <fieldset key={suffix}>
          <legend>{suffix === 'A' ? 'Исходная версия' : 'Новая версия'}</legend>
          <label>Имя файла<input name={`file${suffix}Name`} required maxLength={255}
            defaultValue={diff?.[`file${suffix}`].name} /></label>
          <label>Содержимое<textarea name={`file${suffix}Content`} rows={9}
            defaultValue={diff?.[`file${suffix}`].content} /></label>
        </fieldset>)}
      </div>
      {status.error && <p className="notice error" role="alert">{status.error}</p>}
      <div className="actions">
        <button className="primary" disabled={status.pending}>{status.pending ? 'Сохранение…' : 'Сохранить'}</button>
        <Link className="button" to={diff ? `/diffs/${diff.id}` : '/diffs'}>Отмена</Link>
      </div>
    </form>
  </section>;
}

export default function Editor({ session }) {
  const { id } = useParams();
  const result = useResource(id && session ? diffPath(id) : null);
  if (!session) return <p className="notice">Для записи нужно <Link to="/login">войти</Link>.</p>;
  if (id && !result) return <p className="notice" role="status">Загрузка сравнения…</p>;
  if (result?.error) return <p className="notice error" role="alert">{result.error}</p>;
  if (result?.data && !canEdit(session, result.data)) return <p className="notice error" role="alert">У вас нет прав на редактирование записи.</p>;
  return <Form key={id || 'new'} diff={result?.data} session={session} />;
}
