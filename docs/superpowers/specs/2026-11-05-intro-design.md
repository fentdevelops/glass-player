# Glassy first-launch intro

Status: requested by the owner on 5 November 2026. Their reaction to the first mockup was that it looked ugly, so it was redone. Current preview: `docs/superpowers/mockups/intro-preview.html`, waiting for their reaction.

## Intent

The first time someone opens Glassy, it should feel special: a moving background in the app icon's colors, a few smooth screens explaining the app, then an animation into the app itself. Same idea on Windows, Mac and iPhone.

## Flow

1. **Welcome:** the icon and the name over the moving background.
2. **Three to four short screens:** what it plays and that files stay yours, synced lyrics, sound you can shape, making it your own.
3. **Sign up:** the screen described in the accounts design, modeled on the owner's example. The glass shape shrinks to become the logo at top left. While accounts are switched off, this whole screen is skipped.
4. **Terms first:** signing up with any method opens the scrolling terms. I agree lights up at the end. See `2026-11-05-accounts-design.md`.
5. **Into the app:** the card dissolves and the real glass panels rise into place one after another, over the ambient background, which glides into the app's own background.

The first-launch song finder, once built, goes between 4 and 5.

## Rules

- **Colors, from `build/icon.svg`:** gradient `#2f2493`, `#7c3be0`, `#f2589c`, `#ffab68`. Glows `#56d2ff`, `#ffd36a`, `#ff78d6`, `#4a2fd0`.
- **Look:** no cards around the words. Big type directly on a dark, moving background where the icon's colors glow out of deep indigo, not a bright wash. One piece of real liquid glass travels through every screen and morphs between them, and ends up as the app's queue panel.
- **Motion:** everything glides, one motion at a time, using the app's easing. Reduced-motion setting: crossfades only, and the background holds still.
- **Copy:** plain language, only what the app really does.
- **Never in the way:** Skip is always available. It shows once per install. Replay from Settings. People who already have a library don't see it after updating.
- **Light on the machine:** the background is a small canvas scaled up and blurred, and it stops completely once the intro ends. Nothing plays sound.

## Not in this

Song finder logic. Real sign-in, which comes with accounts.

## Left to the builder

Exact screen copy and timing within these rules.
