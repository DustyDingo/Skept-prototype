async function call(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  return fetch(path, { ...rest, credentials: 'include', headers });
}

export async function requestMagicLink(email) {
  return call('/api/auth/request-link', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function getMe() {
  return call('/api/auth/me');
}

export async function logout() {
  return call('/api/auth/logout', { method: 'POST' });
}

export async function submitVerify(url) {
  return call('/api/verify', { method: 'POST', body: JSON.stringify({ url }) });
}

export async function getHistory() {
  return call('/api/history');
}

export async function deleteHistoryItem(id) {
  return call(`/api/history/${id}`, { method: 'DELETE' });
}

export async function wipeHistory() {
  return call('/api/history', { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
}

export async function getSettings() {
  return call('/api/settings/profile');
}

export async function updateSettings(patch) {
  return call('/api/settings/profile', { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function exportData() {
  return fetch('/api/settings/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'json' }),
  });
}

export async function deleteAccount() {
  return call('/api/settings/account', { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
}
