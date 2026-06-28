import { checkAuth } from '../auth.js';
import { submitVerify } from '../api.js';

const VERDICT_MAP = {
  likely_authentic:   { label: 'Likely Authentic',   band: 'green' },
  inconclusive:       { label: 'Ambiguous',           band: 'amber' },
  likely_manipulated: { label: 'Likely Manipulated',  band: 'red'   },
  insufficient_data:  { label: 'Insufficient Data',   band: 'amber' },
};

function scoreClass(score) {
  if (score === null || score === undefined) return 'amber';
  if (score < 0.40) return 'green';
  if (score < 0.60) return 'amber';
  return 'red';
}

async function init() {
  const user = await checkAuth();
  if (!user) return;

  document.getElementById('user-tier').textContent = user.tier;

  const form = document.getElementById('verify-form');
  const urlInput = document.getElementById('url-input');
  const checkBtn = document.getElementById('check-btn');
  const viewIntake = document.getElementById('view-intake');
  const viewLoading = document.getElementById('view-loading');
  const viewResult = document.getElementById('view-result');
  const errorBox = document.getElementById('error-box');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    errorBox.style.display = 'none';
    show(viewLoading);
    hide(viewIntake);
    hide(viewResult);
    checkBtn.disabled = true;

    try {
      const res = await submitVerify(url);
      const data = await res.json();

      if (!res.ok) {
        const msg = data.error === 'quota_exceeded'
          ? `Monthly quota reached (${data.run_count}/${data.cap} runs on ${data.tier} plan).`
          : data.error === 'ingestion_failed'
          ? 'Could not download that URL. Check it is publicly accessible.'
          : 'Analysis failed. Please try again.';
        showError(msg);
        show(viewIntake);
        hide(viewLoading);
        checkBtn.disabled = false;
        return;
      }

      renderResult(data, url);
      show(viewResult);
      hide(viewLoading);
    } catch {
      showError('Network error. Please check your connection.');
      show(viewIntake);
      hide(viewLoading);
      checkBtn.disabled = false;
    }
  });

  document.getElementById('analyse-another').addEventListener('click', () => {
    hide(viewResult);
    show(viewIntake);
    urlInput.value = '';
    checkBtn.disabled = false;
  });

  function renderResult(data, url) {
    const { verdict, score, pillar_detail } = data;
    const vInfo = VERDICT_MAP[verdict] || { label: verdict, band: 'amber' };
    const band = vInfo.band;
    const pct = score !== null && score !== undefined ? Math.round(score * 100) : null;

    document.getElementById('verdict-band').className = `verdict-band ${band}`;
    document.getElementById('verdict-label').textContent = vInfo.label;
    document.getElementById('verdict-url').textContent = url.length > 60 ? url.slice(0, 60) + '…' : url;

    const scoreBar = document.getElementById('score-bar-fill');
    const scorePct = document.getElementById('score-pct');
    if (pct !== null) {
      scoreBar.style.width = pct + '%';
      scoreBar.className = `score-fill ${band}`;
      scorePct.textContent = pct + '%';
    } else {
      scoreBar.style.width = '50%';
      scoreBar.className = 'score-fill amber';
      scorePct.textContent = 'N/A';
    }

    const pillarsEl = document.getElementById('pillars');
    pillarsEl.innerHTML = '';
    if (pillar_detail) {
      for (const [key, p] of Object.entries(pillar_detail)) {
        if (p.score === null && !p.excluded) continue;
        const name = key === 'deepfake' ? 'Video detection' : key === 'audio' ? 'Audio & voice' : key === 'c2pa' ? 'Provenance (C2PA)' : key;
        const pScore = p.excluded ? null : p.score;
        const cls = pScore !== null ? scoreClass(pScore) : 'soft';
        const scoreText = p.excluded
          ? (p.excluded_reason === 'audio_dubbing_pattern' ? 'Excluded — dubbing pattern' : 'Excluded')
          : pScore !== null ? Math.round(pScore * 100) + '%' : '—';

        const row = document.createElement('div');
        row.className = 'pillar-row';
        row.innerHTML = `<span class="pillar-name">${name}</span><span class="pillar-score ${cls}">${scoreText}</span>`;
        pillarsEl.appendChild(row);
      }
    }
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }

  function show(el) { el.style.display = 'block'; }
  function hide(el) { el.style.display = 'none'; }
}

init();
