import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { canEdit, diffPath, request } from '../api';
import { BackLink, Icon, VersionTag } from '../ui';
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

  return <section>
    <BackLink to={diff ? `/diffs/${diff.id}` : '/diffs'}>{diff ? 'К результату сравнения' : 'История сравнений'}</BackLink>
    <div className="page-heading"><h1>{diff ? 'Редактирование сравнения' : 'Новое сравнение'}</h1></div>
    <form className="editor-form" onSubmit={save}>
      <label className="title-field">Название сравнения<input name="title" maxLength={120} required defaultValue={diff?.title} placeholder="Например, обновление конфигурации" /></label>
      <div className="file-editors">
        {['A', 'B'].map((suffix) => <fieldset className="editor-panel" key={suffix}>
          <legend className="sr-only">{suffix === 'A' ? 'Исходная версия' : 'Новая версия'}</legend>
          <div className="editor-head" aria-hidden="true"><VersionTag version={suffix} />
            <strong>{suffix === 'A' ? 'Исходная версия' : 'Новая версия'}</strong>
          </div>
          <div className="editor-fields">
            <label>Имя файла<input name={`file${suffix}Name`} required maxLength={255} spellCheck={false}
              placeholder={suffix === 'A' ? 'original.txt' : 'updated.txt'} defaultValue={diff?.[`file${suffix}`].name} /></label>
            <label>Содержимое<textarea name={`file${suffix}Content`} rows={9} spellCheck={false}
              placeholder="Вставьте текст файла" defaultValue={diff?.[`file${suffix}`].content} /></label>
          </div>
        </fieldset>)}
      </div>
      {status.error && <p className="notice error" role="alert">{status.error}</p>}
      <div className="actions">
        <button className="primary" disabled={status.pending}><Icon name="compare" size={17} />{status.pending ? 'Сохранение…' : 'Сохранить сравнение'}</button>
        <Link className="button" to={diff ? `/diffs/${diff.id}` : '/diffs'}>Отмена</Link>
      </div>
    </form>
  </section>;
}

export default function Editor({ session }) {
  const { id } = useParams();
  const location = useLocation();
  const result = useResource(id && session ? diffPath(id) : null);
  if (!session) return <>
    <BackLink />
    <section className="empty-state gate">
      <span className="state-icon"><Icon name="lock" size={25} /></span>
      <h1>{id ? 'Редактирование сравнения' : 'Новое сравнение'}</h1>
      <p>Войдите в аккаунт, чтобы {id ? 'отредактировать сравнение' : 'добавить файлы и сохранить результат'}.</p>
      <Link className="button primary" to="/login" state={{ returnTo: location.pathname }}>Войти в аккаунт<Icon name="arrow" size={16} /></Link>
    </section>
  </>;
  if (id && !result) return <p className="notice" role="status">Загрузка сравнения…</p>;
  if (result?.error) return <p className="notice error" role="alert">{result.error}</p>;
  if (result?.data && !canEdit(session, result.data)) return <p className="notice error" role="alert">У вас нет прав на редактирование записи.</p>;
  return <Form key={id || 'new'} diff={result?.data} session={session} />;
}
