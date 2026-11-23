import { Link } from 'react-router-dom';

const paths = {
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  back: 'M20 12H5m6 6-6-6 6-6',
  chevron: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 13h6m-6 4h5',
  compare: 'M4 6h11m-3-3 3 3-3 3 M20 18H9m3-3-3 3 3 3 M4 11v7h2 M20 13V6h-2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  equal: 'M5 9h14M5 15h14',
  search: 'M16 16l5 5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  sort: 'M3 6h12M3 12h8M3 18h5m10-11v13m-3-3 3 3 3-3',
  history: 'M3 5v5h5 M3.5 10a8.5 8.5 0 1 1 1 7 M12 7v5l3 2',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M5 20a7 7 0 0 1 14 0',
  calendar: 'M4 6h16v14H4z M8 3v6m8-6v6M4 11h16',
  edit: 'm14 5 5 5 M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13 M10 10v7m4-7v7',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v5m0-9v.3',
  lock: 'M6 10h12v10H6z M8.5 10V7a3.5 3.5 0 0 1 7 0v3 M12 14v2',
};

export function Icon({ name, size = 18 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>;
}

export function VersionTag({ version }) {
  return <span className="version-tag">{version}</span>;
}

const calendar = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

export function RecordDate({ value }) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return <time dateTime={date.toISOString()}>{calendar.format(date)}</time>;
}

export function ComparisonList({ items }) {
  return <ul className="history-list">{items.map((diff) => <li key={diff.id}>
    <Link className="history-row" to={`/diffs/${diff.id}`}>
      <span className="record-icon"><Icon name="compare" size={21} /></span>
      <div className="record-text">
        <strong className="result-title">{diff.title}</strong>
        <span className="record-files">{diff.fileA.name} <span aria-hidden="true">→</span> {diff.fileB.name}</span>
      </div>
      <span className="record-stats">
        <span className="count-added"><span className="sr-only">Добавлено строк </span>+{diff.stats.added}</span>
        <span className="count-removed"><span className="sr-only">Удалено строк </span>−{diff.stats.removed}</span>
        <span className="record-similarity">{diff.stats.similarity}%<span className="sr-only"> схожести</span></span>
      </span>
      <span className="record-date"><RecordDate value={diff.createdAt} /></span>
      <span className="row-arrow"><Icon name="chevron" size={16} /></span>
    </Link>
  </li>)}</ul>;
}

export function BackLink({ to = '/diffs', children = 'История сравнений' }) {
  return <Link className="back-link" to={to}><Icon name="back" size={15} />{children}</Link>;
}
