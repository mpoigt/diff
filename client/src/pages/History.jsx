import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ComparisonList, Icon } from '../ui';
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
      <h1>История сравнений</h1>
      <Link className="button primary" to="/diffs/new"><Icon name="plus" />Новое сравнение</Link>
    </div>
    <div className="filters">
      <label className="icon-input"><span className="sr-only">Поиск по названию или имени файла</span>
        <Icon name="search" />
        <input type="search" placeholder="Поиск по названию или имени файла" value={input} maxLength={120} onChange={(e) => setInput(e.target.value)} />
      </label>
      <label className="icon-input sort-select"><span className="sr-only">Сортировка</span><Icon name="sort" size={16} />
        <select value={sort} onChange={(e) => { setSort(e.target.value); setQuery((current) => ({ ...current, offset: 0 })); }}>
          <option value="-createdAt">Сначала новые</option>
          <option value="title">По названию</option>
          <option value="-similarity">По схожести</option>
        </select><Icon name="down" size={14} />
      </label>
    </div>
    {!result && <p className="notice" role="status">Загрузка сравнений…</p>}
    {result?.error && <p className="notice error" role="alert">{result.error}</p>}
    {data && !data.items.length && <div className="empty-state"><span className="state-icon"><Icon name={query.search ? 'search' : 'history'} size={24} /></span>
      <h2>{query.search ? 'Ничего не найдено' : 'Сравнений пока нет'}</h2>
      {query.search && <button onClick={() => setInput('')}>Сбросить поиск</button>}
    </div>}
    {data?.items.length > 0 && <ComparisonList items={data.items} />}
    {data && (query.offset > 0 || data.total > PAGE_SIZE) && <div className="pagination">
      <button disabled={query.offset === 0} onClick={() => move(-PAGE_SIZE)}><Icon name="back" size={15} />Назад</button>
      <span>{query.offset + 1}–{Math.min(query.offset + PAGE_SIZE, data.total)} из {data.total}</span>
      <button disabled={query.offset + PAGE_SIZE >= data.total} onClick={() => move(PAGE_SIZE)}>Далее<Icon name="arrow" size={15} /></button>
    </div>}
  </>;
}
