import { checkAuth } from './auth.js';
import { logout, deleteHistoryItem } from './api.js';

const VERDICT_CONFIG = {
  verified_origin: { label: 'Verified origin',      color: '#3a7a50' },
  analysed_clean:  { label: 'Analysed clean',       color: '#7aaa88' },
  ambiguous:       { label: 'Signals conflict',     color: '#c07800' },
  suspicious:      { label: 'Strong AI indicators', color: '#a83a2a' },
};

let allEntries = [];
let activeFilter = 'All';

function getVerdictConfig(state) {
  return VERDICT_CONFIG[state] || { label: state || 'Unknown', color: '#8a8a8a' };
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateUrl(url, max = 48) {
  if (!url) return '—';
  return url.length > max ? url.slice(0, max) + '…' : url;
}

function formatDate(val) {
  const d = typeof val === 'number' ? new Date(val * 1000) : new Date(val);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function matchesFilter(entry) {
  if (activeFilter === 'All') return true;
  if (activeFilter === 'Suspicious') return entry.verdict_state === 'suspicious';
  if (activeFilter === 'Ambiguous')  return entry.verdict_state === 'ambiguous';
  if (activeFilter === 'Authentic')  return ['analysed_clean', 'verified_origin'].includes(entry.verdict_state);
  return true;
}

function renderSkeletons() {
  document.getElementById('history-list').innerHTML =
    [1, 2, 3].map(() => '<div class="skeleton-card"><div class="shimmer"></div></div>').join('');
}

function renderQuota(quotaUsed, quotaLimit) {
  const pct = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;
  const reached = quotaUsed >= quotaLimit;

  const text = document.getElementById('quota-text');
  text.textContent = reached
    ? 'Monthly limit reached — upgrade to continue'
    : `${quotaUsed} of ${quotaLimit} checks used this month`;
  text.className = 'quota-text' + (reached ? ' limit-reached' : '');

  const fill = document.getElementById('quota-bar-fill');
  fill.style.width = pct + '%';
  fill.className = 'quota-bar-fill' + (reached ? ' full' : '');

  document.getElementById('quota-strip').style.display = 'block';
}

function renderCards(entries) {
  const list = document.getElementById('history-list');
  const emptyState = document.getElementById('empty-state');
  const filterChips = document.getElementById('filter-chips');

  list.innerHTML = '';

  if (allEntries.length === 0) {
    emptyState.classList.add('visible');
    filterChips.style.display = 'none';
    document.getElementById('empty-heading').textContent = 'Nothing here yet';
    document.getElementById('empty-sub').textContent = 'Check a video to see your history appear here.';
    const cta = document.getElementById('empty-cta');
    cta.textContent = 'Check a video →';
    cta.href = '/verify.html';
    cta.onclick = null;
    return;
  }

  if (entries.length === 0) {
    emptyState.classList.add('visible');
    document.getElementById('empty-heading').textContent = `No ${activeFilter.toLowerCase()} results.`;
    document.getElementById('empty-sub').textContent = '';
    const cta = document.getElementById('empty-cta');
    cta.textContent = 'Clear filter';
    cta.href = '#';
    cta.onclick = (e) => { e.preventDefault(); setFilter('All'); };
    return;
  }

  emptyState.classList.remove('visible');
  entries.forEach(entry => buildCard(list, entry));
}

function buildCard(container, entry) {
  const vc = getVerdictConfig(entry.verdict_state);
  const platform = entry.platform
    ? entry.platform.charAt(0).toUpperCase() + entry.platform.slice(1)
    : 'Unknown';
  const urlSnip = truncateUrl(entry.clip_url);
  const dateStr = formatDate(entry.created_at);

  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.id = entry.id;

  card.innerHTML = `
    <div class="verdict-bar" style="background:${vc.color}"></div>
    <div class="card-gap"></div>
    <div class="card-body">
      <div class="card-platform">${escHtml(platform)} · ${escHtml(urlSnip)}</div>
      <div class="card-verdict" style="color:${vc.color}">${escHtml(vc.label)}</div>
      <div class="card-date">${escHtml(dateStr)}</div>
    </div>
    <div class="card-actions">
      <button class="delete-btn" aria-label="Delete entry" title="Delete">×</button>
      <span class="card-chevron">›</span>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-actions')) return;
    window.location.href = `/verify.html?id=${encodeURIComponent(entry.id)}`;
  });

  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm(card, entry, vc);
  });

  container.appendChild(card);
}

function showConfirm(card, entry, vc) {
  const body = card.querySelector('.card-body');
  const deleteBtn = card.querySelector('.delete-btn');
  const originalHTML = body.innerHTML;
  deleteBtn.style.display = 'none';

  body.innerHTML = `
    <div class="confirm-row">
      <span class="confirm-label">${escHtml(vc.label)} · Delete this entry?</span>
      <button class="confirm-yes">Yes, delete</button>
      <button class="confirm-no">Cancel</button>
    </div>
  `;

  body.querySelector('.confirm-no').addEventListener('click', (e) => {
    e.stopPropagation();
    body.innerHTML = originalHTML;
    deleteBtn.style.display = '';
  });

  body.querySelector('.confirm-yes').addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const res = await deleteHistoryItem(entry.id);
      if (res.ok) {
        const height = card.offsetHeight;
        card.style.overflow = 'hidden';
        card.style.maxHeight = height + 'px';
        requestAnimationFrame(() => {
          card.style.transition = 'opacity 0.2s, max-height 0.2s, margin-bottom 0.2s';
          card.style.opacity = '0';
          card.style.maxHeight = '0';
          card.style.marginBottom = '0';
        });
        setTimeout(() => {
          card.remove();
          allEntries = allEntries.filter(e => e.id !== entry.id);
          const remaining = allEntries.filter(matchesFilter);
          if (remaining.length === 0) renderCards([]);
        }, 220);
      } else if (res.status === 401) {
        window.location.href = '/';
      } else if (res.status === 403 || res.status === 409) {
        body.innerHTML = `<span class="sealed-msg">This entry has a seal and can't be deleted.</span>`;
        setTimeout(() => {
          body.innerHTML = originalHTML;
          deleteBtn.style.display = '';
        }, 2500);
      } else {
        body.innerHTML = originalHTML;
        deleteBtn.style.display = '';
      }
    } catch {
      body.innerHTML = originalHTML;
      deleteBtn.style.display = '';
    }
  });
}

function setFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('#filter-chips .chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === filter);
  });
  renderCards(allEntries.filter(matchesFilter));
}

async function init() {
  const user = await checkAuth();
  if (!user) return;

  document.querySelectorAll('#filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => setFilter(chip.dataset.filter));
  });

  renderSkeletons();

  let res;
  try {
    res = await fetch('/api/history/list', { credentials: 'include' });
  } catch {
    document.getElementById('error-banner').style.display = 'block';
    document.getElementById('history-list').innerHTML = '';
    return;
  }

  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  if (!res.ok) {
    document.getElementById('error-banner').style.display = 'block';
    document.getElementById('history-list').innerHTML = '';
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    document.getElementById('error-banner').style.display = 'block';
    document.getElementById('history-list').innerHTML = '';
    return;
  }

  const { quota_used = 0, quota_limit = 5, entries = [] } = data;
  allEntries = entries;

  renderQuota(quota_used, quota_limit);

  if (entries.length > 0) {
    document.getElementById('filter-chips').style.display = 'flex';
  }

  renderCards(allEntries.filter(matchesFilter));
}

init();
