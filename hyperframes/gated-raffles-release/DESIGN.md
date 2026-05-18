# Gated Raffles — HyperFrames Design Brief

## Format
| Property | Value |
|---|---|
| Dimensions | 1080 × 1920 px (9:16 portrait) |
| Duration | 37 seconds |
| Frame rate | 30 fps |
| Scenes | 7 |

---

## Brand

### Colors
| Role | Hex | Usage |
|---|---|---|
| Primary teal | `#238D9D` | Scene 1/5 bg, badges, accents, numbers |
| Teal mid | `#69B1BC` | `<em>` highlights in dark scenes |
| Teal ultra-light | `#F0FDFF` | Scene 3/6 background |
| Teal overlay | `rgba(35,141,157,0.10–0.28)` | Icon halos, card borders, pill borders |
| Dark slate | `#0F1A1C` | Scene 2/4/7 background |
| Dark card | `#152428` | Requirement card backgrounds |
| Body dark | `#0F2830` | Primary text on light backgrounds |
| Body mid | `#1A3540` | Card requirement text |
| Body muted | `#3A6070` / `#2A4F5E` | Subtext on light backgrounds |
| Muted teal label | `#7A9FAB` | Card footer secondary text |
| Success green | `#07955F` | Passed-gate checkmarks |
| Quest amber | `#F59E0B` | Daily quest gate icon |
| White overlay | `rgba(255,255,255,0.xx)` | Floating badge bg, stat card bg |

### Typography
| Family | Source | Weights used |
|---|---|---|
| **FT Sterling Trial** | `assets/fonts/` (copied from `packages/react-app/public/fonts/sterling/`) | 400, 500, 600, 700 |
| **DM Sans** | Google Fonts CDN (fallback; inlined by HyperFrames compiler) | 400, 500, 600, 700 |

Font stack: `'FT Sterling', 'DM Sans', system-ui, sans-serif`

---

## Assets

| Asset | Source path | Used in |
|---|---|---|
| AkibaMiles logo mark | `packages/react-app/public/logo.svg` | Scenes 1, 7 (inlined SVG) |
| Ticket icon | `packages/react-app/public/svg/ticket.svg` | Floating decorations, Scene 1 |
| Pass icon | `packages/react-app/public/svg/pass-icon.svg` | Scene 4 requirement card (inlined, simplified) |
| USDT icon | `packages/react-app/public/img/usdt-icon.png` | Scene 4 USDT requirement (copied to `assets/img/`) |
| FT Sterling fonts | `packages/react-app/public/fonts/sterling/*.woff` | All scenes (copied to `assets/fonts/`) |

> All assets loaded from local `assets/` directory — no external URLs except Google Fonts CDN for DM Sans fallback and GSAP CDN (both inlined by the HyperFrames compiler at render time).
> No `.env` values, private keys, service keys, wallet keys, or secrets are used or displayed.

---

## Scene Timeline

| # | Name | Start | Duration | Background |
|---|---|---|---|---|
| 1 | Hook | 0s | 5.5s | `#238D9D` teal |
| 2 | Problem | 5.5s | 5.5s | `#0F1A1C` dark |
| 3 | Product | 11s | 5.5s | `#F0FDFF` light |
| 4 | Example Requirements | 16.5s | 6s | `#0F1A1C` dark |
| 5 | Campaign Partnerships | 22.5s | 5.5s | `#238D9D` teal |
| 6 | User Flow | 28s | 5s | `#F0FDFF` light |
| 7 | Closing Card | 33s | 4s | `#0F1A1C` dark |

### Scene content

**Scene 1 · Hook**
- AkibaMiles logo lockup (circle icon + wordmark)
- "NEW" pill badge
- Headline: "Gated Raffles"
- Subtext: "Targeted rewards for the right users."
- 3 floating ticket icon badges (animated float)

**Scene 2 · Problem**
- Eye icon in teal ring
- Headline: "Some rewards need the *right audience.*"
- Subtext: "Not every campaign should use the same entry flow."
- Pill tags: High-value prizes · Partner campaigns · Loyalty rewards

**Scene 3 · Product**
- Eyebrow: "INTRODUCING"
- Headline: "Set entry requirements per raffle."
- Mock raffle card: 500 USDT · Gated badge · 2 requirement rows · ticket cost footer
- Subtext: "Create raffles that match the goal of each campaign."

**Scene 4 · Example Requirements**
- Headline: "Example *requirements*"
- 3 stacked requirement cards with slide-in + checkmark pop:
  - USDT icon · "Minimum USDT balance" · "Hold a balance threshold in your wallet"
  - Pass icon · "Prosperity Pass" · "Exclusive to verified pass holders"
  - Quest circle · "Daily 5 TX quest" · "Complete today's activity challenge"
- Footnote: "Examples only. Requirements can evolve by campaign."

**Scene 5 · Campaign Partnerships**
- Eyebrow: "FOR CAMPAIGN MANAGERS"
- Headline: "Flexible requirements."
- Subtext: "Shape raffle access around partner goals, user activity, or reward strategy."
- 2 stat cards: Per-raffle control / ALL or ANY mode

**Scene 6 · User Flow**
- Headline: "Users see what they need *before entering.*"
- Subtext: "Eligibility is checked before ticket purchase."
- 3-step numbered flow with connecting lines
- Result card: green checkmark · "You're eligible — enter."

**Scene 7 · Closing Card**
- AkibaMiles logo lockup (teal rounded square + wordmark)
- Live badge (green): "● Gated Raffles are live"
- Headline: "Better rewards. *Better targeting.* Better campaigns."
- 3 tagline rows: Admin-configured · On-chain checks · Automatic enforcement

---

## Motion Rules

| Element type | Animation | Easing | Duration |
|---|---|---|---|
| Headlines | `from` y+56–64, opacity 0 | `power3.out` | 0.6s |
| Subtext | `from` y+32–40, opacity 0 | `power2.out` | 0.45–0.5s |
| Cards | `from` y+64, opacity 0 | `back.out(1.2)` | 0.65s |
| Requirement cards | `from` x+64, opacity 0 (stagger 0.3s) | `power3.out` | 0.55s |
| Checkmarks | `from` scale 0 (stagger 0.2s) | `back.out(2.2)` | 0.38s |
| Pill tags | `from` y+28, opacity 0 (stagger 0.13s) | `power2.out` | 0.45s |
| Flow steps | `from` x-52, opacity 0 (stagger ~0.55s) | `power3.out` | 0.5s |
| Flow lines | `from` opacity 0, scaleY 0 (top origin) | linear | 0.3s |
| Logo / badge | `from` scale 0.72–0.8, opacity 0 | `back.out(1.5)` | 0.5–0.55s |
| Floating tickets | `from` offset+rotation, then sine float loop | `sine.inOut` yoyo | 1.4–1.6s |
| Fade-only elements | `from` opacity 0 | linear | 0.4–0.5s |

All GSAP timelines registered as:
```js
window.__timelines = window.__timelines || {};
window.__timelines['main'] = gsap.timeline({ paused: true });
```

---

## Rendering

```bash
# From the project directory:
npm run check    # lint + validate + inspect
npm run render   # → renders/gated-raffles-release_<timestamp>.mp4
```

Output: `renders/gated-raffles-release_<timestamp>.mp4`  
File size: ~3–4 MB · 37s · 1080×1920 · 30fps
