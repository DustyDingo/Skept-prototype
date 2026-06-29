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
  const day = String(d.getUTCDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
    footerHedge: 'no manipulation signals found',
  },
  ambiguous: {
    color: '#c07800',
    pill: 'Signs of manipulation',
    headline: 'One or more analysers flagged something. Signals conflict.',
    hedge: 'Mixed confidence. This is a finding of ambiguity, not a verdict of manipulation.',
    footerHedge: 'signals conflict',
  },
  suspicious: {
    color: '#c07800',
    pill: 'Signs of manipulation',
    headline: 'One or more analysers flagged something. Signals conflict.',
    hedge: 'Mixed confidence. This is a finding of ambiguity, not a verdict of manipulation.',
    footerHedge: 'signals conflict',
  },
  manipulated: {
    color: '#a83a2a',
    pill: 'Strong AI indicators',
    headline: 'Multiple analysers agree. Strong signs of AI generation.',
    hedge: 'High confidence — not certainty. False positives occur. Do not treat this as a finding of fact.',
    footerHedge: 'false positives occur',
  },
};

const PILLAR_LABELS = {
  deepfake: 'Video deepfake detection',
  audio: 'Audio & voice clone detection',
  c2pa: 'C2PA provenance',
};

function pillarDotColor(d) {
  if (d.excluded_reason || d.score === null || d.score === undefined) return '#8a8a8a';
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

function renderEvidenceCards(evidenceJson, strongestSignal, verdictColor) {
  let parsed = null;
  if (evidenceJson) {
    try { parsed = JSON.parse(evidenceJson); } catch { parsed = null; }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const label = strongestSignal || 'Analysis result';
    return `
      <div class="evidence-card">
        <div class="signal-dot" style="background:${verdictColor}"></div>
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

const SHARED_FONTS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sorts+Mill+Goudy:ital,wght@0,400;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">`;

const SKEPT_MARK_SVG = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="skept-mark" viewBox="0 0 100 100">
      <rect x="29.7" y="64.3" width="30" height="12" rx="6"
            transform="rotate(135, 29.7, 70.3)" fill="currentColor"/>
      <circle cx="58" cy="42" r="40" fill="currentColor"/>
      <circle cx="58" cy="42" r="35" fill="#2a2a2a"/>
      <text x="57" y="62" font-family="'Sorts Mill Goudy', serif"
            font-style="italic" font-size="62" text-anchor="middle"
            fill="#faf8f3">S</text>
    </symbol>
  </defs>
</svg>`;

const SHARED_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --amber:          #b87400;
      --amber-warm:     #c07800;
      --amber-soft:     rgba(184,116,0,0.09);
      --amber-border:   rgba(184,116,0,0.25);
      --ink:            #1a1a1a;
      --ink-soft:       #5a5a5a;
      --ink-softer:     #8a8a8a;
      --rule:           #e8e4db;
      --rule-soft:      #f0ece2;
      --bg:             #faf8f3;
      --card:           #ffffff;
      --green:          #3a7a50;
      --green-light:    #7aaa88;
      --amber-state:    #c07800;
      --red-state:      #a83a2a;
      --goudy: 'Sorts Mill Goudy', Georgia, serif;
      --ui:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    body { font-family: var(--ui); background: var(--bg); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; }

    /* NAV */
    .skept-nav {
      position: sticky;
      top: 0;
      z-index: 200;
      height: 56px;
      background: rgba(250,248,243,0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--rule);
      display: flex;
      align-items: center;
      padding: 0 24px;
      gap: 0;
    }
    .nav-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; color: var(--ink); flex-shrink: 0; }
    .nav-logo svg { display: block; }
    .nav-wordmark { font-family: var(--goudy); font-style: italic; font-size: 21px; line-height: 1; color: var(--ink); letter-spacing: -0.01em; }
    .nav-spacer { flex: 1; }
    .nav-links { display: flex; align-items: center; gap: 4px; }
    .nav-link {
      font-size: 13.5px; font-weight: 400; color: var(--ink-soft); text-decoration: none;
      padding: 6px 12px; border-radius: 5px; transition: color 0.15s, background 0.15s;
      white-space: nowrap; cursor: pointer; background: none; border: none;
      font-family: var(--ui); line-height: 1;
    }
    .nav-link:hover { color: var(--ink); background: rgba(0,0,0,0.04); }
    .nav-link.active { color: var(--amber); font-weight: 500; }
    .nav-link--signin { color: var(--ink); font-weight: 500; border: 1px solid var(--rule); background: var(--card); }
    .nav-link--signin:hover { border-color: var(--amber-border); background: var(--card); color: var(--ink); }
    .nav-auth   { display: none; }
    .nav-unauth { display: none; }
    body[data-auth="true"]  .nav-auth   { display: flex; align-items: center; gap: 4px; }
    body[data-auth="false"] .nav-unauth { display: flex; align-items: center; gap: 4px; }

    /* FOOTER */
    .skept-footer {
      border-top: 1px solid var(--rule);
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .footer-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; color: var(--ink-softer); }
    .footer-logo svg { display: block; color: var(--ink-softer); }
    .footer-wordmark { font-family: var(--goudy); font-style: italic; font-size: 16px; color: var(--ink-softer); line-height: 1; letter-spacing: -0.01em; }
    .footer-copy { font-size: 12px; color: var(--ink-softer); letter-spacing: 0.01em; }`;

function renderSharedNav() {
  return `
<nav class="skept-nav" aria-label="Main navigation">
  <a class="nav-logo" href="/">
    <svg width="26" height="26" aria-hidden="true"><use href="#skept-mark"/></svg>
    <span class="nav-wordmark">Skept</span>
  </a>
  <div class="nav-spacer"></div>
  <div class="nav-links nav-unauth">
    <a class="nav-link" href="/how-it-works">How it works</a>
    <a class="nav-link nav-link--signin" href="/signin">Sign in</a>
  </div>
</nav>`;
}

function renderSharedFooter() {
  return `
<footer class="skept-footer">
  <a class="footer-logo" href="/">
    <svg width="20" height="20" aria-hidden="true"><use href="#skept-mark"/></svg>
    <span class="footer-wordmark">Skept</span>
  </a>
  <span class="footer-copy">© 2026 Skept</span>
</footer>`;
}

function render404() {
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
  </style>
</head>
<body data-auth="false">
${SKEPT_MARK_SVG}
${renderSharedNav()}
<main>
  <div class="not-found-inner">
    <svg width="40" height="40" style="color:#8a8a8a"><use href="#skept-mark" style="color:#8a8a8a"/></svg>
    <h1 class="not-found-heading">This result couldn't be found.</h1>
    <p class="not-found-sub">It may have expired or the link may be incorrect.</p>
    <a href="https://skept.co" class="home-link">← Back to Skept</a>
  </div>
</main>
${renderSharedFooter()}
</body>
</html>`;
}

function renderVerdictPage(row, permalinkId) {
  const vc = VERDICT_CONFIG[row.verdict_state] || VERDICT_CONFIG.ambiguous;
  const scorePct = (row.score !== null && row.score !== undefined) ? Math.round(row.score * 100) : null;
  const scoreDisplay = scorePct !== null ? `${scorePct}%` : '—';
  const dateStr = fmtDate(row.created_at);
  const platform = platformLabel(row.platform);
  const clipUrlShort = truncUrl(row.clip_url);
  const evidenceHtml = renderEvidenceCards(row.evidence_json, row.strongest_signal, vc.color);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Skept — ${esc(vc.pill)}</title>
  <meta name="robots" content="noindex">${SHARED_FONTS}
  <style>${SHARED_CSS}

    /* MAIN CONTENT */
    main {
      flex: 1; max-width: 560px; margin: 0 auto;
      padding: 40px 32px 80px; width: 100%;
    }

    /* HERO CARD */
    .hero-card {
      background: var(--card); border: 1px solid var(--rule);
      border-radius: 8px; overflow: hidden;
    }
    .verdict-band { height: 6px; width: 100%; }
    .hero-body { padding: 24px; }

    .mark-pill-row { display: flex; align-items: center; gap: 12px; }
    .verdict-pill {
      display: inline-flex; align-items: center;
      padding: 5px 14px; border-radius: 20px;
      font-size: 13px; font-weight: 600; color: white;
      letter-spacing: 0.01em;
    }
    .hero-headline {
      font-size: 20px; font-weight: 600; line-height: 1.4;
      color: var(--ink); margin-top: 14px;
    }

    /* CONFIDENCE-HEDGE PANEL */
    .hedge-panel {
      margin-top: 12px;
      display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
    }
    .score-large { font-size: 36px; font-weight: 300; line-height: 1; }
    .hedge-copy { font-size: 13px; color: var(--ink-soft); line-height: 1.5; flex: 1; min-width: 160px; }

    /* CLIP META */
    .clip-meta {
      margin-top: 16px;
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      font-size: 12px; color: var(--ink-softer);
    }
    .meta-sep { color: var(--rule); }

    /* EVIDENCE CARDS */
    .evidence-section { margin-top: 16px; }
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
      margin-top: 16px;
      background: var(--card); border: 1px solid var(--rule);
      border-radius: 6px; padding: 18px 20px;
      display: flex; align-items: flex-start; gap: 14px;
      text-decoration: none; color: inherit;
    }
    .context-card:hover { border-color: var(--ink-softer); }
    .context-icon {
      width: 28px; height: 28px; border-radius: 50%;
      background: var(--amber-soft); border: 1px solid rgba(184,116,0,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: var(--amber);
      flex-shrink: 0; margin-top: 1px;
    }
    .context-title { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
    .context-sub { font-size: 13px; color: var(--ink-soft); }

    /* CTA BLOCK */
    .cta-block {
      margin-top: 16px; padding: 32px 24px;
      background: var(--card); border: 1px solid var(--rule);
      border-radius: 8px; text-align: center;
    }
    .cta-heading {
      font-family: var(--goudy); font-style: italic;
      font-size: 22px; color: var(--ink); margin-bottom: 8px;
    }
    .cta-sub { font-size: 14px; color: var(--ink-soft); margin-bottom: 20px; }
    .cta-btn {
      display: inline-block; padding: 12px 28px;
      background: var(--ink); color: white; border-radius: 6px;
      text-decoration: none; font-size: 14px; font-weight: 600;
      transition: opacity 0.12s;
    }
    .cta-btn:hover { opacity: 0.85; }

    /* FOOTER DISCLAIMER */
    .footer-disclaimer {
      margin-top: 24px;
      font-size: 11px; color: var(--ink-softer);
      text-align: center; line-height: 1.6;
    }

    @media (max-width: 640px) {
      main { padding: 32px 16px 64px; }
      .hero-body { padding: 20px 16px; }
      .hero-headline { font-size: 18px; }
      .score-large { font-size: 28px; }
      .cta-block { padding: 24px 16px; }
    }
  </style>
</head>
<body data-auth="false">
${SKEPT_MARK_SVG}
${renderSharedNav()}

<main>
  <div class="hero-card">
    <div class="verdict-band" style="background:${vc.color}"></div>
    <div class="hero-body">
      <div class="mark-pill-row">
        <svg width="28" height="28" style="color:${vc.color}"><use href="#skept-mark" style="color:${vc.color}"/></svg>
        <span class="verdict-pill" style="background:${vc.color}">${esc(vc.pill)}</span>
      </div>
      <h1 class="hero-headline">${esc(vc.headline)}</h1>
      <div class="hedge-panel">
        <span class="score-large" style="color:${vc.color}">${scoreDisplay}</span>
        <p class="hedge-copy">${esc(vc.hedge)}</p>
      </div>
      <div class="clip-meta">
        <span>${esc(platform)}</span>
        ${row.clip_url ? `<span class="meta-sep">·</span><span>${esc(clipUrlShort)}</span>` : ''}
      </div>
    </div>
  </div>

  <div class="evidence-section">
    ${evidenceHtml}
  </div>

  <a href="/how-it-works" class="context-card">
    <div class="context-icon">?</div>
    <div>
      <div class="context-title">What is this? How does Skept work?</div>
      <div class="context-sub">About automated video analysis</div>
    </div>
  </a>

  <div class="cta-block">
    <div class="cta-heading">Analyse a clip yourself</div>
    <p class="cta-sub">Free to use. Check any short-form video before you share it.</p>
    <a href="https://skept.co" class="cta-btn">Get Skept</a>
  </div>

  <p class="footer-disclaimer">Automated analysis · may be incorrect · ${esc(vc.footerHedge)} · skept.co/v/${esc(permalinkId)} · ${esc(dateStr)}</p>
</main>

${renderSharedFooter()}
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
      return new Response(render404(), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  },
};
