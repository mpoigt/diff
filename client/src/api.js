const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:33021').replace(/\/$/, '');

export async function request(path, { token, body, signal, method = 'GET' } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(baseUrl + path, {
      headers, method, signal, credentials: 'omit',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Не удалось связаться с сервером. Попробуйте ещё раз.');
  }
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const details = Array.isArray(data?.details) ? data.details.join(' ') : '';
    throw new Error([data?.error || `Сервер вернул ошибку ${response.status}.`, details].filter(Boolean).join(' '));
  }
  return data;
}

export const diffPath = (id) => `/api/diffs/${encodeURIComponent(id)}`;

export function canEdit(session, diff) {
  return Boolean(session && (session.user.id === diff.ownerId
    || ['moderator', 'admin'].includes(session.user.role)));
}
