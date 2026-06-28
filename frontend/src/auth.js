import { getMe } from './api.js';

export async function checkAuth() {
  const res = await getMe();
  if (!res.ok) {
    window.location.href = '/';
    return null;
  }
  return res.json();
}
