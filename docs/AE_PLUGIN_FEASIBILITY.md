# AirFx For After Effects: Feasibility Study

Research only. No plugin code has been written. Checked 10 November 2026.

## Where After Effects stands today

- **Current version:** After Effects 26.5 (September 2026). 26.0 added native Windows on ARM.
- **Panels (UI inside AE):** still **CEP**, an embedded Chromium with Node.js, talking to AE through ExtendScript.
- **UXP:** Adobe's September 2026 roadmap targets a UXP public beta for After Effects "by November 2026". I found no sign it has shipped yet. For After Effects, CEP is guaranteed until December 2028, when it becomes off by default, and it is removed in December 2029. ExtendScript is not affected by the transition.
- **Effects (pixels on a layer):** only the **C++ Effects SDK** can add a real effect to a layer, with keyframable parameters in the Effect Controls panel. SmartFX gives 32-bit float. The GPU path uses CUDA, Metal or OpenCL on Windows and Mac. Panels cannot render pixels into a layer.

Mister Horse Animation Composer works the same way: a browser-style panel for browsing, previews and presets, plus native code and scripting that build the result in the comp.

## Recommended architecture

Three parts, sharing one effect library:

1. **AirFx Panel (CEP now, ready to move to UXP).** It is web code, so the existing React interface, thumbnails, search, categories and presets can be reused. It applies effects through ExtendScript: it adds the effect to the selected layers, sets parameters, and imports assets. Build the panel's UI so it does not depend on CEP-only features. The move to UXP is then a shell change.
2. **AirFx Native Effect (C++ `.aex`).** This is one effect plugin, "AirFx", with a menu of effects and real AE parameters. It renders inside AE, at full precision, on every frame of the comp. This is where the effects become editable AE controls.
3. **AirFx Engine Bridge (optional, later).** The local AirFx app runs as a small service on localhost. The panel sends it a frame or clip, and it returns a rendered image sequence or maps (depth, matte, tracking) that AE imports. This is how AI and webcam features reach AE without rewriting them.

## Can the browser engine be reused?

- **Interface, library, thumbnails, presets: yes.** These are web code, which CEP runs directly.
- **Effect maths: partly.** AirFx effects are TypeScript on Canvas 2D. A native AE effect cannot run JavaScript per frame at render quality and speed. Each effect has to be rewritten in C++ or GPU shaders. The TypeScript serves as the exact reference, so preview and AE can be compared pixel against pixel.
- **Rendering through the bridge: yes, for any effect.** The local engine renders frames exactly as AirFx does today and AE imports the result. This works for all of AirFx, but the result is not live in the timeline.

## What can work directly inside After Effects

As a native effect with AE controls, keyframes, expressions and 32-bit:

- **Colour and tone:** the Adjust tab, Threshold and Photocopy, Duotone, Gradient Map.
- **Stylise:** halftone, dither and pixel art, ASCII and glyph grids, CRT, VHS and scanlines, grain.
- **Distort:** displacement, waves and modulation, chromatic aberration, glitch slices, pixel sort, mirror and kaleidoscope.
- **Light:** glow, bloom, anamorphic streaks, light leaks, night vision, thermal (from luminance or a depth layer).
- **Texture:** crayon, ink and print textures, paper, moiré.

That is roughly 70–80% of the library.

**Audio-reactive effects work without a live microphone.** Sound Visualizer, Audio Shapes and audio-linked parameters can be driven by AE's own "Convert Audio to Keyframes", or by reading an audio layer during render through the SDK's audio checkout.

**Inside the panel:** browse, search, categories, previews (pre-rendered clips), apply to selected layers, parameters, saved presets, and import of shapes, SVG, PNG and fonts as AE assets.

## What needs the external AirFx engine

- **AI:** depth maps, Key / selection mattes, Cleanup inpainting, and speech-to-text. The models are about 40–400 MB of ONNX running in the browser. Native ports through ONNX Runtime C++ are possible, but they are a project of their own. Through the bridge they work now, and the maps come back as image sequences that AirFx effects in AE can read as layers.
- **Hand and body tracking:** MediaPipe on recorded footage, returned as tracking data. AE null layers or keyframes can be written from it by script.
- **Stateful simulations:** Particle Simulation, Ink Bleed, Datamosh, Motion Trails. AE renders frames out of order and in parallel, so effects that build on earlier frames must re-simulate from the start or be pre-rendered. The bridge renders them once, in order.

## What is not practical

- **Live webcam inside AE.** AE is not a live tool; this stays in AirFx Live and Gesture Studio.
- **Live microphone during AE playback.** Pre-converted audio is the AE way.
- **Gesture Studio inside AE.** Instead, record in AirFx, then import the video or PNG.
- **Every effect as fully native from day one.** Porting about 130 effects is the bulk of the work. The order should follow what users actually use.

## Performance limits

- **Native C++ and GPU effects:** as fast as built-in AE effects, and multi-frame rendering safe if written statelessly.
- **The panel:** AE throttles CEP panels, so previews must be pre-rendered clips, not live renders.
- **The bridge:** round trips cost seconds per clip. It suits "render and import", not scrubbing.
- **AI on 4K:** the same limits as in the browser today. GPU inference in the engine helps.

## Install and updates on Windows

- **Panel and plugin:** signed ZXP (CEP) or CCX (UXP) packages, installed through Adobe's installer, the Creative Cloud Marketplace or aescripts' manager.
- **Native effect:** an `.aex` copied to `C:\Program Files\Adobe\Common\Plug-ins\7.0\MediaCore\AirFx\`, shared by AE and Premiere. One Windows installer (MSIX or Inno Setup) can place both and run the engine as a background app.
- **Updates:** the panel checks a version file and offers the download. The native plugin can't be updated while AE is running, so updates apply on restart.

## Difficulty and stages

| Stage | What | Difficulty |
| --- | --- | --- |
| 1. Prototype | A CEP panel listing AirFx effects with search and thumbnails. One native C++ effect (for example Halftone or Threshold/Photocopy) with real AE parameters. "Apply to selected layers" from the panel. | Medium |
| 2. Core library | Port the 20 most used effects to C++/GPU. Presets. Asset import. Windows installer. | High |
| 3. Bridge | The local AirFx engine as a service. Depth, matte and tracking round trips. Stateful effects rendered and imported. | Medium–High |
| 4. Breadth | The remaining portable effects. Mac build. A UXP shell once AE's UXP is stable. | High (long) |
| 5. Polish | Marketplace packaging, licensing, auto-update. | Medium |

## Recommended first prototype

A CEP panel built from the existing AirFx interface, showing the library with search, categories and thumbnails. Pressing Apply adds a native **AirFx Halftone** effect to the selected layers through ExtendScript. That effect is C++ with GPU, has the same parameters as AirFx and is keyframable in Effect Controls. A side-by-side frame comparison with the AirFx web render proves the port matches.

This tests all three risky parts at once: the panel, the AE scripting, and a native effect matching AirFx.

## Sources

- [Adobe Developer Blog: UXP comes to the flagship applications (September 2026)](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications)
- [CG Channel: After Effects 26.5](https://www.cgchannel.com/?p=178609), [After Effects 26.0](https://www.cgchannel.com/2026/01/adobe-releases-after-effects-26-0-with-native-substance-support/)
- [After Effects C++ SDK Guide: SmartFX](https://ae-plugins.docsforadobe.dev/smartfx/smartfx.html), [GPU build instructions](https://ae-plugins.docsforadobe.dev/intro/gpu-build-instructions/)
- [UXP status note (April 2026)](https://github.com/pushREC/after-effects-sdk-kb/blob/main/scripting/UXP-STATUS-NOTE.md), [aescripts author wiki: UXP plugins](https://aescripts-or-author-wiki.gitbook.io/author-wiki/technical-guidelines/uxp-plugins)
- [Animation Composer](https://misterhorse.com/animation-composer)
