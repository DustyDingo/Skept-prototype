function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(unixTs) {
  const d = new Date(unixTs * 1000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function truncUrl(url, max = 55) {
  if (!url) return '';
  if (url.length <= max) return url;
  return url.slice(0, max) + '…';
}

const PLATFORM_DISPLAY = {
  tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube',
  discord: 'Discord', unknown: 'Unknown source',
};

function platformLabel(p) {
  if (!p) return 'Unknown';
  return PLATFORM_DISPLAY[p] || (p.charAt(0).toUpperCase() + p.slice(1));
}

const VERDICT_CONFIG = {
  authentic: {
    color: '#3a7a50',
    pill: 'Verified original',
    headline: 'All analysers clean. No manipulation signals found.',
    hedge: 'This is an automated check — interpretation is yours.',
    footerHedge: 'low manipulation signals',
    scoreNote: 'Low manipulation probability',
  },
  ambiguous: {
    color: '#c07800',
    pill: 'Signs of manipulation',
    headline: 'One or more analysers flagged something. Signals conflict.',
    hedge: 'Mixed confidence. This is a finding of ambiguity, not a verdict of manipulation.',
    footerHedge: 'mixed signals — interpret with care',
    scoreNote: null,
  },
  suspicious: {
    color: '#c07800',
    pill: 'Signs of manipulation',
    headline: 'One or more analysers flagged something. Signals conflict.',
    hedge: 'Mixed confidence. This is a finding of ambiguity, not a verdict of manipulation.',
    footerHedge: 'mixed signals — interpret with care',
    scoreNote: null,
  },
  manipulated: {
    color: '#a83a2a',
    pill: 'Strong AI indicators',
    headline: 'Multiple analysers agree. Strong signs of AI generation.',
    hedge: 'High confidence — not certainty. This is an automated observation. False positives occur. Do not treat this as a finding of fact.',
    footerHedge: 'strong manipulation indicators',
    scoreNote: null,
  },
};

const PILLAR_LABELS = {
  deepfake: 'Video deepfake detection',
  audio: 'Audio & voice clone detection',
  c2pa: 'C2PA provenance',
};

function pillarDotColor(d) {
  if (d.excluded || d.score === null || d.score === undefined) return '#8a8a8a';
  if (d.score < 0.30) return '#3a7a50';
  if (d.score < 0.60) return '#c07800';
  return '#a83a2a';
}

function pillarDetailText(name, d) {
  if (d.excluded_reason === 'audio_dubbing_pattern') {
    return 'Excluded — audio-dubbing pattern detected. Video reads clean; audio flagged.';
  }
  if (d.score === null || d.score === undefined) {
    if (name === 'c2pa') return 'Provenance data not available for this clip.';
    if (name === 'audio') return 'No speech detected — excluded from analysis.';
    return 'Signal unavailable — excluded from analysis.';
  }
  const pct = Math.round(d.score * 100);
  if (pct <= 5) return `${pct}% — Clean. No significant manipulation signals detected.`;
  if (pct < 30) return `${pct}% — Low manipulation signals.`;
  if (pct < 60) return `${pct}% — Moderate signals. Results are inconclusive.`;
  return `${pct}% — Strong manipulation signals detected.`;
}

function renderEvidenceCards(evidenceJson, strongestSignal) {
  let parsed = null;
  if (evidenceJson) {
    try { parsed = JSON.parse(evidenceJson); } catch { parsed = null; }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const label = strongestSignal || 'Analysis result';
    return `
      <div class="evidence-card">
        <div class="signal-dot" style="background:#8a8a8a"></div>
        <div><div class="signal-title">${esc(label)}</div></div>
      </div>`;
  }

  let html = '';
  for (const [name, d] of Object.entries(parsed)) {
    const label = PILLAR_LABELS[name] || name;
    const dotColor = pillarDotColor(d);
    const detail = pillarDetailText(name, d);
    html += `
      <div class="evidence-card">
        <div class="signal-dot" style="background:${dotColor}"></div>
        <div>
          <div class="signal-title">${esc(label)}</div>
          <div class="signal-detail">${esc(detail)}</div>
        </div>
      </div>`;
  }
  return html;
}

const SHARED_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --amber:      #b87400;
      --ink:        #1a1a1a;
      --ink-soft:   #5a5a5a;
      --ink-softer: #8a8a8a;
      --bg:         #faf8f3;
      --card:       #ffffff;
      --rule:       #e8e4db;
      --goudy: 'Sorts Mill Goudy', Georgia, serif;
      --ui:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    body { font-family: var(--ui); background: var(--bg); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; }
    nav {
      position: sticky; top: 0; z-index: 100;
      backdrop-filter: saturate(140%) blur(8px);
      background: rgba(250,248,243,0.92);
      border-bottom: 1px solid var(--rule);
      padding: 0 32px; height: 52px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .nav-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--ink); }
    .nav-brand .wordmark { font-family: var(--goudy); font-style: italic; font-size: 22px; color: var(--ink); }
    .nav-link { font-size: 13px; color: var(--ink-soft); text-decoration: none; }
    .nav-link:hover { color: var(--ink); }
    footer { border-top: 1px solid var(--rule); background: var(--bg); padding: 20px 32px; }
    .footer-inner { max-width: 1080px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .footer-brand { display: flex; align-items: center; gap: 7px; }
    .footer-wordmark { font-family: var(--goudy); font-style: italic; font-size: 16px; color: var(--ink); }
    @media (max-width: 640px) { nav { padding: 0 16px; } footer { padding: 16px; } }`;

const SHARED_FONTS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sorts+Mill+Goudy:ital,wght@0,400;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">`;

const SKEPT_MARK_SVG = `
<svg style="width:0;height:0;position:absolute" aria-hidden="true">
  <defs>
    <symbol id="skept-mark" viewBox="0 0 100 100">
      <rect x="26" y="63" width="28" height="11" rx="5.5" transform="rotate(135,26,69)" fill="currentColor"/>
      <circle cx="58" cy="42" r="38" fill="currentColor"/>
      <text x="57" y="62" font-family="'Sorts Mill Goudy',serif" font-style="italic" font-weight="400" font-size="60" text-anchor="middle" fill="#faf8f3">S</text>
    </symbol>
  </defs>
</svg>`;

function renderSharedNav() {
  return `
<nav>
  <a class="nav-brand" href="https://skept.co">
    <svg width="28" height="28" style="color:#1a1a1a"><use href="#skept-mark" style="color:#1a1a1a"/></svg>
    <span class="wordmark">Skept</span>
  </a>
  <a class="nav-link" href="https://skept.co/how-it-works">What is this?</a>
</nav>`;
}

function render404(msg) {
  const message = msg || 'This result link is invalid or has expired.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Skept — Result not found</title>${SHARED_FONTS}
  <style>${SHARED_CSS}
    main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 80px 32px; }
    .not-found-inner { text-align: center; max-width: 400px; }
    .not-found-heading { font-family: var(--goudy); font-style: italic; font-size: 26px; color: var(--ink); margin-bottom: 12px; margin-top: 20px; }
    .not-found-sub { font-size: 14px; color: var(--ink-soft); margin-bottom: 24px; }
    .home-link { font-size: 14px; color: var(--amber); text-decoration: none; }
    .home-link:hover { text-decoration: underline; }
    .footer-copy { font-size: 12px; color: var(--ink-softer); }
  </style>
</head>
<body>
${SKEPT_MARK_SVG}
${renderSharedNav()}
<main>
  <div class="not-found-inner">
    <svg width="40" height="40" style="color:#8a8a8a"><use href="#skept-mark" style="color:#8a8a8a"/></svg>
    <h1 class="not-found-heading">Result not found</h1>
    <p class="not-found-sub">${esc(message)}</p>
    <a href="https://skept.co" class="home-link">← Back to Skept</a>
  </div>
</main>
<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <svg width="18" height="18" style="color:#1a1a1a"><use href="#skept-mark" style="color:#1a1a1a"/></svg>
      <span class="footer-wordmark">Skept</span>
    </div>
    <span class="footer-copy">© 2026 Skept</span>
  </div>
</footer>
</body>
</html>`;
}

function renderVerdictPage(row, permalinkId) {
  const vc = VERDICT_CONFIG[row.verdict_state] || VERDICT_CONFIG.ambiguous;
  const scorePct = (row.score !== null && row.score !== undefined) ? Math.round(row.score * 100) : null;
  const thumbPct = scorePct !== null ? Math.max(2, Math.min(98, scorePct)) : 50;
  const scoreDisplay = scorePct !== null ? `${scorePct}%` : '—';
  const scoreNote = (row.verdict_state === 'authentic' && scorePct !== null) ? vc.scoreNote : null;
  const dateStr = fmtDate(row.created_at);
  const platform = platformLabel(row.platform);
  const clipUrlShort = truncUrl(row.clip_url);
  const evidenceHtml = renderEvidenceCards(row.evidence_json, row.strongest_signal);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Skept — ${esc(vc.pill)}</title>
  <meta name="robots" content="noindex">${SHARED_FONTS}
  <style>${SHARED_CSS}

    /* HERO */
    .hero-wrapper { background: var(--card); border-bottom: 1px solid var(--rule); }
    .verdict-band-strip { height: 6px; width: 100%; }
    .hero-body { max-width: 1080px; margin: 0 auto; padding: 40px 32px 48px; }

    .mark-pill-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .verdict-pill {
      display: inline-flex; align-items: center;
      padding: 5px 14px; border-radius: 20px;
      font-size: 13px; font-weight: 600; color: white;
      letter-spacing: 0.01em;
    }
    .hero-headline {
      font-family: var(--goudy); font-style: italic;
      font-size: 28px; line-height: 1.35; color: var(--ink);
      margin-bottom: 28px; max-width: 640px;
    }

    /* HEDGE PANEL */
    .hedge-panel { margin-bottom: 28px; }
    .score-display { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; }
    .score-large { font-size: 52px; font-weight: 300; line-height: 1; color: var(--ink); }
    .score-sub { font-size: 13px; color: var(--ink-softer); }

    .meter-wrapper { margin-bottom: 12px; }
    .meter-track {
      position: relative; height: 6px; border-radius: 3px;
      background: linear-gradient(to right, #3a7a50 0%, #3a7a50 30%, #c07800 30%, #c07800 60%, #a83a2a 60%, #a83a2a 100%);
      margin-bottom: 8px;
    }
    .meter-thumb {
      position: absolute; width: 14px; height: 14px;
      background: var(--ink); border: 2px solid white;
      border-radius: 50%; top: -4px;
      transform: translateX(-50%);
      box-shadow: 0 1px 3px rgba(0,0,0,0.20);
    }
    .meter-labels {
      display: flex; justify-content: space-between;
      font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
      color: var(--ink-softer); text-transform: uppercase;
    }
    .hedge-copy { font-size: 13px; color: var(--ink-soft); line-height: 1.55; }

    /* CLIP META */
    .clip-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .meta-platform {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.09em; color: var(--ink-softer);
    }
    .meta-sep { color: var(--rule); }
    .meta-url { font-size: 12px; color: var(--ink-softer); word-break: break-all; }

    /* MAIN */
    main { flex: 1; max-width: 1080px; margin: 0 auto; padding: 40px 32px 80px; width: 100%; }
    .section-label {
      font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--ink-softer); margin-bottom: 14px;
      padding-bottom: 8px; border-bottom: 1px solid var(--rule);
    }

    /* EVIDENCE CARDS */
    .evidence-card {
      display: flex; align-items: flex-start; gap: 14px;
      background: var(--card); border: 1px solid var(--rule);
      border-radius: 6px; padding: 18px 20px; margin-bottom: 10px;
    }
    .signal-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
    .signal-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .signal-detail { font-size: 13px; color: var(--ink-soft); line-height: 1.4; }

    /* CONTEXT CARD */
    .context-card {
      background: var(--card); border: 1px solid var(--rule);
      border-radius: 6px; padding: 18px 20px; margin-top: 20px;
    }
    .context-link { font-size: 14px; color: var(--amber); text-decoration: none; }
    .context-link:hover { text-decoration: underline; }

    /* CTA BLOCK */
    .cta-block {
      margin-top: 40px; padding: 36px 32px;
      background: var(--card); border: 1px solid var(--rule);
      border-radius: 8px; text-align: center;
    }
    .cta-heading {
      font-family: var(--goudy); font-style: italic;
      font-size: 24px; color: var(--ink); margin-bottom: 8px;
    }
    .cta-sub { font-size: 14px; color: var(--ink-soft); margin-bottom: 22px; }
    .cta-btn {
      display: inline-block; padding: 12px 28px;
      background: var(--ink); color: white; border-radius: 6px;
      text-decoration: none; font-size: 14px; font-weight: 600;
      transition: opacity 0.12s;
    }
    .cta-btn:hover { opacity: 0.85; }

    /* FOOTER */
    .footer-disclaimer { font-size: 12px; color: var(--ink-softer); }

    @media (max-width: 640px) {
      .hero-body { padding: 28px 16px 36px; }
      main { padding: 32px 16px 64px; }
      .hero-headline { font-size: 22px; }
      .score-large { font-size: 40px; }
      .cta-block { padding: 28px 20px; }
    }
  </style>
</head>
<body>
${SKEPT_MARK_SVG}
${renderSharedNav()}

<div class="hero-wrapper">
  <div class="verdict-band-strip" style="background:${vc.color}"></div>
  <div class="hero-body">
    <div class="mark-pill-row">
      <svg width="32" height="32" style="color:#1a1a1a"><use href="#skept-mark" style="color:#1a1a1a"/></svg>
      <span class="verdict-pill" style="background:${vc.color}">${esc(vc.pill)}</span>
    </div>
    <h1 class="hero-headline">${esc(vc.headline)}</h1>
    <div class="hedge-panel">
      <div class="score-display">
        <span class="score-large">${scoreDisplay}</span>
        ${scoreNote ? `<span class="score-sub">${esc(scoreNote)}</span>` : ''}
      </div>
      <div class="meter-wrapper">
        <div class="meter-track">
          <div class="meter-thumb" style="left:${thumbPct}%"></div>
        </div>
        <div class="meter-labels">
          <span>Authentic</span>
          <span>Inconclusive</span>
          <span>Suspicious</span>
        </div>
      </div>
      <p class="hedge-copy">${esc(vc.hedge)}</p>
    </div>
    <div class="clip-meta">
      <span class="meta-platform">${esc(platform)}</span>
      ${row.clip_url ? `<span class="meta-sep">·</span><span class="meta-url">${esc(clipUrlShort)}</span>` : ''}
    </div>
  </div>
</div>

<main>
  <div class="section-label">Evidence</div>
  ${evidenceHtml}
  <div class="context-card">
    <a href="https://skept.co/how-it-works" class="context-link">What is this? How does Skept work? →</a>
  </div>
  <div class="cta-block">
    <div class="cta-heading">Analyse a clip yourself</div>
    <p class="cta-sub">Free to use. Check any short-form video before you share it.</p>
    <a href="https://skept.co" class="cta-btn">Get Skept</a>
  </div>
</main>

<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <svg width="18" height="18" style="color:#1a1a1a"><use href="#skept-mark" style="color:#1a1a1a"/></svg>
      <span class="footer-wordmark">Skept</span>
    </div>
    <span class="footer-disclaimer">Automated analysis · may be incorrect · ${esc(vc.footerHedge)} · skept.co/v/${esc(permalinkId)} · ${esc(dateStr)}</span>
  </div>
</footer>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const match = url.pathname.match(/^\/v\/([0-9a-f-]+)$/i);
    if (request.method !== 'GET' || !match) {
      return new Response(render404(), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const permalinkId = match[1];

    try {
      const row = await env.SKEPT_ANALYSIS_DB.prepare(
        'SELECT verdict_state, score, platform, clip_url, strongest_signal, evidence_json, conflict_flags, created_at FROM analysis_history WHERE permalink_uuid = ? LIMIT 1'
      ).bind(permalinkId).first();

      if (!row) {
        return new Response(render404(), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response(renderVerdictPage(row, permalinkId), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (err) {
      console.error('[verdict-worker] error:', err.message);
      return new Response(render404('An error occurred. Please try again.'), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  },
};
