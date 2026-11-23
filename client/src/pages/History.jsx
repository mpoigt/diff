import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../useResource';

const PAGE_SIZE = 12;

export default function History() {
  const [input, setInput] = useState('');
  const [sort, setSort] = useState('-createdAt');
  const [query, setQuery] = useState({ search: '', offset: 0 });

  useEffect(() => {
    const search = input.trim();
    const timer = setTimeout(() => {
      setQuery((current) => current.search === search ? current : { search, offset: 0 });
    }, 350);
    return () => clearTimeout(timer);
  }, [input]);

  const params = new URLSearchParams({ sort, limit: PAGE_SIZE, offset: query.offset });
  if (query.search) params.set('search', query.search);
  const result = useResource(`/api/diffs?${params}`);
  const data = result?.data;

  function move(delta) {
    setQuery((current) => ({ ...current, offset: current.offset + delta }));
  }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">История проекта</p><h1>Сравнения</h1></div>
      <Link className="button primary" to="/diffs/new">Новое сравнение</Link>
    </div>
    <div className="card filters">
      <label>Поиск по названию или имени файла
        <input type="search" value={input} maxLength={120} onChange={(e) => setInput(e.target.value)} />
      </label>
      <label>Сортировка<select value={sort} onChange={(e) => { setSort(e.target.value); setQuery({ ...query, offset: 0 }); }}>
        <option value="-createdAt">Сначала новые</option>
        <option value="title">По названию</option>
        <option value="-similarity">По схожести</option>
      </select></label>
    </div>
    {!result && <p className="notice" role="status">Загрузка сравнений…</p>}
    {result?.error && <p className="notice error" role="alert">{result.error}</p>}
    {data && !data.items.length && <p className="notice">Сравнения не найдены.</p>}
    {data?.items.length > 0 && <ul className="history">
      {data.items.map((diff) => <li key={diff.id} className="card">
        <Link className="result-title" to={`/diffs/${diff.id}`}>{diff.title}</Link>
        <span className="muted files">{diff.fileA.name} → {diff.fileB.name}</span>
        <div className="badges"><span className="added">+{diff.stats.added}</span>
          <span className="removed">−{diff.stats.removed}</span><span>{diff.stats.similarity}% схожести</span></div>
      </li>)}
    </ul>}
    {data && (query.offset > 0 || data.total > PAGE_SIZE) && <div className="actions">
      <button disabled={query.offset === 0} onClick={() => move(-PAGE_SIZE)}>Назад</button>
      <span>{query.offset + 1}–{Math.min(query.offset + PAGE_SIZE, data.total)} из {data.total}</span>
      <button disabled={query.offset + PAGE_SIZE >= data.total} onClick={() => move(PAGE_SIZE)}>Далее</button>
    </div>}
  </>;
}
