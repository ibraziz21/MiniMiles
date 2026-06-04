# AkibaMiles Skill Games — Promotional Video Package

**Format:** 9:16 Vertical · 1080×1920 · 30fps · 28 seconds  
**Platforms:** TikTok · Instagram Reels · WhatsApp Status · In-app  
**Tool:** HeyGen / Hyperframes  

---

## Files in this package

```
promo-video/
├── scenes/
│   └── akibamiles-skill-games.hyperframes.json   ← Import this into Hyperframes
├── voiceover/
│   └── akibamiles-vo-final.txt                   ← TTS script + timing + HeyGen settings
├── assets/
│   └── svg/                                       ← All scene assets (18 SVG files)
│       ├── akibamiles-logo.svg
│       ├── miles-token.svg
│       ├── usdt-token.svg
│       ├── onchain-badge.svg
│       ├── verified-badge.svg
│       ├── trophy-icon.svg
│       ├── gamepad-icon.svg
│       ├── cta-button.svg
│       ├── card-back.svg
│       ├── tap-feedback-correct.svg
│       ├── tile-star-blue.svg
│       ├── tile-square-red.svg
│       ├── tile-circle-green.svg
│       ├── tile-diamond-gold.svg
│       ├── memory-sun.svg
│       ├── memory-moon.svg
│       ├── memory-sparkle.svg
│       └── memory-key.svg
├── exports/                                        ← Rendered output files go here
└── README.md                                       ← This file
```

---

## Scene → Asset Map

| Scene | Duration | Key Assets Used |
|-------|----------|----------------|
| 1 — Brand Intro | 0:00–0:04 | `akibamiles-logo.svg`, `miles-token.svg` |
| 2 — Hook | 0:04–0:08 | `trophy-icon.svg`, `gamepad-icon.svg` |
| 3 — Rule Tap | 0:08–0:14 | `tile-star-blue.svg`, `tile-square-red.svg`, `tile-circle-green.svg`, `tile-diamond-gold.svg`, `tap-feedback-correct.svg` |
| 4 — Memory Flip | 0:14–0:19 | `card-back.svg`, `memory-sun.svg`, `memory-moon.svg`, `memory-sparkle.svg`, `memory-key.svg` |
| 5 — Trust & Rewards | 0:19–0:24 | `onchain-badge.svg`, `verified-badge.svg`, `usdt-token.svg`, `miles-token.svg` |
| 6 — CTA | 0:24–0:28 | `akibamiles-logo.svg`, `cta-button.svg` |

---

## Brand Colors

| Name | Hex | Used for |
|------|-----|---------|
| AkibaTeal | `#238D9D` | Rule Tap, primary brand |
| AkibaPurple | `#5B35A0` | Memory Flip |
| AkibaDark | `#0A1628` | Backgrounds |
| Gold | `#F59E0B` | Trophy, tiers |
| White | `#FFFFFF` | Text, icons |

---

## How to Import into Hyperframes

1. Open [Hyperframes](https://hyperframes.ai) (or HeyGen video editor)
2. Click **New Project → Import Scene JSON**
3. Select `scenes/akibamiles-skill-games.hyperframes.json`
4. Upload SVG assets: go to **Assets → Upload**, select all files from `assets/svg/`
5. Match asset filenames to layer `src` references in the JSON (filenames match exactly)
6. In the **Audio** panel, paste the full read from `voiceover/akibamiles-vo-final.txt` into the TTS field with settings listed in that file
7. Add background music track to the BGM lane (see SFX notes below)
8. Preview and adjust per-scene timing if needed
9. Export using one of the four export profiles defined in the JSON

---

## SFX Procurement List

All sounds are short, royalty-free effects. Suggested sources: **Pixabay**, **Freesound.org**, **Zapsplat**.

| # | Scene | Timestamp | Description | Search term |
|---|-------|-----------|-------------|-------------|
| 1 | 1 | 0.5s | Logo reveal whoosh | "whoosh reveal logo" |
| 2 | 1 | 2.0s | Coin drop / miles token | "coin drop single" |
| 3 | 2 | 4.5s | Game start energy hit | "game start impact" |
| 4 | 3 | 9.0s | Correct tap tick | "tap correct soft tick" |
| 5 | 3 | 10.2s | Wrong tap buzz | "wrong buzz short" |
| 6 | 3 | 11.5s | Combo whoosh | "combo streak whoosh" |
| 7 | 4 | 14.5s | Card flip | "card flip paper" |
| 8 | 4 | 16.0s | Card match success | "match success chime" |
| 9 | 5 | 19.5s | Blockchain confirm / checkmark | "confirm blockchain ping" |
| 10 | 5 | 21.0s | USDT reward pop | "reward pop coins" |
| 11 | 6 | 25.0s | CTA tap / button press | "button tap soft" |

**Background music:** Upbeat lo-fi electronic / gamified feel. 130–140 BPM. Duck to -18dB under voiceover, -12dB during silent scenes.

---

## Export Profiles

| Profile | Resolution | Duration | Notes |
|---------|------------|----------|-------|
| TikTok / Reels (primary) | 1080×1920 | 28s | H.264, 30fps, stereo audio |
| WhatsApp Status | 720×1280 | 28s | H.264, 30fps, AAC 128k |
| Instagram Reels (alt) | 1080×1920 | 28s | H.265 preferred, 30fps |
| In-app / Web embed | 540×960 | 28s | H.264, lower bitrate |

---

## Quick Checklist Before Export

- [ ] All 18 SVG assets uploaded and matched to layer names
- [ ] Voiceover TTS generated and aligned to scene timestamps
- [ ] Background music added and ducked under voiceover
- [ ] All 11 SFX events placed at correct timestamps
- [ ] Color overlays match brand hex codes (no default HeyGen colors)
- [ ] AkibaMiles logo visible in Scene 1 and Scene 6
- [ ] "Play in AkibaMiles" CTA button clearly readable in Scene 6
- [ ] Exported at correct resolution for each target platform
