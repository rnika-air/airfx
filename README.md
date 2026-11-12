# AirFx

A personal, browser-based experimental visual effects studio.
Import an image or video, chain any of 129 effects and adjustments in a non-destructive stack, swap their shapes for your own words, fonts and graphics, select and track subjects, remove objects and reconstruct what was behind them, work with real depth maps, run it all live on your webcam, and export true 4K with every frame rendered.

Your media is processed **locally in your browser** and is never uploaded. The only network use is downloading an AI model when you press its Download button, and fetching public test photos when you run the Depth Test Lab. AirFx uses no cloud services and no external APIs.


## AirFx on the web

AirFx is a public web app: open the site, create a free account (or try it as a guest), and edit images and videos with the full effect library. Your effects, AI tools and exports run in your own browser.

- **Accounts:** sign up, log in, reset your password, edit your profile, delete your account.
- **My Projects:** save projects to your account and open them on any device. **My Media** keeps your uploads, and presets follow your account.
- **Install as an app:** in Chrome or Edge, use **Install AirFx** (top bar › your account, or the browser's address bar). It opens in its own window, starts offline, and tells you when an update is ready.
- **Plans:** Free today. Pro and Studio limits are prepared, but payments are not active.

Running it, deploying it and publishing updates: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). How it is built: [docs/WEB_PLATFORM.md](docs/WEB_PLATFORM.md). What changed: [CHANGELOG.md](CHANGELOG.md).

## Requirements

- Node.js 18+ (tested on Node 24)
- A recent Chrome or Edge is strongly recommended. AI, `ctx.filter` blurs, MP4 export and alpha video were tested there only. Firefox should run the effects. Safari lacks `ctx.filter`, so several blurs will not work there.

## Quick start on Windows

Double-click **`Start AirFx.bat`**. It:
1. checks that Node.js is installed, and opens the download page if it isn't;
2. installs the dependencies on the first run, and again if an older install is missing the AI package;
3. starts AirFx and opens it in your browser.

Keep the black window open while you work, and close it to stop AirFx.

## Install and run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173).

Other scripts:

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## Using it

1. **Import**: click *Import Media*, press `Ctrl/Cmd + O`, or drag a file onto the canvas.
   Supported: JPG, JPEG, PNG, WEBP, MP4, WEBM (and MOV if your browser can decode it; an iPhone HEVC MOV loaded on the test PC).
2. **Pick an effect** from the library on the left, or press **+** to add it to the stack. Moiré is selected on your first import. Search, filter by category, or filter by Image/Video.
3. **Adjust** the controls on the right. You can drag sliders, type exact values (↑/↓ steps, Shift for ×10), pick colours, or randomise seeds.
4. **Compare** with *Processed / Split / Original* in the toolbar, or **Bypass** (`B`). In Split mode, drag on the image to move the divider.
5. **Export** with `Ctrl/Cmd + S`.

Switching between workspaces never needs a re-import.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/Cmd + O` | Import media |
| `Ctrl/Cmd + S` | Open export dialog |
| `Space` | Play / pause video (or click the image) |
| `Esc` | Close dialogs |
| `R` | Reset active effect to defaults |
| `Ctrl/Cmd + Z`, `Ctrl/Cmd + Shift + Z` / `Ctrl + Y` | Undo / redo |
| `F` / `1` | Fit to screen / actual size |
| `C` | Cycle compare mode |
| `B` | Bypass the stack |
| `Ctrl/Cmd + wheel` | Zoom |

Shortcuts without a modifier are ignored while you type in a text field.

## The effect stack

Every look is a chain that runs top to bottom: Source Media → Analysis → your steps → Final Composite.

- Add steps with **+** in the library. Each step keeps its own settings, Mix and Blend mode.
- **Apply To** limits any step to the selected subject, everything but the subject, or the near or far half of the depth map.
- Hover over an effect in the library for its description, media support, main controls and any AI requirement. Thumbnails are made by the effect itself, on one small test picture.
- Each row can be toggled, reordered (arrows or drag), duplicated, reset or removed. **Reset Stack** clears everything and **Bypass** shows the source.
- Effects and image adjustments share one stack, so you can place a Curves step before or after a Halftone.
- The stack is undoable, and it is saved with projects, autosave and stack presets. Exports render the same chain.

## Image Adjust

The **Image Adjust** tab holds a photo-style toolset, in the same stack as effects:

| Group | Adjustments |
| --- | --- |
| Light | Light, Color & Vibrance, Clarity & Dehaze (dark-channel), Film Grain |
| Tonal | Levels, Curves (RGB + per channel, draggable editor), Exposure |
| Color | Hue / Saturation, Color Balance, Black & White, Photo Filter, Channel Mixer, Color Lookup (4 built-in looks, or your own 3D `.cube` file), Selective Color |
| Special | Invert, Posterize, Threshold, Gradient Map (editable stops and presets) |

1D `.cube` files are rejected with a clear message: only 3D LUTs are supported.

## Presets

The **Presets** tab saves one effect, a whole stack or a camera setup, in `localStorage` (parameters only, never media). Text, font names, shape and depth settings are all parameters, so they are saved. Uploaded files are not: a preset that used one asks you to add it again. You can load, rename, delete, and export or import the library as JSON. Invalid files are refused with a message. Some effects also have starting-point presets at the top of their panel.

## How media is processed

1. **Import.** The source is never changed.
2. **Analyse, only when asked.** Selection masks, depth maps and fine mattes are kept in memory per media file. Moving a slider never re-runs a model.
3. **Correct.** Brushes and extra clicks change the analysis result.
4. **Apply.** Steps run in stack order. Each step can use the whole image, the selected subject, everything but the subject, or the near or far half of the depth map (**Apply To** in the step's Stack Mix group).
5. **Composite, preview, export.** Export runs the same renderer at full size.

The Stack panel shows these layers: Source Media, Analysis (Mask, Depth, Matte), your steps, Final Composite.

Analysis is not saved in projects. Masks, depth maps and reconstructions are kept for the session, so re-run them after reopening. Their settings and any **Apply To** choices are saved.

## AirFx Key: select, then keep or remove

Open **Key** at the top. Key is inserted near the start of your stack, and an effect you never changed is replaced.

**1. Choose what you want.** **Keep Subject** preserves your selection and removes everything else. **Remove Subject** takes your selection out. It leaves a hole, and **Reconstruct Behind Subject** carries the same selection into AirFx Cleanup.

**2. Select.** Press Download & Load on EdgeTAM (39 MB), then:

| Tool | Use |
| --- | --- |
| **+ Click / − Click** | Click to add to or subtract from the object |
| **Smaller / Larger** | A click can mean a part or the whole. AirFx starts with the whole object, unless that reading is mostly thin lines leaking into the background. These step through the model's other readings |
| **Box** | Drag around an object |
| **Brush / Eraser** | Paint the mask directly. Needs no model |
| **Auto Subject, Find Person, List Objects** | Run the object detector, then select from what it finds. It only knows 80 everyday object types |
| **+ New Object** | Starts a separate object. Each has its own colour and can be hidden or removed |

The mask stays visible on the preview. Views: Final, Subject, Mask, Alpha, Original, plus Foreground and Background Plate on the right.

**3. Edges.** Matte contrast, expand/contract, feather, edge smoothing, Refine Edges (a guided filter that snaps the mask to image edges), edge decontamination and spill suppression. **Find Fine Detail** runs a matting model and uses it only near your selection's edge, which helps with hair. Results on hair are good, not perfect. Very thin, transparent or heavily motion-blurred edges may still need brushing.

**4. Track through video.** Select on any frame, then press **Track Selected Object**.

- Each frame's prompt comes from where the object moved to, and the answer is checked against the object's remembered size, colour and position. Answers that do not match are refused, so it does not jump to another object.
- When the object is hidden it keeps moving at its last speed and picks the object up when it returns.
- The strip shows every frame: green good, amber weak, blue hidden, red lost. Click a tick to go there, fix the mask, then press **Resume From Here**, which keeps the frames before it.
- If the object stays lost for 3 seconds, tracking stops with a warning.

About 0.6 s per frame on the test PC, so 19 s of video at 12 frames per second takes a little over 2 minutes per object. Tracking works from analysed frames, so choose a higher rate for fast motion.

**Select each part as its own object.** The model follows one object. A hand holding a camera is two or more objects, and one box around both slowly loses a part. Use **+ New Object** for each part, press Track Selected Object for each, and they combine for keying and removal. AirFx warns you if a mask becomes much smaller than your selection.

In testing, a ball passing behind a bar was found again within 3 pixels in all 5 generated clips, with identical flags each time. On each, one frame at the edge of the bar was more than 40 pixels off, and the frames around it are flagged amber or blue. Tracking assumes roughly steady motion while hidden: an object that turns around behind something stays hidden, and you resume it by hand.

On one real iPhone clip (19 s, handheld, a hand moving a camcorder against a wall), the hand, camera screen and camera body each tracked through all 231 frames, with 2 frames flagged. The combined masks held 98.6% of the camera's dark pixels. A small knob, 0.4% of the frame, was lost at 5.8 s and lost again after correcting it, so very small objects that change shape may not hold. That is one clip against a plain background. People, crossings, lookalike objects and busy scenes are still untested on real footage.

**5. Result.** Backgrounds: Transparent, Solid Color, Image / Video, Blur Original. Other key modes: Auto Matte (the model guesses the subject, frame by frame), Green Screen, Blue Screen, Custom Color (colour keys, not AI).

**Transparency, as tested:** Transparent PNG has a real alpha channel. WebM · VP9 keeps alpha when read back in Chrome. MP4 turns transparency black, and the export dialog warns you. WebM · VP8 was not tested. Some video editors ignore WebM alpha, so check yours.

CorridorKey inspired the edge un-mixing. AirFx does not contain its neural keyer.

## AirFx Cleanup: remove and reconstruct

Open **Cleanup** at the top.

1. **Select** an object, person, logo or text with the tools above, or paint it with **Mask Brush**.
2. **Refine**: Mask Expansion grows past soft edges and shadows, Feathering blends just outside the mask.
3. **Reconstruct** with one of four labelled methods:

| Method | Type | Best for | Time on the test PC |
| --- | --- | --- | --- |
| **Local Inpaint** | Local inpainting | Scratches, wires, small specks | Under 1 s |
| **Patch Reconstruction** | Local inpainting | Walls, grass, repeating texture. Multi-scale PatchMatch copying from this image | 2–10 s |
| **AI Reconstruction** | AI-generated reconstruction | Larger holes and structure. LaMa, 88 MB. It reads the surroundings and takes no text prompt | About 18 s on the CPU |
| **Reference Guided** | Reference-guided reconstruction | When another photo shows what belongs there | 3–12 s |

Controls: Texture Continuity, Detail Preservation, Preserve Surroundings and Perspective Consistency (patches may scale, for receding surfaces). **New Attempt** keeps earlier results in a list tied to this image; patch methods differ between attempts, while LaMa gives the same answer for the same crop. **Manual Patch** paints from a source point and is labelled as copying, not reconstruction. Compare with Split in the toolbar, or lower Reconstruction Strength.

**Cancel** stops a patch fill at once. LaMa cannot be interrupted, so Cancel discards its answer and frees the panel straight away, while the model finishes in the background.

**Only the mask changes.** In testing, no pixel changed outside the mask and its feather. If a result changes more than you expected, check the Removal Mask view: a click can select more than the object, and **Smaller** usually fixes that. Measured against a known brick wall, the error inside the hole fell from 65 to 5.4 levels for Patch, 5.9 for LaMa, 5.7–7.3 for Reference and 10.1 for Local, with brick courses continuing through the hole. LaMa fills can look soft at high resolution, because it works on a 512 px crop.

**Video.** Track the object first, then press **Reconstruct Whole Clip**. Frames are aligned, the background hidden in one frame is read from the others, and the median forms one background plate. Only what no frame ever shows gets a spatial fill, once, so the fill does not change between frames. Offline, 854 px at most. It suits rigid backgrounds with a static, panning or zooming camera. Moving backgrounds such as crowds, water or foliage will not reconstruct well, and strong parallax can leave errors.

**Select everything that moves.** An unselected object that moves with the subject bleeds into the plate as a dark smear, because the plate is built from the frames around it. On the real clip above, removing the hand and camera took about 25 s. The wall continued cleanly with 2.4% of the plate filled, leaving a fingertip sliver on some frames, small specks at the edge of the masks, the unselected knob and a faint tonal patch. Mask Expansion or Manual Patch can help with these.

## AirFx Depth: real depth maps

Open **Depth** at the top. The panel always states the source: **No Depth Map Yet**, **AI Model Estimate**, **Loaded Map** or **Procedural, Not AI**. Without a map the image passes through untouched: there is no longer a hidden gradient pretending to be depth.

**Convention:** white = near, black = far. **Invert Depth** swaps it, and the legend follows. Values are relative, not metres.

- **Generate Depth Map** with Depth Anything V2. Input sizes are Fast 392, Standard 518, High 770 and Ultra 1022, but testing found no accuracy gain above Standard. **Regenerate** runs it again. A new map starts focused on the likely subject.
- **Depth Balance** spreads depth evenly, so a big sky does not squeeze everything else. It keeps near nearer than far, and uses one curve per clip, so video does not flicker.
- **Colorized Depth** view and PNG, red near and blue far.
- **Depth Map Guide** teaches depth maps in eight steps on your own image or a sample, using the real controls. Open it with the **?** button or **Depth Map Guide** in the Depth panel. It opens by itself the first time, until you finish it or tick Don't show automatically again.
- **Samples** in the Depth panel load a portrait, flower, architecture or landscape photo. All four are CC0 or public domain: see [public/samples/CREDITS.md](public/samples/CREDITS.md). Their maps are generated by the model every time. None are stored as pictures.
- **Depth Test Lab** runs seven kinds of scene, measures each, and saves a report. Results: [docs/DEPTH_TEST_REPORT.md](docs/DEPTH_TEST_REPORT.md).
- **Run Sample Project** in the Depth Test Lab shows each sample's original, map, overlay and focus effect, and compares the map with `public/samples/baseline.json`. A match under 0.97 is flagged, so a model update that changes results is noticed. After an intended change, press **Save New Baseline** and put the file in `public/samples`.
- **Views:** Original, Depth Map, Side by Side, Overlay, Final.
- **Regions:** Foreground, Middle Ground and Background come from clustering the map. **Main Subject** uses your selection if there is one, so the subject need not be the nearest thing. Otherwise it guesses from the frame centre and says so.
- **Read Depth** shows the value under a click, with **Set as Focus**. Band edges can be moved by hand, and **Highlight Selected Band** shows them.
- **Depth Correction:** Nearer, Farther, Smooth, Near Mask, Far Mask, Depth Eraser, Protect, with undo and redo. Corrections feed every depth effect.
- **Effects driven by the map:** focus distance and range, blur strength, foreground and background blur, bokeh shape, highlight boost, depth glow, depth colour grade, depth displacement, parallax. **Apply To** limits any other step by depth.
- **Video:** **Process Whole Clip** aligns each frame's scale and shift to the previous one, blends along optical flow where frames agree, and normalises once for the whole clip. In testing the overall level moved at most 0.008 between frames. It is not a video-depth model, so large scene changes can still shift values. Depth is computed from the source, not from a Cleanup result.

## Custom Content

Fourteen effects can draw your own content in place of their shape: Blob Tracker, Scatter, Halftone, Shape Halftone, Dots, Stars, Light Particles, Glyph Array, Radial Array, Node Network, Circuit Board, Pointillism, Quadtree Mosaic and Depth Particles. The controls appear under **Custom Content** in the effect's panel. Everything else about the effect stays the same.

| Content | Notes |
| --- | --- |
| Default Shape | The effect's own shape |
| Custom Text | Words, letters or lines, including emoji. Each is one element |
| Custom Typography | Font, weight, letter and line spacing, alignment, wrapping, case, outline, and four presets |
| Built-in Icon | 16 vector icons |
| Uploaded SVG | Cleaned first: scripts, event attributes, embedded HTML and external links are removed. Drawn from the vector at each size, so it stays sharp at 4K |
| Uploaded PNG, Image | Transparency and shape kept. Original colours, tint, mono, silhouette or outline, plus brightness and contrast |
| Custom Vector Shape | Polygon or star, or your own SVG path |

Up to 12 files per effect, used in sequence or at random. Size, width, height, rotation, random rotation, opacity, offset, blend, fill and outline are shared by all of them. Scatter also has random, grid, circular and radial distribution.

**Blob Tracker** follows bright, dark or edgy areas, **motion**, a **target color** or the **nearest subject** from the depth map. Content stays on the same blob as it moves, with Fit To Blob, Follow Motion and Smooth Motion.

Tested on generated moving clips: Target Color and Nearest stayed within 2 px of the object. Motion trails it by about 12 px at this speed, because a frame difference sits halfway between two positions. Two blobs swapping size order did not swap their content.

**Fonts:** load TTF, OTF, WOFF or WOFF2 from the Font control. Fonts are loaded before export, and are saved inside `.airfx` projects and autosave. Presets keep only the font's name, so the panel warns you if that font is not loaded. ASCII Renderer and Text Portrait already take your own characters and words. Text Portrait, Chrome Type, Kinetic Type and Data Bars have the Font control too.

Moiré gained Line Width, Second Layer Frequency and Line Waver. Contour Field adds line thickness, solid, dashed, dotted and heavy-every-fifth strokes, and colour systems.

## AirFx Live

Open **Live** to use your webcam as the source for any effect. Nothing touches the camera until you press **Enable Camera**, and the browser asks first. If access is blocked, the panel says how to allow it. Choose device, front or rear, resolution and frame rate.

- The **Effects** tab has the whole library. The stack and sliders work as usual, live.
- Pause, Restart, Close Camera, Take Snapshot, Record.
- **Record** saves the processed picture, not the raw camera, as MP4 (WebM if H.264 is unavailable), with optional microphone. Frames carry their real time, so it plays at the speed it happened. A frame is skipped if the encoder is busy.
- **Tracking:** add Blob Tracker, set Custom Content, and follow Motion, a colour (Pick Color To Track) or Nearest (Depth).
- **Live Depth** updates the depth map beside the picture for depth effects. On the test PC depth took 0.06 to 0.13 s per map, and range changes slowly so it does not pulse.
- A red **Camera On** light shows while it runs. The camera stops when you close it or leave the workspace.

Live needs localhost or HTTPS. Testing used a simulated camera stream, not a physical webcam.

## Preview Performance

Next to the Preview size, choose a mode. Exports always render every frame at full quality, whatever the mode.

- **Performance:** the preview is at most 720 px. While playing, or while you drag a control on a slow stack, it goes smaller still (down to a quarter) to keep up.
- **Balanced:** full preview size at rest. While playing or dragging, only a slow stack goes smaller (down to three-eighths), then it returns to full size about a quarter of a second after you stop.
- **Quality:** always full size.

Animated stills and microphone reactions leave a fifth of each frame free, so controls stay responsive while they play. Finished steps are kept, so moving a slider on the last step does not re-run earlier ones. Steps that only draw the picture no longer read its pixels back. Live depth leaves the main thread room: at most about 5 maps a second in Performance and 14 in Balanced. The **FPS** button shows preview, source and processing rates, skipped frames, resolution, cost per effect and what is accelerated.

## New In 4.0

Chrome Type, Iridescent Film, Digital Bubbles, Lens Warp, Kinetic Type, Contour Field, Fluid Distortion, Liquid Transition, Quadtree Mosaic, Depth Particles, Data Bars and Pixel Gradient. Research and the reasons for each: [docs/TRENDS_2026.md](docs/TRENDS_2026.md).

**Resolution fixes:** Liquid Chrome, Bevel, Edge, Chromatic Aberration and Holographic measured slopes per pixel, so they changed with resolution and a 4K export would not have matched the preview. Liquid Chrome's difference between 540p and 1080p fell from 91.6 to 6.6 out of 255. Bevel, Edge and Liquid Chrome will look stronger than before at sizes other than 1080 px. Finely patterned effects such as Dithering still differ a little when a large render is scaled down.

## New In 4.4

**Gesture Studio** (new workspace). Paint in the air with both hands in front of the webcam, using MediaPipe hand tracking on this computer.

- **Right hand:** point your index finger to draw, then keep pointing to carry on. Pinch thumb and index and move up or down to change the brush size, like pressing a spray-can cap. Show an open palm to wipe.
- **Left hand:** a fist stops drawing, an open hand resumes, and a V sign moves to the next colour.
- **Brush:** Spray, Soft or Solid, a six-colour palette with a custom colour picker, size, opacity and spray flow.
- **Tracking:** sensitivity, stroke smoothness, drawing speed, mirror view and a left/right swap.
- **Canvas:** undo and redo (also Ctrl+Z / Ctrl+Shift+Z), Clear Canvas, Save PNG with a transparent background, Record Video (MP4) of the stage without the hand outlines, and Use In Effects.
- **Video File:** use a recording of your hands instead of the camera, to rehearse or test.
- **Interactive tutorial:** shown the first time, with Skip and Replay. It covers allowing the camera, loading tracking, positioning both hands, a left/right calibration, then draw, stop and resume, size, erase and colour. Each gesture step waits until the camera actually sees the gesture. It ends with a practice area. Drawing stays off until the camera is allowed and calibration is done.
- **Steadier strokes:** the fingertip is smoothed with a One Euro filter. A gesture must hold for a few frames before it counts. A stroke survives a quarter-second tracking dropout, and a sudden jump starts a new stroke instead of drawing a line across the picture.

**Sound Visualizer, redesigned** as a motion-design composition instead of a music-player display. It still listens to a song file, the video's sound or the microphone.

- **Main forms:** a Spectral Form (an organic outline pushed by each frequency, with symmetry and trailing echo contours), Ridgelines (a scrolling spectrum history in perspective), an XY Oscilloscope with a phosphor trail, Interference Rings, or your own graphic.
- **Fields:** Dot Matrix (a bass wave runs through it on each hit), Line Field or Soft Orbits.
- **Flow Particles:** curl through a field that turns with the music and burst on hits. Dots, streaks or your own content.
- **Kinetic Type:** letters jump, stretch, wave or colour-split with their own frequency band and spread on the bass.
- **Sound and colour:** separate Bass and Treble Response, palettes (Acid, Swiss Paper, Mono, Ember, Ice, Ink And Red, Custom), Color Follows, Glow, background (dark, paper, image, transparent), Image Reacts (pump and slices), grain and vignette. Seven presets.

**Faster preview.** Dragging a control on a slow stack renders a smaller preview while you drag, then the full one. Crayon at 1080 px: 417–517 ms per update at full size, 14–78 ms while dragging. Preview modes are now distinct (see Preview Performance). Export quality is unchanged.

**Removed:** Neo Y2K.

**After Effects plugin:** a feasibility study only, with no plugin code: [docs/AE_PLUGIN_FEASIBILITY.md](docs/AE_PLUGIN_FEASIBILITY.md).

## New In 4.3

**Adjust tab.** Light, tone, colour and detail for the whole image now live in their own tab on the right: Stack | Adjust | Scene | Audio | Presets. It holds Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks, Gamma, Levels, Curves, Temperature, Tint, Saturation, Vibrance, Hue, Sharpness, Clarity, Color Balance, Black & White, Invert and Grain. These run as one pass before or after the stack (your choice), update the preview at once, and never change or reset an effect. On/Off compares, Reset clears, and undo covers it. The single-purpose adjustments (Curves, Channel Mixer, Gradient Map and the rest) moved from the effect library to More Adjustments in this tab, where they still add a step to the stack.

**Threshold: Photocopy / Toner Print mode.** Copy contrast, ink density, toner grain, toner spread, paper texture, copier streaks, dust, and copy-of-a-copy generations. Level sets the black and white balance. Clean Threshold is unchanged.

Eight new effects. Notes on the references: [docs/V43_EFFECTS.md](docs/V43_EFFECTS.md).

- **Night Vision:** amplified light with phosphor colour (green, white, amber, blue or custom), bloom, grain stronger in shadow, sensor sparkle, scanlines, vignette, single or binocular tube, flicker, and infrared variants.
- **Thermal Vision:** a simulated heat camera. Heat comes from nearness (the depth map, or Live depth on the webcam), the selected subject, warm colours or brightness. Iron, rainbow, white hot, black hot, arctic, lava or custom palettes, heat contrast, colour range, glow, edges, sensor resolution, noise and shimmer. The scale reads "Simulated · Relative" and shows no degrees, because a normal camera cannot measure temperature.
- **Invisible / Reveal:** Hide All and Show All buttons with a fade, a mouse brush or spotlight, or your index fingertip through hand tracking. Hidden areas show the background, a colour, frosted blur, an image or transparency, with glass-like distortion and an edge glow. Invisible Subject turns a selected or tracked person see-through. Press Capture Background with the frame empty for the cleanest result.
- **Particle Simulation:** particles from the picture, video movement, an emitter or rain, moved by a flow field, gravity, turbulence, a pull back to the picture, the pointer, hands and sound beats, with optional collisions, trails and custom shapes.
- **Speech Typography:** spoken words fill your silhouette. The body shape comes from body tracking (or a Key selection). Words come from Whisper running on this computer (microphone or a file, timed to playback), from the browser's speech recognition (Chrome sends that audio to Google, and the panel says so), or from typed text. Choose body regions, and the newest word can ride on your fingertip.
- **Audio Shapes & Distortion:** shapes, kinetic type, custom graphics and the picture bend, scale, turn, move and fill with bass, mids, highs, beat, waveform and spectrum. Show it over the picture or webcam, or on a plain colour as a standalone visualizer. Looks: solid, outline, neon or embossed relief.
- **Modulation:** a carrier wave whose amplitude, frequency or phase follows the picture, text or a shape, drawn as lines or used to bend the image.
- **Crayon:** wax crayon on paper: a classic crayon box or the picture's own colours, wax that only catches the paper tooth, strokes in one direction, following edges, cross-hatched or scribbled, firm broken outlines, and light areas left as paper.

## New In 4.2

Six experimental effects, all editable, all in the normal stack, on images and video. Notes on the references and what each one is: [docs/EXPERIMENTAL_EFFECTS.md](docs/EXPERIMENTAL_EFFECTS.md).

- **Dreamy:** bloom, soft blur, light leaks, haze, colour fringing and grading, or Pigment Bloom, a grainy ink that bleeds into paper.
- **Ink Bleed:** measures real movement between video frames and pours ink there. A photo has no movement, so it starts from the picture's edges or tones instead, and the panel says so.
- **Sound Visualizer:** redesigned in 4.4 (see New In 4.4). Choose Audio File, Video Audio or Microphone in its panel. The microphone asks for permission first. It draws real samples and a real spectrum, in preview and in export. With no sound it stays flat, unless you turn on Test Signal, a made-up beat for setting up.
- **Image To Pixel Art:** resolution, pixel shape, palettes, colour reduction, dither, edge preservation, sprite outline and retro presets, plus a coarse pixel cutout that shows the image through a drawn shape.
- **Glitch 2.0:** timed bursts of RGB split, displacement, pixel sort, tearing, mosh, frame damage, noise and scanlines, always on, random, pulsed or on the beat. The original Glitch stays as the simple option.

Video Audio is also available to any audio link: a video's own sound can now drive any slider, in preview and in export.

## New In 4.1

- **Retro Grid and Y2K Interface were removed.** Old projects still open: those two steps are dropped from the stack.
- **AI models are tested before they say Ready.** Each one runs a real inference on a test image after loading. LaMa is the exception: it only opens its session, because a test would take about 18 seconds.
- **AI Models panel.** The **AI** button shows every model's state, with Retry, Reload Model, Clear From Cache, Use CPU Only and an expandable AI Diagnostics section.
- **Fallback.** If WebGPU fails, the model loads on the CPU and the card says so. Only one AI worker runs, and a failed one is never restarted by itself, except one retry while the dev server is still preparing files.
- **YOLOS Tiny now uses the GPU,** taking about a second instead of about eight.
- **Depth Map Guide and samples.** See [AirFx Depth](#airfx-depth-real-depth-maps).

If the cards say the local server is not running, the AirFx window or `npm run dev` was closed while this tab stayed open. Start it again. The page reloads when the server is back, or press Retry.

## Scene Analysis

Open the **Scene** tab. On import AirFx measures brightness, contrast, saturation, edge density, texture and dominant colours, plus camera and subject motion for video. This uses no model. AI analysis runs only on request:

- **Detect People & Objects** (YOLOS Tiny, 26 MB, about 1 s on the GPU; 9 MB and about 8–10 s on the CPU).
- **Classify Scene Type** (CLIP, 147 MB, about 1 s). Compares the image with a fixed list of 13 scene types.
- Depth distribution appears once a depth map exists.

Suggestions change as you add analysis. **Preview** shows one without touching your stack, **Apply** adds it as a normal step, **Reject** removes it. A suggestion is only a starting point: all controls stay open. Without the AI steps, suggestions rely on pixel measurements and can be wrong: a football photo read as architecture until people were detected.

## AI model setup

Nothing to install. Press **Download & Load**: the size is shown first and nothing downloads until you press it. Files come from Hugging Face once, then stay in this browser's cache, one cache per address. Your media is never sent anywhere. The runtime is served from `public/ort`, not a CDN.

| Model | Used for | Licence | Download | Runs on |
| --- | --- | --- | --- | --- |
| [EdgeTAM](https://huggingface.co/onnx-community/EdgeTAM-ONNX) | Selection, tracking | Apache-2.0 | 39 MB | Encoder on GPU, decoder on CPU |
| [YOLOS Tiny](https://huggingface.co/Xenova/yolos-tiny) | Object detection | Apache-2.0 (upstream, this conversion's card does not state one) | 26 MB, or 9 MB without WebGPU | GPU; smaller build on CPU |
| [CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32) | Scene type | MIT | 147 MB | CPU |
| [Whisper Tiny (English)](https://huggingface.co/Xenova/whisper-tiny.en) | Speech to text | MIT | 41 MB | CPU |
| [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) | Hand tracking | Apache-2.0 | 7.5 MB, from Google's model storage | GPU (WebGL); CPU fallback |
| [MediaPipe Pose Landmarker Lite](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) | Body tracking and silhouette | Apache-2.0 | 5.5 MB, from Google's model storage | GPU (WebGL); CPU fallback |
| [LaMa](https://huggingface.co/opencv/inpainting_lama) | AI inpainting | Apache-2.0 (upstream, the model card does not state one) | 88 MB | CPU |
| [ISNet](https://huggingface.co/onnx-community/ISNet-ONNX) | Fine matte, any subject | AGPL-3.0 on its model card | 84 MB, or 42 MB without WebGPU | GPU; smaller build on CPU |
| [MODNet](https://huggingface.co/Xenova/modnet) | Fine matte, people | Apache-2.0 | 6 MB | CPU |
| [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small) | Depth | Apache-2.0 | 47 MB, or 26 MB without WebGPU | GPU; smaller build on CPU |
| Depth Anything V2 Small, lite | Depth | Apache-2.0 | 18 MB, or 26 MB without WebGPU | GPU; CPU fallback |

Every model was checked for correct output, because some return wrong results without any error:

- **MODNet and LaMa stay on the CPU.** On WebGPU their output was visibly broken.
- **EdgeTAM** gave identical masks on GPU and CPU (IoU 1.0).
- **ISNet replaced BiRefNet Lite**, which exceeded the GPU's buffer limit and ran out of memory on the CPU build.
- **RMBG-1.4 is excluded** because its licence is not open.
- SAM 2 and SAM 3 Tracker were considered. EdgeTAM is far smaller, has an open licence and is supported by the bundled library. The library has no video memory, so AirFx's tracker runs on top of single-frame prompts.
- If a GPU rejects a model at load or at run time, AirFx loads it on the CPU and says so.

ISNet's card lists AGPL-3.0. That is fine for personal use, but read the licence before distributing anything built on it.

## Research and audit

- [docs/EFFECT_AUDIT.md](docs/EFFECT_AUDIT.md): every effect with its media, controls and limits, generated from the code by `node scripts/audit-effects.mjs`.
- [docs/SYNKIT_RESEARCH.md](docs/SYNKIT_RESEARCH.md): what could be inspected, and what AirFx has, gained or left out.

## Effects

### Core effects (v0.1)

| Effect | What it does | Parameters |
| --- | --- | --- |
| **Moiré** | Two algorithmic gratings are overlaid like printed transparencies. Image brightness warps their phase, so the picture shows up inside the interference bands. | Pattern type (lines / circles / radial / interference), frequency, pattern scale, angle, rotation, layer offset, image influence, contrast, intensity, blend mode, invert, colour 1/2, original opacity, animate + drift speed (video) |
| **Scatter** | Rebuilds the image from seeded random shapes. Tone decides which points survive and how big they are. The layout is fixed by the seed, so video stays stable from frame to frame. | Density, scatter amount, seed, min/max size, shape (circle / square / triangle), size by brightness, colour mode (original / mono / custom), background, transparent background |
| **Halftone** | Rotated print screen. RGB mode prints C/M/Y screens at offset angles. When inverted it prints additive R/G/B light on black. | Grid spacing, dot size, angle, shape (circle / square / ellipse), contrast, brightness, invert, colour mode (B&W / mono / RGB), ink colour, background, transparent background |
| **Glitch** | Seeded tearing bands, RGB channel separation, corrupted decoder rows, digital noise, CRT scanlines. | Intensity, number of bands, horizontal shift, vertical shift, RGB separation, noise, scanlines, seed, animate (video) |
| **Film Grain** | Hashed cell noise with a mid-tone-weighted response, plus tone and vignette. | Grain amount, grain size, coloured grain, animate noise (video), contrast, brightness, vignette |

### Full library (129 effects)

Every effect, with its controls and limits, is listed in [docs/EFFECT_AUDIT.md](docs/EFFECT_AUDIT.md).

| Category | Effects |
| --- | --- |
| Stacks | Hyper Glitch, Red Data, Pixel Stars, Multi Threshold, Gameboy, Array Riso, Array Airbrush |
| Pattern & Generative | Moiré, Stippling, Dots, Patterns, Cellular Automata, Topo Survey, Knitwear, Glyph Array, Brick Mosaic, Node Network, Circuit Board, Radial Array, Wave Lines, Metaballs, Blob Tracker |
| Distortion & Glitch | Scatter, Distort, Displace, PixDisplace, Datamosh, Pixel Sort, RGB Shift, Glitch, Displacement Map, Liquify, Turbulence, Channel Displacement, JPEG Artifacts, Pixel Crusher |
| Texture & Print | Halftone, Dithering Lab, Dithering, Edge, Bevel, PrintAnimate, Film Grain, Noise, Texture Overlay, Airbrush, Pattern Merge, Liner Pro, Shape Halftone, CMYK Print, Cyanotype, Newspaper Print, Spray Stencil, Torn Paper Collage, Pointillism, Liquid Chrome, Frozen Ice, Cracked Print, Grunge |
| Light & Optical | Stars, Lens Flare, Glow & Bloom, Anamorphic Streaks, Chromatic Aberration, Light Rays, Light Leak, Aurora, Light Particles, Reeded Glass, Water Surface |
| Color & Image Adjustments | Light, Color & Vibrance, Clarity & Dehaze, Levels, Curves, Exposure, Hue / Saturation, Color Balance, Black & White, Photo Filter, Channel Mixer, Color Lookup, Selective Color, Gradient Map, Recolor, Gradients, Duotone, Posterize, Invert, Threshold, Posterized Gradient |
| VHS & Analog | VHS, CRT, Holographic |
| Background Removal | AirFx Key, AirFx Cleanup |
| Depth & Focus | AirFx Depth |
| Typography & ASCII | ASCII Renderer, Text Portrait |
| Animate | Motion Trails, Line Scan, Slide, Stack, Stutter |

**Dithering Lab**: six error-diffusion kernels, Bayer, random, dot and hatch screens, palettes including extraction from the image (median cut).

**ASCII Renderer**: glyph ramps are measured from the rendered font's real ink coverage. It has several character sets, colour modes and your own characters.

**Displacement**: Displacement Map, Liquify, Turbulence and Channel Displacement share one displacement core. JPEG Artifacts runs a real 8×8 DCT, with generations on shifted grids.

**VHS**: multiple editable text elements you can drag on the canvas, with font, size, rotation, spacing, glow, blink and timestamp noise. `{date}`, `{time}` and `{tc}` tokens use the date and time you type, never your computer's clock, and the time can stay fixed or run with playback. Six editable presets: Clean VHS, 1990s Camcorder, Degraded Tape, CRT Playback, Found Footage, Night Recording. It is deterministic, and a still export matched the preview pixel for pixel.

### References and what was built

All of these are independent reimplementations from public descriptions. No proprietary code or assets were used.

| Reference | Status | Built |
| --- | --- | --- |
| Synkit post 1 | Slides viewed | Topo Survey, Airbrush, Knitwear |
| Synkit post 2 | Slide 1 video was black, other slides viewed | Array Riso |
| Synkit post 3 | Viewed | Pattern Merge, Liner Pro, Pixel Crusher, Shape Halftone, CMYK Print. The post mentions vector export, which AirFx does not have. |
| Synkit post 4 | Slide 1 video was black, slides through 5 viewed | Brick Mosaic |
| Synkit post 5 | Slide 1 video was black, 5 of 8 slides viewed, slides 6–8 not viewed | Array Airbrush |
| Studio AAA (Dither Boy, Flareware, Script Slayer) | Only product names and prices were read | Dithering Lab, the optical effects and ASCII Renderer were designed from general technique, not from those products |
| CorridorKey | Project description read | Workflow ideas only, see AirFx Key |

### Older library notes

| Category | Effect | Notes |
| --- | --- | --- |
| Pattern | **Stippling** | Pen-and-ink dots on a jittered grid. Density carries the tone; ink or original colours. |
| | **Dots** | Upright dot-matrix / LED grid with circle, square, diamond, ring or plus marks, and offset rows. |
| | **Patterns** | Tone drawn as lines, crosshatch, waves, zigzag, rings, squares, diamonds or spiral, with optional drift. |
| | **Cellular Automata** | The thresholded image seeds a Life-like grid. Presets (Classic, HighLife, Day & Night, Seeds, Maze, Coral, Anneal) or custom birth/survive bounds; steps or live animation. |
| Distortion | **Distort** | Wave, ripple, swirl, bulge/pinch, grid warp and shear bands; can animate. |
| | **Displace** | Displacement map from fractal noise, luminance, a colour channel or the luminance gradient (refraction look); channel split; can animate. |
| | **Pixel Sort** | Sorts spans inside a brightness range by brightness, hue or saturation; horizontal or vertical; mask preview. |
| Texture | **Edge** | Sobel contours shown as neon, line art, overlay or relief. |
| | **Bevel** | Luminance used as a height field and lit as a lit image, grey emboss, chrome or clay; the light can rotate over time. |
| | **CRT** | Curvature, convergence error, phosphor mask (aperture, slot, dots), scanlines, bloom, vignette, noise, flicker, rolling bar. |
| | **Noise** | Smooth fBm, ridged, turbulence, contours or TV static, with blend modes and colour options. |
| Color | **Recolor** | Gradient maps and palette quantisation (Acid, Sunset, Ocean, Riso, Handheld, Thermal, CMYK, Vapor, or custom), plus hue rotation and cycling. |
| | **Gradients** | Cells (threshold, step size, rect/circle/pill shapes filled with gradients), Mesh (soft colour fields) or Bands. |
| Animate | **Slide** | Image planes orbiting in a looping faux-3D carousel. Settings: planes, plane size, orbit radius, tilt and direction, cycles, duration, curve, step-by-step mode, image tiles or the same image. |
| | **Stack** | A deck of cards with seeded tilts. Each step, the top card swings out and tucks under the deck. Settings: rotation range and seed, X/Y shift, cycles, duration, speed curve, exit direction. |

Plus the earlier effects: Moiré, Halftone, Scatter, RGB Shift, Glitch, Film Grain, Dithering, Duotone, Posterize, Invert and Threshold.

### Animated filters

These move on their own, so you can drop one on a photo and it's already animated.

| Effect | What it does |
| --- | --- |
| **Stutter** | Beat-synced **Repeat**, **Freeze**, **Gate**, **Strobe**, or **Mixed**, so a clip is "edited" to the music without cuts. You set the BPM, a division (1/2 to 1/32), a beat offset to line up with your song, a step pattern such as `x-x-xx-x` (x = fire, - = play normally), the repeat length and the chance that a step fires. Repeat and Freeze need moving footage. Gate and Strobe also work on stills. |
| **PixDisplace** | Blocks of pixels jump sideways, vertically or both, several times a second, with optional smear streaks. |
| **PrintAnimate** | Risograph-style ink plates (Riso 3, Riso Duo, CMY, Fluo, Mono) with "boiling" mis-registration, patchy ink density and paper grain. |
| **Stars** | Twinkling 4-, 6- or 8-ray star glints with glow on the highlights. Colour is white, original or custom; they can spin. |
| **Datamosh** | Codec-style melting. Each frame is the previous one pushed along drifting block motion vectors, refreshed at a keyframe interval. On video it can mosh only the moving areas. It keeps the previous frame, so **press play** to watch it develop. |

### Stacks (one-click looks)

Each stack is two effects layered with tuned settings, with a few simple controls on top. They're also available as effect layers in the Timeline.

| Stack | Built from |
| --- | --- |
| **Hyper Glitch** | PixDisplace + Glitch (intensity, block size, RGB split, speed) |
| **Red Data** | red gradient map + binary ASCII (character size, contrast, characters, red tone) |
| **Pixel Stars** | colour Bayer dither + twinkling Stars (pixel size, star threshold and size, twinkle) |
| **Multi Threshold** | Posterize + 4-colour gradient map (levels, contrast, four colours) |
| **Gameboy** | four-tone dither + the handheld green palette (pixel size, contrast, dither type) |
| **Array Riso** | glyph array + animated riso colours (cell size, coverage, glyph, rate) |
| **Array Airbrush** | glyph array + airbrush (cell size, coverage, glyph, rate) |

When an effect is animated (Slide, Stack, or any effect with Speed, Animate or Spin turned on), a play/pause clock appears for still images too. The loop length follows the effect's *Duration*, or 10 s if it has none.

### Choosing what goes on the cards (Slide / Stack)

Set **Card Content** to one of:
- **Image Tiles**: the main image cut into a grid.
- **Same Image**: the whole main image on every card.
- **My Images**: your own pictures.

With My Images you can:
- press **+ Add** to pick images from your computer;
- reorder them with ‹ ›, or remove one with ×;
- click any image already in the bin to add it;
- choose whether to also include the main media (**Include Main Media**).

Cards cycle through the list in order.

## Timeline mode

Switch **Effects ↔ Timeline** at the top. Timeline mode is a simple, After Effects-style composition editor for mixed-media edits.

- **Layers**: media (photos, transparent PNG cut-outs, videos), text, shapes and scribbles, and **effect layers**. An effect layer works like an adjustment layer: it applies any effect to everything below it, so you can stack several to combine looks. Layers stack in the same order as the timeline list.
- **Adding**: use the left panel, drop files on the canvas, or press `Ctrl/Cmd + O`.
  - Text presets: Headline, Subtitle, Caption, Tag, Handwritten.
  - Shapes: box, ellipse, star, burst, line, arrow, underline, scribble circle, scribble fill.
  - **+ Studio Media** copies the file that's open in the Effects workspace.
- **Canvas**:
  - click a layer to select it, then drag it to move;
  - drag a corner to scale;
  - drag the top handle to rotate (hold Shift to snap to 15°).
- **Timeline**:
  - drag a clip to move it, or drag its edges to trim; clips snap to the playhead and to other clip edges;
  - click or drag the ruler to scrub;
  - ▲▼ change stacking order, ● hides a layer, and double-clicking a name renames it;
  - when a song is loaded, its waveform shows under the tracks.
- **Animation** (in the inspector):
  - one-click **In/Out** presets: Fade, Pop, Slide, Zoom, Spin, Wipe, Typewriter. A wipe on a line or scribble draws it on.
  - **Boil** adds a stop-motion wobble. Combined with a shape's **Hand-Drawn** setting, lines re-draw every few frames like animated scribbles.
  - **Keyframes**: press ◆ next to Position, Scale, Rotation or Opacity. After that, any change made at the playhead (dragging on the canvas or moving a slider) sets a keyframe there. Keyframes appear as ◆ on the clip; click one to jump to it.
  - Blend modes: Normal, Multiply, Screen, Overlay, Difference, Add.
- **Media options**: a **Sticker Outline** that follows the edges of transparent PNGs, a drop shadow, rounded corners, and a start offset and loop setting for video.
- **Audio**: load a song in the left panel. The timeline follows the song from time 0. Any slider with ∿ can follow the beat, including transform values.
- **Export**: a real-time WebM or MP4 render with the song as soundtrack, at a chosen resolution and frame rate, or **Save Current Frame as PNG** at full resolution.
- **Shortcuts**:
  - `Space` play/pause, `Home` jump to start;
  - `←/→` move one frame (`Shift` for 1 s);
  - `Del` delete, `Ctrl/Cmd + D` duplicate;
  - `Ctrl/Cmd + Z / Shift + Z` undo/redo, `Ctrl/Cmd + S` export;
  - `Esc` deselects the layer and shows the composition settings: frame presets 16:9, 9:16, 1:1 and 4:5, duration (with "Match song length"), and background.

## Saving projects

- **Autosave**: your work saves automatically in this browser (IndexedDB), about 1.5 s after each change. The top bar shows "● Saved hh:mm". Next time you open AirFx, a banner offers to **Restore** that session or **Start Fresh**.
- **Project → Save Project** (`Ctrl/Cmd + Shift + S`) downloads a single `.airfx` file. It contains:
  - the Effects workspace image or video;
  - the whole effect stack, with parameters, Mix, Blend and audio links;
  - the whole timeline, including layers, keyframes and animation settings;
  - the asset bin (card images, timeline media, uploaded graphics);
  - uploaded fonts;
  - the song.
- **Project → Open Project…** loads a `.airfx` file. It replaces the current project, so you're asked first.
- The `.airfx` format is a small JSON header followed by the raw media bytes (no base64), so the file is about the size of the media inside it. Songs loaded from a URL are stored as the URL only.
- Everything stays local. Autosave lives in your browser profile, and clearing site data removes it. Save a project file to keep work permanently or move it to another computer.
- Older one-effect projects and `.airffect` files still open, and become a one-step stack.
- **Selections, tracks, mattes, depth maps, reconstructions and brush strokes are not saved in projects.** Re-run them after reopening. Their settings and each step's Apply To choice are saved.

## Audio-reactive mode

You can make any photo or video react to a song.

1. Open the **Audio** tab in the right panel and press **Load Song** (MP3, WAV, OGG, M4A, FLAC). You can also drop an audio file on the canvas, paste a direct audio URL, or use the **Microphone**.
2. Press **Auto-Map** for suggested links, or click **∿** next to any slider in Parameters. Pick a band (Level, Bass, Mid, High or Beat) and a depth from −100% to +100% of that slider's range.
3. Press play (Space). The song plays together with your media, and the preview reacts live. The meters show what the analyser hears; adjust *Sensitivity* and *Smoothing* to taste.
4. **Export → Animation/Video** records the result with the song as the soundtrack. Length can follow the song, the video (it loops if the song is longer) or a custom value.

How the analysis works: a 2048-point FFT is split into bass (25–160 Hz), mid (160–2200 Hz) and treble (2.2–12 kHz). Each band is auto-normalised to its recent peak, so quiet and loud tracks both use the full range. Each band then gets a fast-attack / slow-release envelope. *Beat* is a short pulse that fires when bass energy jumps above its running average.

**About links:** links from YouTube, Spotify, SoundCloud, Instagram, TikTok and similar sites can't be used. These services don't expose a raw audio file to the browser, and their streams are protected. Download a track you have the rights to as an audio file and load that instead. Direct links to audio files work if the server allows cross-origin access.

## Export

Press **Export** (`Ctrl/Cmd + S`). Exports use the same effect definitions as the preview but render fresh at the export size. A 4K export is not a stretched preview: spacing, grain and type are recalculated for 3840 × 2160.

**Images:** PNG, JPEG or WebP, with quality control. Choose Original, 1080p, 2K, 4K UHD or Custom, up to 8192 px per side. Sizes fit the source's shape, so a 4:3 picture at 4K becomes 2880 × 2160 and a portrait one 2160 × 3840. Unlocking Aspect stretches the picture. The dialog says whether a size is native, downscaled or upscaled. An upscale renders effects and type natively, but adds no new detail to the source.

**Video** is rendered offline, one frame at a time, then encoded with WebCodecs. The clip does not play during export, so a slow effect makes the export take longer but cannot drop frames. Duration and frame rate come out exactly as chosen, and the saved file is read back and reported.

| Setting | Options |
| --- | --- |
| Resolution | Original, 1080p, 2K, 4K UHD, Custom |
| Frame rate | Source, 24, 25, 30, 50, 60, Custom |
| Codec | H.264, HEVC, AV1 in MP4; VP9, AV1 in WebM. Only those your browser offers at that size |
| Quality | Draft, Standard, High (default), Maximum, Custom |
| Audio | Original, song or silent, at 128 to 320 kbps |

High targets 16 Mbps at 1080p30, 30 at 1440p and 60 at 4K, and more at higher frame rates. Bitrate is variable, so simple footage can come out well under the target and that is not a fault: it needs fewer bits. The dialog shows the most it should reach.

Progress shows the frame, frames per second and time left, with Cancel. Timeline export uses the same path. Audio links are worked out offline from the song, using the same response as the live analyser.

**Transparency:** WebM · VP9 keeps it. In testing a transparent Halftone read back 54% transparent. H.264, HEVC and MP4 AV1 turn it black, and the dialog warns you. PNG and WebP keep it.

### Why it changed

Exports used to record the canvas with MediaRecorder while the video played in real time. An effect taking 200 ms a frame gave 5 fps, whatever was selected. File sizes were small because the bitrate defaulted to 8 Mbps, the H.264 profile was Baseline 3.1 (made for about 720p), and video could not go above the source size.

### Benchmarks

Your real clip: iPhone HEVC, 1920 × 1080, 60 fps. Stack: Halftone + Scatter + Film Grain unless stated. Read back from the saved file.

| Export | Frames | Frame rate in file | Length | Bitrate | Audio | Render speed |
| --- | --- | --- | --- | --- | --- | --- |
| **Old recorder,** 1080p30, 3 s | **11** | **3.68** | 2.99 s | 2.6 Mbps | None | Real time |
| **New,** 1080p30, 3 s | **90** | **30.00** | 3.01 s | 17.8 Mbps | AAC | 7.3 frames/s |
| New, whole clip at source rate, Halftone only, production build | 1157 | 59.95 | 19.31 s | 24.9 Mbps, 57 MB | AAC | 25 frames/s, 46 s |
| New, 4K30 H.264, 1 s | 30 | 30.00 | 1.00 s | 71.7 Mbps | | 2.45 frames/s |
| New, 1080p60, no effects, 2 s | 120 | 60.00 | 2.01 s | 29.5 Mbps | AAC | 53.8 frames/s |
| New, Timeline 1080p30, 10 s | 300 | 30.00 | 10.00 s | 0.2 Mbps, one text layer | | 51 frames/s |

Audio sync, measured on a clip with a click and a flash at the same moment: 12 ms apart in the export. One frame at 30 fps is 33 ms.

Preview of the same clip with Holographic, the heavy case: Quality 7 fps at 1080 × 608, Balanced 19 fps at about 53% size, Performance 29 fps at about 37% size.

## Architecture

```
src/
  ai/                 models.ts (model list), worker.ts (inference off the UI thread),
                      client.ts (load/infer, MapTrack, EditPlane, processClip),
                      selection.ts (objects, clicks, brushes), track.ts (video tracker),
                      motion.ts (Lucas-Kanade points, optical flow)
  cleanup/            engine.ts (methods, video plate), inpaint.ts (fast marching, PatchMatch),
                      fillWorker.ts
  scene/analyze.ts    measurements and rule-based suggestions
  presets/store.ts    localStorage preset library
  effects/            pure effect definitions (no React)
    types.ts          EffectDefinition, ParamDef, StackItem, sanitizeParams, defaults
    registry.ts       the 129 effects and category order
    adjust/           core.ts (curves, LUT, HSL) and adjustments.ts
    ditherLab.ts optical.ts displacement.ts referenceFx.ts airKey.ts airCleanup.ts
    airDepth.ts generative.ts printSurface.ts
    moire.ts scatter.ts halftone.ts glitch.ts filmGrain.ts colorEffects.ts
    stippling.ts dots.ts patterns.ts ascii.ts cellular.ts distort.ts displace.ts
    pixelSort.ts edge.ts bevel.ts crt.ts noise.ts recolor.ts gradients.ts
    slide.ts stack.ts cards.ts (shared card drawing / easing)
  engine/
    FrameRenderer.ts  scales source → work buffer → effect.render → target canvas
    audio.ts          AudioReactor (file / URL / mic) + BandAnalyser (bands, beat)
  hooks/
    useMedia.ts           file import, decoding, object-URL lifecycle
    useEffectState.ts     effect stack, per-step params, undo/redo history
    useEffectRenderer.ts  preview scheduling (rAF-coalesced; per video frame while playing)
    useVideoState.ts      video element playback state
    useTransport.ts       one play/seek clock for video, song, or animated stills
    useAudio.ts           AudioReactor ↔ React state
    useKeyboardShortcuts.ts
  timeline/
    model.ts          Composition / Layer types, layer schemas, presets, factories
    animate.ts        keyframes, in/out presets, boil → evaluated layer state
    draw.ts           text, hand-drawn shapes (draw-on), media + sticker outline
    compositor.ts     CompPlayer: renders layers, runs effect layers, syncs video
    exportComp.ts     real-time composition export + PNG frame
    useComposition.ts / useCompPlayback.ts   undo history, clock (follows the song)
    ui/               TimelineMode, TimelineStage, TimelinePanel, LayerInspector,
                      TimelineLibrary, CompExportDialog
  engine/assets.ts    shared asset bin (card images, timeline media)
  project/            .airfx file format, IndexedDB autosave, useProject, Project menu
  components/         TopBar, EffectSidebar, PreviewCanvas, ParameterPanel, PropsEditor,
                      BottomStatusBar, MediaImporter, ExportDialog, ConfirmDialog, controls,
                      StackPanel, PresetPanel, Workspaces, WorkspacePanels (Key, Cleanup, Depth),
                      SelectionOverlay, ScenePanel, EffectThumb, editors (Curves,
                      Gradient, LUT, Selective Color, VHS text)
  utils/
    imageProcessing.ts  colour/blend/PRNG/hash helpers
    videoProcessing.ts  video loading, seeking, per-frame callbacks
    exportUtils.ts      PNG, JPEG and WebP export
```

### Adding an effect

1. Create `src/effects/myEffect.ts` that exports an `EffectDefinition`: an `id`, `name`, `category`, `params` (with defaults and ranges), and `render({ src, ctx, width, height, params, unit, time, frame })`.
2. Add it to `EFFECTS` in `registry.ts`.

The parameter panel, undo/redo, reset, preview and export pick it up automatically. Values are clamped by `sanitizeParams` before they reach `render`, so invalid input can't break the pipeline.

## Performance notes

- The preview renders at a capped resolution (Toolbar → Preview: Draft 640 / Standard 1080 / High 1600 / Max 2400 px). Export resolution is independent of this setting.
- Stills re-render at most once per animation frame while you drag a slider. Videos render once per decoded frame while playing, and only on change or seek while paused.
- Object URLs, video decoders, frame callbacks and work buffers are released when media is replaced, the project is cleared, or an export finishes or is cancelled.

## Known limitations

- **Canvas 2D only.** The effects are CPU pixel loops. They are interactive at preview sizes, but Scatter and Moiré at Max preview on 4K video will drop frames. A WebGL path is the natural next step for those two.
- **AI quality.** Models work on a downscaled frame and the result is scaled up. Fine hair can soften, and MODNet is weak on objects. EdgeTAM selections are made at 640 px and refined against the image.
- **AI on video** is analysed at the chosen rate, not always every frame. Between analysed frames the nearest result is held, so fast motion needs a higher rate. Tracking and removal were tested on generated clips and one real clip against a plain wall, not on people or busy scenes. See [AirFx Cleanup](#airfx-cleanup-remove-and-reconstruct).
- **Depth comes from the source.** It does not see a Cleanup result, so a removed object can still affect depth effects.
- **Scene suggestions are rules** written for a small set of scene types. They are starting points, not a judgement of the image.
- **Brush edits on video:** in tracked selections they belong to one frame, so fix that frame and press Resume From Here. Depth correction paints apply to the whole clip.
- **Background video** in Key is synced from the preview clock, so it may drift in long clips.
- **No vector export.** Everything exports as pixels or video.
- **Key, Cleanup and Depth in the Timeline** can be added as effect layers, but they need a result made in their workspace.
- **Heavy print effects were optimised** (CMYK Print, Frozen Ice, Cracked Print, Holographic) along with the depth blur. The picture is unchanged, within 2 levels out of 255. Allowing for timing noise between runs the gain is an estimated 30 to 50%, not a clean measurement.
- **Effects run on the main thread, on the CPU.** At 1080p the median effect takes about 60 ms and about 44 of the 116 measured take over 100 ms, so heavy stacks do not reach 30 fps in preview at full size. Balanced and Performance lower the preview size while playing to keep it moving. Export is unaffected: it simply takes longer. Moving effects to workers or WebGL is the natural next step. Only some use a worker today (AI models and reconstruction).
- **Slow exports:** every frame is rendered, so a heavy 4K stack can take many times the clip length. The stack in the benchmark ran at 2.45 frames/s at 4K.
- **WebCodecs is required for video export,** so use a recent Chrome or Edge. Firefox and Safari were not tested.
- **`canEncode` can be optimistic.** HEVC was offered at 4K60 here, then refused by the hardware encoder. AirFx then tells you and suggests H.264.
- **MP4 export** depends on browser support (recent Chrome and Edge have it; Firefox does not). The export system is modular, so an encoder such as WebCodecs + an MP4 muxer can be added in `exportUtils.ts`.
- Codec support for import is whatever your browser decodes. HEVC and ProRes usually won't load, and the app shows an error instead.
- Undo/redo covers the stack and its parameters, not media imports. Brush edits have their own undo.
- Very large videos may not fit in the browser's autosave storage. If that happens the top bar shows "Autosave failed"; use Project → Save Project instead.
- Undo history is not saved with a project.
- In the Timeline, video layers play muted. The soundtrack is the loaded song.
- Effect layers run on the CPU at preview resolution while you edit. Several heavy effect layers (Scatter, Moiré, Displace) at 1080p will lower the preview frame rate, and an export may then repeat frames.
- Datamosh, Stutter, Ink Bleed, Sound Visualizer particles and the Glitch 2.0 melt remember earlier frames, so they develop during playback and export. A paused frame shows only part of the effect, and two Datamosh layers in one timeline share that memory.
- **Hand and body tracking** were tested on video and photos, not on a live webcam, because the test PC has no camera. They run on the same frames the webcam gives.
- **Browser Speech** in Chrome sends audio to Google. Whisper keeps it on this computer but waits for a pause, so words appear a phrase at a time. Whisper Tiny knows English only.
- **Interactive effects** (Reveal painting, pointer forces) react in the preview. An export replays the result as it stands, not your mouse strokes over time.
- Microphone input works in the preview only. To export an audio-reactive video, load a song file or use Video Audio. An export of Sound Visualizer with the microphone as its source draws silence.
- Slide and Stack draw cards with Canvas 2D, which can only do flat (affine) transforms. Their 3D look comes from depth scaling, horizontal squash and depth sorting, not true perspective.
