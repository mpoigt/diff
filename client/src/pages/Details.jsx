import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { canEdit, diffPath, request } from '../api';
import { BackLink, Icon, RecordDate, VersionTag } from '../ui';
import { useResource } from '../useResource';

const kinds = [
  { type: 'added', field: 'added', label: 'Добавлено', icon: 'plus', sign: '+' },
  { type: 'removed', field: 'removed', label: 'Удалено', icon: 'minus', sign: '−' },
  { type: 'equal', field: 'unchanged', label: 'Без изменений', icon: 'equal', sign: '=' },
];
const rowKinds = Object.fromEntries(kinds.map((kind) => [kind.type, kind]));

function Summary({ stats }) {
  return <dl className="stats-grid" aria-label="Статистика сравнения">
    {kinds.map(({ type, field, label, icon }) => <div key={type} className={`stat stat-${type}`}>
      <dt><Icon name={icon} size={17} />{label}</dt><dd>{stats[field]}</dd>
    </div>)}
    <div className="stat stat-similarity"><dt><Icon name="compare" size={17} />Схожесть</dt>
      <dd>{stats.similarity}<small>%</small></dd>
      <span aria-hidden="true" className="similarity-track"><i style={{ width: `${stats.similarity}%` }} /></span>
    </div>
  </dl>;
}

function DiffTable({ diff }) {
  return <section className="diff-section" aria-labelledby="diff-heading">
    <div className="section-heading"><h2 id="diff-heading">Построчное сравнение</h2></div>
    <div className="diff-panel">
      <div className="version-pair">
        {[diff.fileA, diff.fileB].map((file, index) => <div className="version-file" key={index}>
          <VersionTag version={index === 0 ? 'A' : 'B'} />
          <div><span className="version-caption">{index === 0 ? 'Исходная версия' : 'Новая версия'}</span>
            <strong>{file.name}</strong></div>
        </div>)}
        <span className="version-connector" aria-hidden="true"><Icon name="arrow" size={14} /></span>
      </div>
      {diff.changes.length ? <div className="code-scroll" role="region" aria-label="Таблица различий" tabIndex="0">
        <table className="diff-table" aria-label="Изменения по строкам">
          <thead><tr><th scope="col"><abbr title="Номер строки в исходной версии">A</abbr></th>
            <th scope="col"><abbr title="Номер строки в новой версии">B</abbr></th>
            <th scope="col"><span className="sr-only">Тип изменения</span></th><th scope="col">Содержимое строки</th></tr></thead>
          <tbody>{diff.changes.map((line, index) => {
            const kind = rowKinds[line.type];
            return <tr className={`line-${line.type}`} key={index}>
              <td>{line.oldLine}</td><td>{line.newLine}</td>
              <td className="line-sign"><span aria-hidden="true">{kind.sign}</span><span className="sr-only">{kind.label}</span></td>
              <td><code>{line.content}</code></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <p className="panel-message">Оба файла пусты.</p>}
      <div className="diff-legend" aria-label="Условные обозначения">
        {kinds.map(({ type, label, sign }) => <span key={type}><b className={`legend-${type}`}>{sign}</b>{label}</span>)}
      </div>
    </div>
    <p className="diff-note"><Icon name="info" size={15} />Пробелы и табуляция в конце строк не учитываются.</p>
  </section>;
}

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
    <BackLink />
    {!result && <p className="notice" role="status">Загрузка сравнения…</p>}
    {result?.error && <p className="notice error" role="alert">{result.error}</p>}
    {diff && <>
      <div className="page-heading detail-heading">
        <div><h1>{diff.title}</h1>
          {diff.createdAt && <div className="detail-meta"><Icon name="calendar" size={15} /><RecordDate value={diff.createdAt} /></div>}
        </div>
        <div className="actions">
          {canEdit(session, diff) && <Link className="button" to={`/diffs/${id}/edit`}><Icon name="edit" size={15} />Редактировать</Link>}
          {session?.user.role === 'admin' && <button className="danger-button" disabled={deleting} onClick={remove}><Icon name="trash" size={15} />Удалить</button>}
        </div>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <Summary stats={diff.stats} />
      <DiffTable diff={diff} />
    </>}
  </>;
}
