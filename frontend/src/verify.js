import { checkAuth } from './auth.js';
import { logout, submitVerify } from './api.js';

const VERDICT_META = {
  likely_authentic:   { color: '#3a7a50', label: 'Verified original',    headline: 'All analysers clean. No manipulation signals found.' },
  inconclusive:       { color: '#c07800', label: 'Signs of manipulation', headline: 'One or more analysers flagged something. Signals conflict.' },
  insufficient_data:  { color: '#c07800', label: 'Signs of manipulation', headline: 'One or more analysers flagged something. Signals conflict.' },
  likely_manipulated: { color: '#a83a2a', label: 'Strong AI indicators',  headline: 'Multiple analysers agree. Strong signs of AI generation.' },
};

const PILLAR_LABELS = {
  deepfake: 'Video analysis',
  audio:    'Audio & voice clone',
  c2pa:     'Provenance (C2PA)',
};

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max = 48) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function derivePlatform(url) {
  try {
    const { hostname } = new URL(url);
    if (hostname.includes('tiktok.com'))  return 'TikTok';
    if (hostname.includes('instagram.com')) return 'Instagram';
    if (hostname === 'youtu.be' || hostname.includes('youtube.com')) return 'YouTube';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'X / Twitter';
    if (hostname.includes('bsky.app') || hostname.includes('bsky.social')) return 'Bluesky';
    if (hostname === 'cdn.discordapp.com') return 'Discord';
  } catch { /* ignore */ }
  return null;
}

function showView(name) {
  ['intake', 'analysing', 'verdict'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.hidden = v !== name;
  });
}

function showToast(msg) {
  const toast = document.getElementById('copy-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function pillarDotColor(score) {
  if (score === null || score === undefined) return '#8a8a8a';
  if (score >= 0.6) return '#a83a2a';
  if (score >= 0.3) return '#c07800';
  return '#3a7a50';
}

function pillarDetailText(key, p) {
  if (!p || p.score === null || p.score === undefined) {
    return key === 'c2pa' ? 'Not yet active' : 'Excluded from analysis';
  }
  if (p.excluded_reason === 'audio_dubbing_pattern') {
    return 'Excluded — audio dubbing pattern detected';
  }
  if (p.excluded_reason) {
    return `Excluded — ${p.excluded_reason.replace(/_/g, ' ')}`;
  }
  return `${Math.round(p.score * 100)}% manipulation score`;
}

function renderEvidenceCards(pillarDetail) {
  const container = document.getElementById('evidence-list');
  if (!pillarDetail || typeof pillarDetail !== 'object' || Object.keys(pillarDetail).length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--ink-softer);padding:14px 0">No evidence detail available.</p>';
    return;
  }
  container.innerHTML = Object.entries(pillarDetail).map(([key, p]) => {
    const label = PILLAR_LABELS[key] || key;
    const dotColor = pillarDotColor(p ? p.score : null);
    const detail = pillarDetailText(key, p);
    return `<div class="evidence-card">
  <div class="evidence-dot" style="background:${dotColor}"></div>
  <div>
    <div class="evidence-title">${escHtml(label)}</div>
    <div class="evidence-detail">${escHtml(detail)}</div>
  </div>
</div>`;
  }).join('');
}

function renderVerdict(data, clipUrl) {
  const meta = VERDICT_META[data.verdict] || { color: '#8a8a8a', label: 'Unknown', headline: '' };
  const pct = (data.score !== null && data.score !== undefined)
    ? Math.round(data.score * 100) + '%'
    : '—';
  const platform = derivePlatform(clipUrl);

  document.getElementById('verdict-hero-band').style.background = meta.color;
  document.getElementById('verdict-loupe').style.color = meta.color;

  const pill = document.getElementById('verdict-state-pill');
  pill.textContent = meta.label;
  pill.style.background = meta.color;

  document.getElementById('verdict-headline').textContent = meta.headline;

  const scorePct = document.getElementById('verdict-score-pct');
  scorePct.textContent = pct;
  scorePct.style.color = meta.color;

  const sourceRow = document.getElementById('verdict-source-row');
  sourceRow.textContent = (platform ? platform + ' · ' : '') + truncate(clipUrl);

  renderEvidenceCards(data.pillar_detail || null);

  const copyBtn = document.getElementById('copy-link-btn');
  if (data.analysis_id) {
    copyBtn.hidden = false;
    copyBtn.onclick = () => {
      const link = `https://skept.co/v/${data.analysis_id}`;
      navigator.clipboard.writeText(link)
        .then(() => showToast('Copied'))
        .catch(() => showToast('Could not copy'));
    };
  } else {
    copyBtn.hidden = true;
  }
}

function showAnalysisError() {
  document.getElementById('analysis-error').classList.add('visible');
  document.getElementById('progress-bar').style.animationPlayState = 'paused';
}

function resetToIntake() {
  showView('intake');
  const input = document.getElementById('url-input');
  input.value = '';
  input.classList.remove('error');
  document.getElementById('url-error').classList.remove('visible');
  document.getElementById('analysis-error').classList.remove('visible');
  document.getElementById('progress-bar').style.animationPlayState = 'running';
}

async function startAnalysis(url) {
  showView('analysing');
  document.getElementById('clip-url-display').textContent = truncate(url);
  document.getElementById('analysis-error').classList.remove('visible');
  document.getElementById('progress-bar').style.animationPlayState = 'running';

  try {
    const res = await submitVerify(url);
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/'; return; }
      showAnalysisError();
      return;
    }
    const data = await res.json();
    renderVerdict(data, url);
    showView('verdict');
  } catch {
    showAnalysisError();
  }
}

function initIntake() {
  const input = document.getElementById('url-input');
  const errEl = document.getElementById('url-error');

  function isValidUrl(val) {
    return val.length > 0 && (val.startsWith('http://') || val.startsWith('https://'));
  }

  function handleSubmit() {
    const val = input.value.trim();
    if (!isValidUrl(val)) {
      input.classList.add('error');
      errEl.classList.add('visible');
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
      input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
      return;
    }
    input.classList.remove('error');
    errEl.classList.remove('visible');
    startAnalysis(val);
  }

  document.getElementById('check-btn').addEventListener('click', handleSubmit);

  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });

  input.addEventListener('input', () => {
    if (input.classList.contains('error') && isValidUrl(input.value.trim())) {
      input.classList.remove('error');
      errEl.classList.remove('visible');
    }
  });
}

async function init() {
  const user = await checkAuth();
  if (!user) return;

  document.getElementById('try-another-link').addEventListener('click', e => {
    e.preventDefault();
    resetToIntake();
  });

  document.getElementById('check-another-btn').addEventListener('click', resetToIntake);

  initIntake();
}

init();
