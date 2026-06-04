# DESIGN.md — AkibaMiles Raffle Skit

## Style Prompt
Meme-energy mobile game show. Bright 2D animation, bold UI cards, AkibaMiles teal on white, exaggerated comedic timing. Feels like someone screen-recorded a phone app mid-fever dream — but make it gorgeous. Fast cuts, prize explosions, fake meters, confetti rain. The vibe is "your phone is rooting for you harder than your friends are."

## Colors
- `#238D9D` — AkibaMiles primary teal (borders, buttons, accents)
- `#0FF5E4` — cyan highlight / glow (game-show flash)
- `#FFFFFF` — card backgrounds, headline text on dark
- `#1A1A2E` — deep navy background (drama scenes)
- `#FFD700` — gold (luck meter, prizes, star bursts)
- `#FF4D6D` — hot pink / alert (comedic emphasis, glitch)
- `#F0FFFE` — off-white tint for cards on light bg

## Typography
- `Syne` — headlines, meme text, game-show labels (bold/extrabold)
- `Inter` — UI labels, card body text, button text

## Motion
- Entrances: overshoot (`back.out(1.7)`) and elastic (`elastic.out(1, 0.5)`) for comedic effect
- Numbers: fast counter snaps, not smooth rolls
- Game-show flashes: scale pulse + brightness flicker
- Prize cards: spin + fly (rotation + x/y arcs)
- Confetti: deterministic seeded positions (mulberry32)

## What NOT to Do
- No gradients that span full 1080×1920 vertically (banding)
- No slow fade-ins — everything pops or slams in
- No generic explainer typography (no Roboto, no paragraph text)
- No exit animations before transitions — transition handles scene changes
- No `repeat: -1` anywhere
