'use strict';

/**
 * Построчный diff двух текстов на основе алгоритма LCS
 * (наибольшая общая подпоследовательность).
 *
 * Результат — плоский список операций, который клиент может отрисовать
 * как side-by-side или unified представление.
 */

function splitLines(text) {
  if (text === '') return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Матрица длин LCS. lcs[i][j] — длина LCS для a[i..] и b[j..].
 */
function buildLcsMatrix(a, b) {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  return lcs;
}

/**
 * @param {string} oldText исходный текст (файл A)
 * @param {string} newText изменённый текст (файл B)
 * @returns {{changes: Array, stats: Object}}
 */
function computeDiff(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const lcs = buildLcsMatrix(a, b);

  const changes = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      changes.push({ type: 'equal', oldLine: i + 1, newLine: j + 1, content: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changes.push({ type: 'removed', oldLine: i + 1, newLine: null, content: a[i] });
      i += 1;
    } else {
      changes.push({ type: 'added', oldLine: null, newLine: j + 1, content: b[j] });
      j += 1;
    }
  }

  while (i < a.length) {
    changes.push({ type: 'removed', oldLine: i + 1, newLine: null, content: a[i] });
    i += 1;
  }

  while (j < b.length) {
    changes.push({ type: 'added', oldLine: null, newLine: j + 1, content: b[j] });
    j += 1;
  }

  const stats = {
    added: changes.filter((c) => c.type === 'added').length,
    removed: changes.filter((c) => c.type === 'removed').length,
    unchanged: changes.filter((c) => c.type === 'equal').length,
    linesOld: a.length,
    linesNew: b.length,
  };
  stats.identical = stats.added === 0 && stats.removed === 0;
  stats.similarity = stats.linesOld === 0 && stats.linesNew === 0
    ? 100
    : Math.round((2 * stats.unchanged * 100) / (stats.linesOld + stats.linesNew));

  return { changes, stats };
}

/**
 * Текстовое представление diff в стиле unified (для GET /diffs/:id/patch).
 */
function toUnifiedText(diff) {
  const header = [
    `--- ${diff.fileA.name}`,
    `+++ ${diff.fileB.name}`,
  ];

  const body = diff.changes.map((change) => {
    if (change.type === 'added') return `+${change.content}`;
    if (change.type === 'removed') return `-${change.content}`;
    return ` ${change.content}`;
  });

  return header.concat(body).join('\n');
}

module.exports = { computeDiff, toUnifiedText, splitLines };
