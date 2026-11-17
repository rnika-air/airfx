# Changelog

Each release's section becomes its GitHub Release notes. Write changes under
**Unreleased** as you go; `npm run release` turns that into the new version.

## Unreleased
### New effects
- **Image Reactor**: turns any picture into an audio-reactive visual. Eight scenes (Infinite Tunnel, Kaleidoscope, Contour Echo, Flow Smear, Melt, Shatter, Breathe, Prism), symmetry, twist, tiles, glass-rib, fisheye and pinch lenses, trails that zoom and turn, palettes (Gold, Ice, Acid, Infrared, Ember, Mono, your own two colours), hue drift and vignette. You choose what follows what: by default bass bends the picture, mids reshape it, highs add fine detail and the beat zooms, flashes, shifts colour, shakes or inverts. With no sound playing it moves on its own, so you can see the look first.
- **Reaction Diffusion**: grows living Turing patterns (maze, spots, leopard, coral, worms, holes, waves, or your own feed and kill rates) that follow the picture’s tones and, if you like, the direction of its edges. Shown as two inks, printed into the picture’s colours, as an embossed relief, or over the picture. A real chemical simulation on a fixed grid, grown by time, so an export grows exactly like the preview.
- **LED Screen**: the picture on a screen seen up close: RGB stripes, round LEDs, staggered (delta) or single-colour dots, with gaps, glow and refresh flicker. Brightness 1× keeps the picture’s own brightness for every layout.
- **Audio Pulse**: put it at the end of the stack and everything before it zooms, turns, flashes, shifts colour, shakes or blurs with the music.
- Reeded Glass has a new **Waves** pattern (wavy fluted glass).

### Audio
- New analysis controls: Attack and Release (how fast levels rise and fall), Beat Sensitivity, Beat Spacing, separate Bass, Mid and High levels, and adjustable crossovers between the bands. They are kept between visits.
- New **Hit** signal: any sudden attack (snare, clap, pluck), alongside Level, Bass, Mid, High and Beat.
- Beat detection now compares each rise with how much the track usually moves, so busy tracks do not fire constantly and quiet ones still do. Tested on a synthetic track: every kick and every snare detected, no false ones.
- Fixed: video export ignored the Sensitivity and Smoothing set in the Audio tab, so exports reacted differently from the preview. Export now uses exactly the same analysis settings.
- Audio tab: **Route By Role** links a slider of the selected effect to each part of the sound (Bass → distortion, Mid → shape, High → detail, Beat → flash or zoom). Any slider can be linked from the Audio tab, each link has its own depth slider, and Auto-Map uses these roles for effects without their own suggestion.

### Suggested for this picture
- When a picture or clip is open, the Effect panel shows what AirFx measured: brightness, contrast, colour, warmth, detail, a busy background, where the subject probably is (or your selection), the brightest spot, and for video how much it moves and whether the light changes. It then suggests settings for the selected effect (contrast, thresholds at the picture’s middle tone, cell sizes for the amount of detail, lights on the brightest spot, centres on the subject, colours taken from the picture), each with its reason. Nothing changes until you press Apply.

### The whole effect library, re-tested and re-tuned
- Every effect was rendered on portraits, landscapes, architecture, an object, typography, abstract art, bright and dark photos, and three videos (fast movement, night, close-up), checked at preview and export size, and checked for flicker on video.
- **Auto Tone** (on by default) for 40 effects and stacks whose look depends on brightness levels, among them Threshold, Dots, Halftone, ASCII, Dithering, Stippling, Newspaper Print, Spray Stencil, Duotone, Posterize, Thermal Vision, Shape Halftone, Pixel Crusher and the Red Data, Multi Threshold and Gameboy stacks. Dark night shots no longer turn black and white pages no longer turn blank. On video it is eased over time, so it never pumps.
- Glow & Bloom, Anamorphic Streaks and Light Rays: **Only True Highlights** (on by default), so a white page or a bright sky no longer glows all over.
- Dithering and Dithering Lab no longer “boil” on video (**Steady On Video**): areas that did not change keep their dots, so only movement redraws.
- Moiré no longer darkens the picture by half (**Keep Brightness**). Dots and Stippling keep the picture’s brightness; stippling dots can now fill shadows.
- Thermal Vision has an **Auto** heat source that follows the picture’s warm colours and light (and a depth map when there is one) instead of guessing nearness from position.
- Glyph Array finds each picture’s own most vivid colour instead of only reacting to pink.
- Edge lines and Holographic scanlines are now the same weight in a 4K export as in the preview.
- Speech Typography shapes the words from the picture’s light until body tracking or a selection is ready, instead of a flat wall of text.
- Better defaults: Chromatic Aberration, Grunge (contrast now turns around the picture’s own middle tone), Liquid Chrome (smoother metal), Pointillism (no paper gaps), Pixel Crusher, Pattern Merge, Shape Halftone, Node Network, Iridescent Film, ASCII and Red Data.
- Projects and saved stacks from earlier versions open exactly as they looked: the new switches start off for them.

## v5.1.1 (2026-11-17)
- The intro, log-in and About previews now rotate through real photos, videos and GIFs, each with a different AirFx effect running on it live, and a Photo / Video / GIF marker shows which kind is on screen.
- Effect tiles use several photos.
- The AirFx wordmark on the intro is flat again.

## v5.1.0 (2026-11-17)
### New look, made for phones
- New intro screen: the AirFx wordmark, a live before/after preview cycling through real effects (Glitch 2.0, Moiré, Pixel Art, Ink Bleed, Dreamy, Scatter, Liquify and more) on a sample photo, and Enter AirFx / Create Account / Log In. A Skip Intro button jumps past the opening animation.
- Redesigned log-in and sign-up screen that continues from the intro: log in, sign up, forgot password, show password, continue as guest, and a way back to the intro.
- Phone and tablet editor: the preview stays on screen, with a bottom bar for Preview, Effects, Adjust, Layers and Export. Effects open their settings in a bottom sheet that can be dragged larger or smaller. Large thumbnails, finger-sized sliders and buttons, pinch to zoom the preview, double-tap to fit. Phones held sideways show the panel beside the preview.
- About AirFx page: about, info, features, the creator (Iman Mikhail, Malaysia), contact and legal sections. Opens from the Info button, the account window, or the phone menu.
- Dialogs fit small screens.

## v5.0.1 (2026-11-12)
- Fixed: on screens narrower than about 1700 px, the Project menu was covered by the buttons on the right and could not be clicked. The top bar now never overlaps: smaller windows hide the less important parts, and the workspace tabs scroll sideways if needed.
- Clearer message when the server has reached its hourly limit for sending emails.

## v5.0.0 (2026-11-12)
### Public web platform
- Accounts: sign up, log in, password reset by email, profile, change email and password, delete account.
- My Projects: save projects to your account (private), open them on any device, rename and delete. Thumbnails show each project.
- My Media: upload pictures, videos and songs to your account and use them in the editor.
- Presets sync to your account and merge with the ones already in your browser.
- Plans: Free, Pro and Studio limits for storage, file size, projects and presets (payments not active yet; every account is Free).
- Install AirFx as an app from the browser: app icon, standalone window, offline app shell, and a notice when a new version is ready.
- Guests can still use the full editor with local saving, unless the site requires an account.
- Error reports from the app are collected on the server (no media or project content).

## v4.4.0 (2026-11-10)
- Gesture Studio: paint with your hands in front of the webcam, with an interactive tutorial.
- Sound Visualizer redesigned as a motion-design composition.
- Faster preview: smaller renders while dragging a control, distinct Performance, Balanced and Quality modes.
- Removed Neo Y2K.

## v4.3.0
- Eight effects: Night Vision, Thermal Vision, Invisible / Reveal, Particle Simulation, Speech Typography, Audio Shapes & Distortion, Modulation, Crayon.
- Threshold Photocopy / Toner Print mode. New Adjust tab.

## v4.2.0
- Dreamy, Ink Bleed, Sound Visualizer, Image To Pixel Art, Glitch 2.0.
