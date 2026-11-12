# AirFx Depth Test Report

Model: Depth Anything V2 Small (fp16, WebGPU), input 518, AirFx default settings. Run from the Depth Test Lab, which regenerates this table with **Save Report**. Scores are for the map the app actually shows, after balance and edge refinement.

| Scene | Map | Time | Near − Far | Bits | Truth rank | Edge fit | Focus | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Portrait | 548×342 | 0.61 s, first run | 0.37 | 7.7 | – | 100% | 4.0× | Pass |
| Close-up object | 512×512 | 0.13 s | 0.92 | 7.7 | – | 83% | 6.3× | Pass |
| Natural object (Aloe) | 1024×887 | 0.13 s | 0.73 | 7.7 | **0.888** | 98% | 6.1× | Pass |
| Architecture | 868×600 | 0.17 s | 0.53 | 7.7 | – | 100% | 5.4× | Pass |
| Landscape | 1024×836 | 0.12 s | 0.28 | 7.2 | – | 91% | 6.1× | Pass |
| Complex scene | 512×480 | 0.07 s | 0.38 | 7.9 | – | 79% | 3.4× | Pass |
| Synthetic | 960×640 | 0.13 s | 0.66 | 7.7 | **0.981** | 72% | 6.1× | Pass |

- **Near − Far:** depth of a known near area minus a known far one, on the 0 to 1 scale.
- **Bits:** depth levels in use, out of 8, leaving out the largest flat area such as sky.
- **Truth rank:** Spearman rank correlation with real depth. Only two scenes have true depth: Aloe (measured, Middlebury stereo) and Synthetic (exact).
- **Edge fit:** share of the strongest depth steps within two pixels of a visible edge.
- **Focus:** detail kept in the near area ÷ detail kept in the far area, with AirFx Depth focused on the near area. Measured on a noise image through the real effect, because flat sky has no detail to lose.

Passing means thresholds were met: Near − Far ≥ 0.15, spread ≥ 0.2, bits ≥ 5, truth rank ≥ 0.8, focus ≥ 1.5×. It does not mean the map is correct everywhere.

## Model comparison

Aloe and Synthetic rank correlation, default settings.

| Model | Download | Aloe | Synthetic | Decision |
| --- | --- | --- | --- | --- |
| V2 Small, input 392 | 47 MB | 0.882 | 0.975 | Fast option |
| **V2 Small, input 518** | 47 MB | **0.888** | **0.981** | **Default** |
| V2 Small, input 770 | 47 MB | 0.882 | 0.981 | No gain |
| V2 Small, input 1022 | 47 MB | 0.886 | 0.978 | No gain, slower |
| V2 Small lite, input 518 | 18 MB | 0.898 | 0.958 | Good small option, weaker on Synthetic |
| V1 Small, input 518 | 50 MB | 0.816 | 0.946 | Kept for comparison only |

Higher input size did not improve accuracy on these scenes. It is not presented as more accurate. Larger V2 models are not offered because their licence is non-commercial.

## What was wrong, and what changed

The model was sound. The faults were around it.

| Problem | Evidence | Fix |
| --- | --- | --- |
| Default focus missed most subjects | Fixed at 0.75, portrait subject at 0.54, so the first result blurred everything | A new map now focuses on the likely subject |
| Big skies and walls squeezed everything else | 58% of Landscape was one value | Depth Balance, one curve per still or clip, order preserved (truth rank unchanged) |
| Focus band too narrow for deep subjects | Portrait focus 1.8×, widened band 4.0× | Default Focus Range 0.12 → 0.24. Complex fell from 6.7× to 3.4× and still passes |
| Depth-scoped steps ignored brush edits | Code read the raw map | All depth readers use the edited map |
| Click-to-focus discarded the preview's map | One-entry cache | Three entries, so sizes no longer evict each other |
| No colour view | | Colorized Depth view and PNG |

## Test mistakes found and corrected

Recorded because they changed the results, and the fix was to the test, not the scoring.

- Building: the far box sat on a tree that really is near the camera. Moved.
- `home.jpg` is a tower against sky, not a landscape. Replaced with a public-domain Yosemite photograph, cropped to remove the mount around it.
- Aloe: the near box held two surfaces at 0.35 and 0.92, so its average was a depth where nothing exists. Moved onto one surface, chosen from the depth data.
- Synthetic: the far box was plain sky, so a detail-based focus test could not work. Focus now uses a noise probe on every scene.
- The bits score was fooled by large flat sky. It now leaves out the largest flat area.

## Known inaccuracies

- Depth is relative, not metres.
- Only two scenes have true depth, and Aloe is one indoor object. The others show plausibility, not accuracy.
- Edge fit is lowest on Synthetic (72%) and Complex (79%): soft transitions between objects, and depth steps that do not line up with colour edges.
- Fine structures blur together. Aloe's truth rank of 0.888 includes errors along thin leaves.
- Sky is one flat value, so it cannot be split into layers.
- Six scenes cannot represent everything. Mirrors, glass and night scenes were not tested.

## Scene sources

- Portrait, object, architecture, complex: OpenCV sample data (`messi5.jpg`, `apple.jpg`, `building.jpg`, `fruits.jpg`). The repository is Apache-2.0, but the rights of individual photos are unclear, so they are fetched for testing and not included in AirFx.
- Natural object: Middlebury Stereo 2006 "Aloe", via OpenCV sample data. Research dataset.
- Landscape: Brian Grogan, Historic American Engineering Record, Library of Congress, via Wikimedia Commons. Public domain.
- Synthetic: drawn by AirFx.
