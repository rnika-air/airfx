# Changelog

Each release's section becomes its GitHub Release notes. Write changes under
**Unreleased** as you go; `npm run release` turns that into the new version.

## Unreleased
### Intro
- The AirFx lettering is now a lime neon sign that melts under the cursor. It has a solid lime core, a glow running from black through dark green to lime, and horizontal scanline stripes. The pointer carries an invisible liquid blob: where it meets the letters they swell, run together and close up like liquid, then settle back into clean type as it moves away. A finger does the same on phones and tablets.
- The neon is drawn by the GPU (WebGL2) around the logo only. It animates only while something is moving, stops off screen and in background tabs, and the canvas never blocks clicks. Reduced motion shows it still, and without WebGL2 the plain wordmark shows as before.
- The front page shows one button, Enter AirFx. Create Account and Log In are hidden for now (accounts still work, and the buttons can be switched back on). When an account is required, Enter leads to log-in.
- The logo, intro text and Enter are centred on the screen, on phones too.
- The wordmark no longer uses a glow filter, which some graphics cards drew as a dark box behind it.

### Information page
- MIKAIR now stretches across the full width on its own row, below the Created By label, instead of running into it.
- The footer reads Created by MIKAIR 2026.

## v5.4.0 (2026-11-18)
### Intro
- AIRFX is the centrepiece: the AirFx lettering from the logo artwork, huge and lime in the middle of the screen (the hand-drawn swash is gone; the original A stays in the top bar). The live preview and an effect print lean in from either side, half behind it, with two more prints further back; the intro line and Enter sit beneath. The cards float gently; moving the pointer tilts the layers apart and lifts the card under the pointer. Phones stack it: wordmark, two prints, copy.
- The front-page credit now reads Created by MIKAIR. The information page keeps the full credit (MIKAIR, Iman Mikhail, Malaysia).
- Sharper on high-resolution and 4K screens: the live preview renders at the card's real size in device pixels instead of a fixed 360 × 450 stretched up, the tiles render larger, the dot opening is drawn by the GPU at full screen resolution, the wordmark is vector, the textured A is never shown larger than its own pixels, and text uses crisp antialiasing.
- A white A cursor on the intro, log-in and information pages (with a mouse; the editor and touch screens keep their usual cursors, text fields keep the text cursor).

### Information page
- New motion, after an editorial site: the headline lines rise in and lift away as you scroll, the picture band grows towards full width through the middle of the screen, sections slide in, and the creator credit arrives huge and settles to fit, with lime sparkles. All sections and information are unchanged. Still under reduced motion.
- Created By now reads MIKAIR, with Iman Mikhail beneath.

### Editor
- Depth Lab moved out of the workspace tabs into a new Experimental menu (and an Experimental group in the phone menu). It works as before; the Depth panel's Open Depth Test Lab button still opens it.
- AI is now Air throughout the interface: Air Models, Air Status, Air Worker, Air Diagnostics, Air Analysis, Air Reconstruction, error and status messages, and the information page. Model names and files are unchanged.
- Phone header: the logo and the workspace menu are now separate buttons.

### Effect library
- The Stacks folder is gone. Multi Threshold and Gameboy, which flatten a picture into a few printed tones, moved to Texture & Print with their settings unchanged. Hyper Glitch, Red Data, Pixel Stars, Array Riso and Array Airbrush were combinations of effects already in the library; they are no longer listed, but projects that use them still open and render.

### Ink Bleed
- Looks like real ink in paper: fresh ink stays wet and keeps creeping outward along the paper's fibres (faster where the paper soaks it up), then dries and holds. Thin ink is a see-through wash, dense ink goes solid, the drying edge darkens into a rim, and a fine paper grain breaks up the edges at full resolution. On a photo, ink starts from the picture's own darkest parts (or edges, or brightest parts) and keeps blooming and spreading in slow patches.
- New default: black ink, multiplied into the picture, on a new Image On Paper background (the picture printed faintly on paper, adjustable with Image Strength). Ink colour presets: Black Ink, Deep Navy, Dark Blue, Dark Red, Sepia, plus Navy + Red. Any colour can still be picked.
- New Dry Time control. Motion controls show only when ink follows movement, and Layer Separation only with more than one colour.

### Sound Visualizer
- Two new main forms. Spectral Strands: stacked glowing strands of pixel blocks across the frame, one per frequency band (or the whole spectrum, delayed strand by strand), each a record of its loudness flowing from the centre or scrolling, with stray pixels thrown off by the highs. Type Blocks: your own text, in your own font, set letter by letter across the frame, letters where the sound is sitting on colour blocks that reshuffle on each hit, rows drifting sideways at the pace of their band.
- New presets: Spectral Strands (the new default), Signal Stack, Type Blocks, Type Blocks Night. Ridgelines, Spectral Form, XY Scope, Custom Graphic and the other presets are kept; Liquid Form, Swiss Orbits, Ridgelines and XY Scope now fill the frame. New Riso Blocks palette.
- New Layout controls for every form: Full Frame, Size, Width, Height, Position X and Y, Rotation, Spacing, Offset and Intensity. Ridgelines and the other forms are laid out to fill the frame rather than just enlarged. Kinetic type has a horizontal position too.
- Interference Rings removed. Projects that used it show the Spectral Form instead.
- In silence, strands rest as faint lines, so the layout is visible before the sound starts.

### Controls that do something
- Every control of every effect was checked by changing it and comparing the render. Controls that only work in a certain mode now appear only in that mode: Bevel Depth (Bevelled Tile), Spin Angle (Spin modes), Gap Color and outline settings (Pixel Art), Threshold (Glyph Array shadows, highlights or edges), Second Color and Line Width (Audio Shapes), and the Custom Content settings, which now show only when a shape is set to Custom Content.

### Faster
- CRT, Chromatic Aberration, Moiré and Film Grain run on the GPU (WebGL2) when available, with the same maths as before (results match the CPU version to within rounding): 20 to 200 times faster each, in the preview and in exports, at any size the GPU supports. Without WebGL2 they run on the CPU as before.
- Pixel Sort no longer creates an object for every pixel it sorts.
- Measured on a 1280 × 720 frame: Pixel Sort + RGB Shift + CRT 280 → 97 ms; Dithering + Glow + Chromatic Aberration + Film Grain + VHS 233 → 113 ms; Halftone + Glow + Chromatic Aberration 140 → 73 ms; CRT + Film Grain + Chromatic Aberration about 290 → 16 ms. The preview turns this into higher resolution and smoother playback automatically; export quality is unchanged.

## v5.3.1 (2026-11-17)
### A new opening
- The intro now opens like a motion-design studio site: on black, a cluster of lime halftone dots appears, swells and melts into wavy diagonal bands edged in pink and cyan, floods the screen lime, then breaks back up into the small lime dots that stay behind the page. The dots swell around your pointer (and drift slowly on touch screens). Skip Intro stays available throughout.
- The intro layout is the interactive one again, now on black with lime highlights: the textured AirFx mark with a hand-drawn swash, the live preview laid over it, the effect tiles and the scrolling effect list.
- Smooth on phones: the opening is worked out at a fixed size and scaled to the screen.

### Logo
- The logo is now the AirFx mark on its own, and it is a button: click it anywhere (editor, phone menu, About, log-in) to go back to the intro.
- The browser tab shows the lime AirFx mark on its own, as big as the tab allows, with no background.
- The installed app opens on black on every device, with launch screens for iPhone and iPad.


## v5.3.0 (2026-11-17)
### New logo and opening screen
- New AirFx logo: the swept A mark with the AirFx word, in lime on black, across the intro, log-in, About page, editor, phone menu, browser tab and app icons. The intro shows the textured version of the mark.
- The intro keeps its familiar layout on black with lime highlights, and now has a halftone dot field that swells and lights up lime around your pointer (a slow drifting swell on touch screens).
- Fixed: on phones, the row of effect previews at the top of the intro was squashed flat, and the page opened scrolled down past it.
- New introduction: “A creative playground for experimental visuals, image manipulation, motion graphics and digital art. Explore new techniques, distort reality and create your own visual language.” On the intro and the About page. AirFx is no longer described as “AI-powered”.

### Previews with their own pictures
- Seven new photos and a new skate clip in the showcase. Every photo, clip and GIF now has its own effect, and no effect is shown twice. Pixel Crusher replaces Ink Bleed among the previews.

### New effects
- **Radial Blur**: zoom or spin blur around a point you place, with a sharp centre, light that streaks further than the rest, and an optional pulse.
- **Focus & Motion Blur**: Gaussian, motion (any angle) and tilt-shift (turns a scene into a miniature), with edges that never darken.
- **Polar Warp**: Little Planet, Tunnel, Unwrap and Infinite Spiral (a Droste spiral that can zoom endlessly), with twist, repeats and a hidden seam.
- **Hex Mosaic**: a honeycomb of tiny lenses (a compound eye or bubble wrap), flat tiles or bevelled tiles, with rim colour, gloss and light angle.
- **Voxel Cubes**: the picture rebuilt from isometric 3D cubes that rise with its brightness or darkness, in steps or smoothly.
- **Oil Paint**: colours merge into strokes of paint that follow the forms (a generalized Kuwahara filter), with brush marks, impasto lit from one side and canvas weave. Steady on video.
- **Snowfall**: snow in depth: far flakes small and slow, near flakes big and out of focus, with wind, sway, crystals and a winter haze.
- **PixDisplace**: new Explode Outward direction (blocks fly out from a centre and leave dark holes), Color Fringe, Dark Holes and Area, plus presets (Shattered Face, Signal Tear, Data Rain).
- **Distort**: new ZigZag mode. **Shape Halftone**: Square, Ring, Lines and Diagonal shapes.


## v5.2.0 (2026-11-17)
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
