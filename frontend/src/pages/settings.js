import { checkAuth } from '../auth.js';
import { getSettings, updateSettings, exportData, deleteAccount, logout } from '../api.js';

async function init() {
  const user = await checkAuth();
  if (!user) return;

  const errorBox = document.getElementById('error-box');
  const successBox = document.getElementById('success-box');

  function showError(msg) { errorBox.textContent = msg; errorBox.style.display = 'block'; successBox.style.display = 'none'; }
  function showSuccess(msg) { successBox.textContent = msg; successBox.style.display = 'block'; errorBox.style.display = 'none'; }

  // Load profile
  try {
    const res = await getSettings();
    const profile = await res.json();
    if (res.ok) {
      document.getElementById('display-name').value = profile.displayName || '';
      document.getElementById('email-display').textContent = profile.email || '—';
      document.getElementById('tier-display').textContent = profile.tier || user.tier;
    }
  } catch { /* non-fatal */ }

  // Save display name
  document.getElementById('save-btn').addEventListener('click', async () => {
    const displayName = document.getElementById('display-name').value.trim();
    try {
      const res = await updateSettings({ displayName });
      if (res.ok) { showSuccess('Display name saved.'); }
      else { const b = await res.json().catch(() => ({})); showError(b.error || 'Failed to save.'); }
    } catch { showError('Network error.'); }
  });

  // Export data
  document.getElementById('export-btn').addEventListener('click', async () => {
    try {
      const res = await exportData();
      if (!res.ok) { showError('Export failed.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'skept-export.json'; a.click();
      URL.revokeObjectURL(url);
    } catch { showError('Network error.'); }
  });

  // Delete account
  document.getElementById('delete-btn').addEventListener('click', async () => {
    if (!confirm('This will permanently delete your account and all data. Are you sure?')) return;
    if (!confirm('Second confirmation: delete account?')) return;
    try {
      const res = await deleteAccount();
      if (res.ok) { window.location.href = '/'; }
      else { const b = await res.json().catch(() => ({})); showError(b.error || 'Failed to delete account.'); }
    } catch { showError('Network error.'); }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout().catch(() => {});
    window.location.href = '/';
  });
}

init();
