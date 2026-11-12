# 4.3 Effects

All eight are original implementations. The references were read from Instagram's public embed pages, without signing in. None of them was copied.

| Effect | Reference | What could be seen | What it shaped |
| --- | --- | --- | --- |
| Night Vision | YouTube, "How to do a NIGHT VISION Effect + Lightroom Preset" | Title only from the page. | Built from how image intensifiers behave: saturating gain, phosphor colour, bloom, shadow grain, tube vignette. |
| Thermal Vision | satir.com, fever detection | The page describes thermal images in general and names no palettes or overlays. | Common thermal palettes. A relative scale marked simulated, with no temperatures. |
| Invisible / Reveal | wa8.hu reel | Cover frame: a webcam sketch where a person is semi-transparent, with the room showing through and a refracting edge. | Invisible Subject, glass distortion, edge glow, Capture Background. |
| Particle Simulation | bytec.hq reel | Cover frame: an image breaking into white dust particles with streaks on dark blue. | Dissolve, streak particles, trails, the Dust Dissolve preset. |
| Speech Typography | sashadynx reel | Cover frame: "a silhouette made of what is being said live", small white words forming a body on black. | Default look: small type in the silhouette on black. |
| Audio Shapes & Distortion | rivmccall reel | Cover frame: a grey embossed relief of symmetric looping lines. | Embossed Relief look and the Relief Ornament preset. |
| Modulation | Reddit r/AfterEffects | Could not be opened: Reddit refuses both this tool and the built-in browser. A screenshot or recording would help. | Built from the brief, as amplitude, frequency and phase modulation of a carrier. |
| Crayon | synkitnet, slide 3 | A lily in orange, pink and green wax on white paper, with speckled colour and darker, broken outlines in each colour's family. | Classic crayon box, speckled two-crayon mix, wax on paper tooth, broken outlines, light areas left as paper. |

## Not duplicates

| New | Nearest existing | Why it is separate |
| --- | --- | --- |
| Night Vision | Film Grain, Glow & Bloom, VHS | A sensor model with amplification, phosphor and tube in one effect. |
| Thermal Vision | Gradient Map | Heat comes from depth, a subject or warmth, not only brightness, and it adds glow, edges and sensor blocks. |
| Particle Simulation | Light Particles, Scatter | A real simulation with forces, interaction and collisions. |
| Audio Shapes | Sound Visualizer | That draws the signal. This deforms shapes, type and the picture with it. |
| Modulation | Wave Lines | Real AM, FM and PM of a chosen waveform, from text and shapes too, and image bending. |
| Crayon | Airbrush, Pointillism | Wax on paper tooth with a crayon box and outlines. |

## What needs a model

- **Body and hand tracking** use MediaPipe Pose Landmarker Lite and Hand Landmarker, downloaded from Google's model storage when you press their Load button. They then stay in this browser. MediaPipe's runtime ships with the app, in /mediapipe.
- **Speech Typography** uses Whisper Tiny (English) through the existing AI worker. Browser Speech is optional and online.
- **Thermal's nearness** uses the depth map from the Depth workspace, or Live depth on the webcam. Without one it guesses from position and brightness, and says so on screen.
