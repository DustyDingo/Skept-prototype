import { checkAuth } from '../auth.js';
import { getHistory, deleteHistoryItem, wipeHistory } from '../api.js';

const VERDICT_LABELS = {
  authentic:   { label: 'Likely Authentic',  cls: 'green' },
  ambiguous:   { label: 'Ambiguous',         cls: 'amber' },
  manipulated: { label: 'Likely Manipulated',cls: 'red'   },
};

function fmt(unixSec) {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

async function init() {
  const user = await checkAuth();
  if (!user) return;

  document.getElementById('user-tier').textContent = user.tier;

  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('empty-state');
  const wipeBtn = document.getElementById('wipe-btn');
  const errorBox = document.getElementById('error-box');

  async function loadHistory() {
    listEl.innerHTML = '<p style="color:var(--soft);font-size:14px">Loading…</p>';
    try {
      const res = await getHistory();
      const data = await res.json();
      if (!res.ok) { showError('Failed to load history.'); return; }
      renderList(data.entries || []);
    } catch {
      showError('Network error loading history.');
    }
  }

  function renderList(entries) {
    listEl.innerHTML = '';
    if (!entries.length) {
      emptyEl.style.display = 'block';
      wipeBtn.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    wipeBtn.style.display = 'inline-block';

    entries.forEach(entry => {
      const vInfo = VERDICT_LABELS[entry.verdict_state] || { label: entry.verdict_state, cls: 'amber' };
      const pct = entry.score !== null ? Math.round(entry.score * 100) + '%' : '—';
      const urlSnip = (entry.clip_url || '').length > 55 ? entry.clip_url.slice(0, 55) + '…' : (entry.clip_url || '—');

      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `
        <div class="history-meta">
          <span class="history-verdict ${vInfo.cls}">${vInfo.label}</span>
          <span class="history-score">${pct}</span>
          <span class="history-date">${fmt(entry.created_at)}</span>
        </div>
        <div class="history-url">${urlSnip}</div>
        <button class="delete-btn" data-id="${entry.id}">Delete</button>
      `;
      row.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm('Delete this entry?')) return;
        try {
          const res = await deleteHistoryItem(entry.id);
          if (res.ok) { row.remove(); if (!listEl.children.length) renderList([]); }
          else showError('Failed to delete entry.');
        } catch { showError('Network error.'); }
      });
      listEl.appendChild(row);
    });
  }

  wipeBtn.addEventListener('click', async () => {
    if (!confirm('Delete all history? Entries with published seals will be kept.')) return;
    try {
      const res = await wipeHistory();
      if (res.ok) { renderList([]); }
      else showError('Failed to wipe history.');
    } catch { showError('Network error.'); }
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }

  loadHistory();
}

init();
