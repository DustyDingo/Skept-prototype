# v0.19 Consolidation Checklist

Living document tracking what's been decided, what's pending, and what needs folding into project documents at their next revisions. Update as decisions land. Filename tracks the current project brief baseline; will be renamed at each baseline bump.

**Current baselines:**
- Project Brief — **v0.24** (29 Jun 2026)
- Legal Brief — **v0.10** (23 Jun 2026)
- Engineers Brief — **v0.21** (29 Jun 2026)
- Trademark Clearance Brief — **v0.3** (19 May 2026, AU filing outcome documented)
- Advisor Script — **v1.4** (30 Apr 2026, acquisition phasing corrected)

**Targets:** Trademark Clearance Brief v0.4 (US/EU/UK filing outcomes; entity assignment once incorporated; Class 41 skip confirmed; any phrase mark filing decision). No active PB/EB targets queued.

---

## 1. Companion notes and their status

| **Document** | **Status** | **Notes** |
| --- | --- | --- |
| platform-seal-interactivity-decision.md | 🔵 Archived — historical record | Three-layer strategy reference. Folded into project brief §16.9. Retained as historical deliberation record only — not an active reference. |
| origin-reverification-feature.md | 🟢 Live reference | Origin re-verification feature spec. Folded into project brief v0.14 and engineers brief v0.6. Retained as extended spec record. |
| skept-mark-rendering-revised.html | 🟢 Live specimen | Visual identity concept — referenced from project brief §12.7. |
| skept-trust-seal-ux.html | 🟢 Live specimen — v0.2 | Seal in context — referenced from project brief §16.9. Idle-pulse animation + `prefers-reduced-motion` fallback. |
| skept-public-verdict-page.html | 🟢 Live specimen | Verdict page anatomy — referenced from project brief §16.10. |
| skept-how-it-works.html | 🟢 Live specimen | Public explainer page — referenced from project brief §16.10. |
| skept-analysis-history-ui.html | 🟢 Live specimen | History UI — referenced from project brief §9. |
| skept-account-settings.html | 🟡 New specimen (30 Apr) | Account settings screen prototype. Six sections: Profile, Security, Notifications, Subscription, Theme, Privacy & data. Spec in engineers_brief §4.11. |
| skept-landing.html | 🟡 New specimen (29 Apr) | Coming-soon landing page with waitlist form. Not yet deployed as production entry point. |
| skept-verify-flow.html | 🟡 New specimen (29 Apr) | Free-tier verify flow prototype. |
| skept-verify-flow-pro.html | 🟡 New specimen (29 Apr) | Pro signed-in verify flow prototype. |
| skept-signin-flow.html | 🟡 New specimen (29 Apr, v0.3) | Passwordless magic link sign-in flow. Phase 2 SSO badges on Apple/Google buttons. |
| waitlist-worker.js | 🟡 New (29 Apr) | Cloudflare Worker for waitlist email capture. Ready to deploy. |
| wrangler.toml | 🟡 New (29 Apr) | Wrangler config for waitlist worker. KV namespace IDs are placeholders. |
| CLOUDFLARE_WORKER.md | 🟡 New (29 Apr, renamed) | Setup and deploy walkthrough for waitlist worker. |

All retired companion notes from v0.4–v0.6 cycles remain retired.

---

## 2. Closed items — reference table

Items fully closed and filed in their respective briefs. Detail is in the brief version history.

| **Item** | **Closed** | **Brief sections** |
| --- | --- | --- |
| §3.1 Trademark Clearance Brief revision | 30 Apr 2026 | Clearance Brief v0.2; Legal Brief v0.4; PB §12.4 |
| §3.2 Domain acquisition sequencing | 30 Apr 2026 | PB §12.4 |
| §3.3 Cloudflare stack | 30 Apr 2026 | PB §11.4, §14; EB §4.2, §13 |
| §3.4 Verify flow specimens | 30 Apr 2026 | PB §16.10, §9.7; EB §4.6 |
| §3.5 Product verb ("Skept it") | 30 Apr 2026 | PB §12.7.4; Clearance Brief §7 |
| §3.6 Bluesky + Discord platforms | 30 Apr 2026 | PB §1, §3.1, §4.7; EB §1, §2.1, §3.7, §4.3 |
| §3.7 Account settings surface | 30 Apr 2026 | PB §9.8, §15; EB §4.6, §4.11, §13; LB §8 |
| §3.8 Magic link auth spec | 30 Apr 2026 | EB §4.9 |
| §3.9 Subscription infrastructure | 30 Apr 2026 | PB §11.5, §14; EB §4.10, §13 |
| §3.10 Bot/CIB detection | 30 Apr 2026 | PB §2, §4.7; EB §3.7 |
| §3.11 Origin re-verification | 01 May 2026 | PB §4.5, §7.4, §9.4, §11.5, §14, §16.4; EB §3.5, §4.5a |
| §3.12 Acronym appendix | 04 May 2026 | PB Appendix A; EB Appendix A |
| §3.13 Trust seal idle-pulse animation | 04 May 2026 | PB §16.9.1 |
| §3.14 Watermarking scope update | 04 Jun 2026 | PB §16.3, §16.5 |
| §3.15 Certification mark legal framing | 04 Jun 2026 | PB §16.6.1; LB v0.8 (2 new attorney Qs) |
| §3.16 Journalist → Max rename + pricing | 04 Jun 2026 | PB §11.5; EB §4.10 |
| §3.17 Fusion weights + verdict bands | 04 Jun 2026 | EB §4.4, §13 |
| §3.18 Replicate deepfake live + calibration gaps | 06 Jun 2026 | EB v0.12: §3.2, §3.3, §4.4, §13 |
| §3.19 Bug batch — Bugs 1–6 | 15 Jun 2026 | All six resolved — EB v0.13 |
| §3.20 Synthetic generation detector | 27 Jun 2026 | EB §3.8 (fully documented — Sightengine selected, weight 0.25, deferral rationale); implementation is a dev task not a doc gap |
| §3.22 Three new live-run bugs | 15 Jun 2026 | EB v0.13 |
| §3.23 Two carry-forward items (C2PA + frame scalar) | 17 Jun 2026 | EB v0.13 |
| §3.24 Non-human content guard | 27 Jun 2026 | EB §3.1 (guard active and documented — content_type: non_human, evidence card copy spec confirmed in code) |
| §3.25 Per-frame latency anomaly | 27 Jun 2026 | Obsolete — was Replicate/scamai specific; Resemble replaced Replicate at v0.17. Re-test against reference clip if latency resurfaces on Resemble. |
| §3.26 Faceswap false negative (gender-swap) | 27 Jun 2026 | EB §3.1 (reference clip retained, coverage gap documented); EB §8.1.2 (labelled training data); PB §4.2 (coverage limitation). Re-run reference clip against Resemble at next calibration session. |
| §3.28 Audio/fusion logging gap | 19 Jun 2026 | CLAUDE.md |
| §3.29 Subject identity logging gap | 19 Jun 2026 | CLAUDE.md |
| §3.30 Authenticity verification principle | 27 Jun 2026 | EB §4.4 (four-state model, per-pillar criteria — fully documented); PB §2 (core detection principle). Code implementation is a dev task tracked in CLAUDE.md, not a doc gap. |
| §3.31 Trump QID hardcode + wordninja | 27 Jun 2026 | Confirmed via Extension |
| §3.32 Audio `resemble_raw=n/a` log artefact | 22 Jun 2026 | — |
| §3.33 Resemble video + fusion restructure | 22 Jun 2026 | EB v0.17 |
| §3.34 deepfake `video_metrics.score` parse fix | 22 Jun 2026 | — |
| §3.35 Non-human guard + traversal fix | 22 Jun 2026 | — |
| §3.36 Resemble `consistency` + `certainty` | 22 Jun 2026 | EB v0.18 |
| §3.37 Asymmetric exclusion (`audio_dubbing_pattern`) | 22 Jun 2026 | EB v0.17 |
| §3.38 Deepfake contribution zeroed on exclusion | 22 Jun 2026 | — |
| §3.39 Frame count display inverted | 23 Jun 2026 | — |
| §3.40 Asymmetric exclusion not surfaced in UI | 23 Jun 2026 | EB v0.18 §4.6 |
| §3.41 Clip duration cap at 15s before Resemble | 22 Jun 2026 | EB v0.18 §3.1, §4.6 |
| §3.42 Video-job audio score not consumed | 23 Jun 2026 | EB v0.19 §3.2, §4.4 |
| §3.43 Pillar active count fusion-only | 23 Jun 2026 | — |
| §3.44 Audio card body stale post-§3.42 swap | 24 Jun 2026 | — |
| §3.45 Audio pillar anchors at 0.50 on no-speech | 26 Jun 2026 | — |
| §3.46 Session expired banner on completed verdict | 24 Jun 2026 | — |
| §3.47 Chrome Extension: DOM audit workflow | 24 Jun 2026 | — |
| §3.48 Resemble C2PA result not consumed | 25 Jun 2026 | EB §4.5 → v0.20 |
| §3.49 "Analysis session expired" false-positive | 25 Jun 2026 | — |
| §3.51 `audio_dubbing_pattern` exclusion not functional | 24 Jun 2026 | EB §4.4 → v0.20 |
| §3.52 Fusion input score unlogged intermediate | 24 Jun 2026 | — |
| §3.53 Audio card body stale `final_score` | 24 Jun 2026 | — |
| §3.54 File upload no progress state | 25 Jun 2026 | — |
| §3.55 Duplicate Resemble submissions | 24 Jun 2026 | — |
| §3.56 Pillar active count includes excluded pillars | 26 Jun 2026 | — |
| §3.57 Standalone audio.wav call replaced by video_job_omni | 24 Jun 2026 | EB §4.4, §5 → v0.20 |
| §3.58 Stale dubbing-pattern DOM label | 26 Jun 2026 | — |
| §3.59 Audio card copy on no-audio-stream clips | 27 Jun 2026 | — |
| §3.60 Audio pillar row in wrong stage block | 26 Jun 2026 | — |
| §3.61 Resemble C2PA not consumed; stub shows "skipped" | 25 Jun 2026 | EB §4.5 → v0.20 |
| §3.62 Audio score divergence from Resemble dashboard | 26 Jun 2026 | — |
| §3.63 High-variance flag not in evidence card | 27 Jun 2026 | EB §3.1 (high_variance flag and evidence card note confirmed in code and brief) |
| §3.64 Wikidata startup timeout | 25 Jun 2026 | — |
| §3.65 502 banner obscures completed verdict | 25 Jun 2026 | — |
| §3.66 URL validation before yt-dlp | 26 Jun 2026 | — |
| §3.67 Confidence meter zone-divider markers | 25 Jun 2026 | — |
| §3.68 Stripe account live; MCP plugin installed | 26 Jun 2026 | — |
| §3.70 Audio `max(raw, 0.0)` calibration monitoring | 27 Jun 2026 | Note only — fold calibration observation into EB §3.3 at next brief build; no active action |
| §3.71 Audio `(raw+1)/2` → `max(raw, 0.0)` rebuild | 26 Jun 2026 | EB §3.3 → v0.21 |
| §3.72 `video_job_audio_label` not forwarded | 27 Jun 2026 | — |
| §3.69 Certainty scalar suppression — evidence card note | 27 Jun 2026 | EB v0.21 §4.6 (note spec); PB v0.24 §4 (note). Three-round diagnostic; root cause: note inside excluded gate. Deployment `63384a23`. |
| §3.73 Evidence card summary false negative on suppressed scores | 27 Jun 2026 | EB v0.21 §4.6 (summary copy spec). Bundled with §3.69. Deployment `63384a23`. |
| §3.74 Video suspicion score reads wrong field | 27 Jun 2026 | UI only — no brief impact. Card was reading `certainty_weighted_score`; fixed to `final_score`. Deployment `22f28beb`. |
| §3.75 Certainty scalar inverted + base score wrong field | 27 Jun 2026 | EB v0.21 §3.2. Two-stage fix: scalar formula corrected (`min(skept_frames, resemble_frame_count) / skept_frames`, deploy `15be7c1c`); base score switched from per-frame mean to `video_metrics.score` (deploy `5924057a`). Result: `certainty=1.0000, final_score=0.6010` → 60% Likely Manipulated on Biden/alien Reel. |
| §3.62 Audio score normalisation disclosure | 27 Jun 2026 (confirmed stale) | Fixed in commit `49c0fd6` (26 Jun); verified in batch session same day. Checklist carried as open in error. No action required. |
| §3.21 + §3.27 Subject identity — EB spec section | 29 Jun 2026 | EB v0.21 §3.9 (new section: spaCy NER, Wikidata list, wordninja hashtag pre-processing, evidence card copy, Phase 1 limitation, Phase 2 face recognition gate); EB v0.21 §4.4 (Source Details table row added); EB v0.21 §13 (backlog item → confirmed live). |
| §3.50 Cloudflare production stack — steps 6–7 | 29 Jun 2026 | Step 6 complete: Stripe dashboard (4 subscription products, 3 top-up one-time products, webhook registered), RevenueCat (4 entitlements, 11 Test Store products, HMAC webhook), 3 Workers deployed (skept-stripe-checkout, skept-stripe-webhook, skept-revenuecat-webhook), D1 migrations confirmed, all secrets provisioned. Step 7 (landing page swap) deferred to launch day. |

---

## 3. Open items

No open items. All consolidation checklist items closed as of 29 Jun 2026.

---

## 4. Sidelined / Parked items

| **Item** | **Status** | **Notes** |
| --- | --- | --- |
| Camera seal scanner | Parked | Too exotic for committed roadmap; screen-filling UX concern. Future direction: loupe mark as scannable credential with embedded machine-readable glyph. Worth exploring post-MVP. |
| Separate engineering Claude project | ✅ Resolved — 26 May 2026 | Claude Code CLI adopted instead. CLAUDE.md pushed to DustyDingo/Skept-prototype as canonical dev reference. |
| Image and longer-clip scope | Parked | Images at Phase 2, longer clips as Max-tier only when ready. |
| Max-tier verify flow specimen | Parked | Free and Pro specimens establish the pattern; Max tier is a Phase 2 surface. |
| GPU self-hosting strategy | Deferred — revisit at scale | Replicate replaced by Resemble as active provider (live v0.17). Railway GPU self-hosting remains the agreed long-term direction — deferred until prototype otherwise stable. Three-phase roadmap: Phase A self-host weights on Railway GPU; Phase B calibration on real-world clips; Phase C fine-tune on short-form social content. Custom model is the competitive moat. |

---

## 5. Document state snapshot

| **Document** | **Version** | **Last touched** | **Next planned revision** |
| --- | --- | --- | --- |
| project_brief_v0_24.docx | v0.24 | 29 Jun 2026 | No planned revision queued |
| legal-brief-v0_10.docx | v0.10 | 23 Jun 2026 | Next attorney engagement outcomes or new legal questions |
| engineers_brief_v0_21.docx | v0.21 | 29 Jun 2026 | No planned revision queued |
| trademark-clearance-brief-v0_3.docx | v0.3 | 19 May 2026 | v0.4 — US/EU/UK filing outcomes; entity assignment; Class 41 skip confirmed |
| skept-account-settings.html | v0.2 | 05 May 2026 | Next UX iteration cycle |
| skept-trust-seal-ux.html | v0.2 | 04 May 2026 | Next UX iteration cycle |
| skept-landing.html | v0.1 | 29 Apr 2026 | Launch day — slide out; skept-signin-flow.html slides in |
| skept-verify-flow.html | v0.2 | 05 May 2026 | Next UX iteration cycle |
| skept-verify-flow-pro.html | v0.2 | 05 May 2026 | Next UX iteration cycle |
| skept-signin-flow.html | v0.3 | 05 May 2026 | Fine-tuning adjustments outstanding before launch deploy |
| waitlist-worker.js | v0.1 | 29 Apr 2026 | When deployed — fill KV namespace IDs in wrangler.toml |
| CLOUDFLARE_WORKER.md | v0.1 | 29 Apr 2026 | No planned revision |
| skept_advisor_script_v1_4.docx | v1.4 | 30 Apr 2026 | No planned revision |
| skept-pricing-summary-v2_2.md | v2.2 | 28 Jun 2026 | Update on any pricing change — authoritative source, always read before citing numbers |
