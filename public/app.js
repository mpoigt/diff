'use strict';

/**
 * Клиент демонстрационной страницы.
 *
 * ЗАЩИТА ОТ XSS НА СТОРОНЕ КЛИЕНТА
 * Весь текст, пришедший с сервера (названия, имена файлов, содержимое
 * сравниваемых файлов), вставляется в DOM ТОЛЬКО через textContent и
 * document.createElement. Шаблонов с innerHTML здесь нет вообще —
 * поэтому строка вида <img src=x onerror=alert(1)> в содержимом файла
 * отображается как текст и никогда не становится узлом DOM.
 * Это основной рубеж против XSS; CSP (helmet) и санитизация на входе —
 * дополнительные уровни той же защиты.
 *
 * ХРАНЕНИЕ ТОКЕНОВ
 * access-токен держим в переменной в памяти модуля, а НЕ в localStorage:
 * значение из localStorage доступно любому скрипту на странице, а
 * переменная исчезает при закрытии вкладки. refresh-токен в коде вообще
 * не виден — он лежит в httpOnly cookie и подставляется браузером
 * автоматически при запросе на /auth/refresh (credentials: 'same-origin').
 * Поэтому при перезагрузке страницы сессия восстанавливается молча:
 * см. restoreSession().
 */

const API = '/api/diffs';
const AUTH = '/auth';

let accessToken = null;
let currentUser = null;
let activeId = null;

// ─────────────────────────────────────────────────────────────────────────────
// Сетевой слой
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Запрос к API. При 401 один раз пытается обновить access-токен
 * по refresh-cookie и повторяет запрос.
 */
async function request(url, options = {}, retry = true) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin', // отправляем httpOnly cookie с refresh-токеном
  });

  if (response.status === 401 && retry && accessToken) {
    if (await refreshSession()) {
      return request(url, options, false);
    }
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!response.ok) {
    const message = Array.isArray(data.details) ? data.details.join('; ') : data.error;
    const error = new Error(message || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/** Обновление access-токена по httpOnly cookie. */
async function refreshSession() {
  try {
    const response = await fetch(`${AUTH}/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) return false;
    const data = await response.json();
    accessToken = data.accessToken;
    currentUser = data.user;
    renderAuth();
    return true;
  } catch {
    return false;
  }
}

/** Тихое восстановление сессии при загрузке страницы. */
async function restoreSession() {
  await refreshSession();
}

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции построения DOM (без innerHTML)
// ─────────────────────────────────────────────────────────────────────────────

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  // Текст всегда через textContent — это и есть экранирование вывода
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.dataset) Object.assign(node.dataset, options.dataset);
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  }
  children.filter(Boolean).forEach((child) => node.appendChild(child));
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ─────────────────────────────────────────────────────────────────────────────
// Аутентификация
// ─────────────────────────────────────────────────────────────────────────────

function renderAuth() {
  const form = document.getElementById('auth-form');
  const box = document.getElementById('auth-user');
  const hint = document.getElementById('auth-hint');

  if (currentUser) {
    form.hidden = true;
    box.hidden = false;
    hint.hidden = true;
    document.getElementById('who').textContent = currentUser.email;
    const chip = document.getElementById('role-chip');
    chip.textContent = currentUser.role;
    chip.dataset.role = currentUser.role;
  } else {
    form.hidden = false;
    box.hidden = true;
    hint.hidden = false;
  }
}

async function submitAuth(mode) {
  const form = document.getElementById('auth-form');
  const errorBox = document.getElementById('auth-error');
  errorBox.textContent = '';

  try {
    const data = await request(`${AUTH}/${mode}`, {
      method: 'POST',
      body: JSON.stringify({
        email: form.elements.email.value,
        password: form.elements.password.value,
      }),
    }, false);

    accessToken = data.accessToken;
    currentUser = data.user;
    form.elements.password.value = '';
    renderAuth();
    loadList();
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Список сравнений
// ─────────────────────────────────────────────────────────────────────────────

async function loadList() {
  const list = document.getElementById('list');
  clear(list);

  try {
    const data = await request(`${API}?limit=50`);

    if (data.items.length === 0) {
      list.appendChild(el('li', { class: 'meta', text: 'Пока пусто' }));
      return;
    }

    data.items.forEach((item) => {
      const li = el('li', {
        class: item.id === activeId ? 'active' : '',
        dataset: { id: item.id },
      }, [
        el('div', { class: 'title', text: item.title }),
        el('div', { class: 'meta', text: `${item.fileA.name} → ${item.fileB.name}` }),
        el('div', { class: 'meta', text: `автор: ${item.author}` }),
        el('div', { class: 'meta badges badges-row' }, [
          el('span', { class: 'b-add', text: `+${item.stats.added}` }),
          el('span', { class: 'b-del', text: `−${item.stats.removed}` }),
          el('span', { class: 'b-eq', text: `${item.stats.similarity}% совпадение` }),
        ]),
      ]);
      li.onclick = () => showDiff(item.id);
      list.appendChild(li);
    });
  } catch (error) {
    list.appendChild(el('li', { class: 'err', text: error.message }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Просмотр одного сравнения
// ─────────────────────────────────────────────────────────────────────────────

function buildDiffTable(changes) {
  const table = el('table', { class: 'diff' });
  const tbody = el('tbody');

  changes.forEach((change) => {
    const mark = change.type === 'added' ? '+' : (change.type === 'removed' ? '−' : '');
    tbody.appendChild(el('tr', { class: change.type }, [
      el('td', { class: 'num', text: change.oldLine === null ? '' : change.oldLine }),
      el('td', { class: 'num', text: change.newLine === null ? '' : change.newLine }),
      el('td', { class: 'mark', text: mark }),
      // Содержимое файла — только textContent, даже если это HTML или JS
      el('td', { text: change.content }),
    ]));
  });

  table.appendChild(tbody);
  return table;
}

async function showDiff(id) {
  activeId = id;
  const viewer = document.getElementById('viewer');

  let diff;
  try {
    diff = await request(`${API}/${id}`);
  } catch (error) {
    clear(viewer);
    viewer.appendChild(el('h2', { text: 'Результат сравнения' }));
    viewer.appendChild(el('p', { class: 'err', text: error.message }));
    return;
  }

  const canEdit = currentUser
    && (diff.ownerId === currentUser.id || currentUser.role === 'moderator' || currentUser.role === 'admin');
  const canDelete = currentUser && currentUser.role === 'admin';

  clear(viewer);
  viewer.appendChild(el('h2', { text: diff.title }));
  viewer.appendChild(el('div', { class: 'badges' }, [
    el('span', { class: 'b-add', text: `добавлено ${diff.stats.added}` }),
    el('span', { class: 'b-del', text: `удалено ${diff.stats.removed}` }),
    el('span', { class: 'b-eq', text: `без изменений ${diff.stats.unchanged}` }),
    el('span', { class: 'b-eq', text: `схожесть ${diff.stats.similarity}%` }),
  ]));
  viewer.appendChild(el('div', {
    class: 'files',
    text: `${diff.fileA.name} → ${diff.fileB.name} · автор ${diff.author} · ${new Date(diff.createdAt).toLocaleString('ru-RU')}`,
  }));
  viewer.appendChild(buildDiffTable(diff.changes));

  const patchButton = el('button', { class: 'secondary', text: 'Показать unified-патч' });
  const output = el('pre', { class: 'patch', attrs: { hidden: 'hidden' } });

  patchButton.onclick = async () => {
    const response = await fetch(`${API}/${id}/patch`, { credentials: 'same-origin' });
    output.textContent = await response.text();
    output.removeAttribute('hidden');
  };

  const row = el('div', { class: 'row' }, [patchButton]);

  // Кнопка DELETE показывается только администратору — но настоящая
  // проверка прав всё равно на сервере (roleGuard('admin')): скрытая
  // кнопка защитой не является, это лишь удобство интерфейса.
  if (canDelete) {
    const deleteButton = el('button', { class: 'danger', text: 'Удалить (DELETE · admin)' });
    deleteButton.onclick = async () => {
      try {
        await request(`${API}/${id}`, { method: 'DELETE' });
        activeId = null;
        clear(viewer);
        viewer.appendChild(el('h2', { text: 'Результат сравнения' }));
        viewer.appendChild(el('p', { class: 'sub', text: 'Запись удалена.' }));
        loadList();
      } catch (error) {
        viewer.appendChild(el('div', { class: 'err', text: error.message }));
      }
    };
    row.appendChild(deleteButton);
  }

  if (canEdit) {
    row.appendChild(el('span', { class: 'hint', text: 'Вы можете редактировать эту запись (PUT/PATCH)' }));
  }

  viewer.appendChild(row);
  viewer.appendChild(output);

  loadList();
}

// ─────────────────────────────────────────────────────────────────────────────
// Создание сравнения
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('create-form').onsubmit = async (event) => {
  event.preventDefault();
  // form.elements, чтобы поле "title" не конфликтовало со свойством HTMLElement.title
  const fields = event.target.elements;
  const errorBox = document.getElementById('form-error');
  errorBox.textContent = '';

  if (!currentUser) {
    errorBox.textContent = 'Создание сравнений требует входа: POST /api/diffs защищён токеном.';
    return;
  }

  try {
    const created = await request(API, {
      method: 'POST',
      body: JSON.stringify({
        title: fields.title.value,
        fileA: { name: fields.nameA.value, content: fields.contentA.value },
        fileB: { name: fields.nameB.value, content: fields.contentB.value },
      }),
    });
    await showDiff(created.id);
  } catch (error) {
    errorBox.textContent = error.message;
  }
};

document.getElementById('auth-form').onsubmit = (event) => {
  event.preventDefault();
  submitAuth('login');
};
document.getElementById('register-btn').onclick = () => submitAuth('register');
document.getElementById('logout-btn').onclick = async () => {
  await fetch(`${AUTH}/logout`, { method: 'POST', credentials: 'same-origin' });
  accessToken = null;
  currentUser = null;
  renderAuth();
  loadList();
};

renderAuth();
restoreSession();
loadList();
