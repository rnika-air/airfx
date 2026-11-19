# ASCII Magic coverage checklist

Research date: 19 November 2026. Compared against AirFx v5.4.1 plus the unreleased work on main.

## How this was researched

- Read in full: ascii-magic.com/docs/styles, /docs/effects, /docs/free-vs-pro and /docs/generative, plus the /styles page (one description per tile).
- Seen: the published thumbnail of every Pro render mode (76) and the example image of every free mode (15).
- Not seen, known by name only: the ten Liquid Glass textures (Cross Reeded, Hammered, Diamond Glass, Hexagon, Ripple, Ice Crackle, Chevron Prism, Seedy Bubbles, Glass Pixel, Jello). They have no public thumbnails.
- Not accessible: the per-mode parameter panels of Pro styles, which only show inside the editor for a Pro account. The docs say the same thing: "a full list of every per-mode parameter would be several hundred entries". Each Pro style was therefore judged from its official description and its thumbnail, not from its control panel. Where AirFx's controls are listed below, they are AirFx's own.
- Generative (171 presets): these are server-side AI renders paid for with credits. Only 8 preset names are public without an account. No AI service is being added; the 8 known looks are mapped to AirFx's own effects below.

Classification: **A** exists and works (verified by its actual technique, not its name) · **B** exists, needs improvement · **C** missing, to be built.

## Render modes (91 modes, 100 tiles)

### ASCII and Text (6)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Characters | characters | Free | ASCII Renderer | B | Add the missing ramps (Ink, Minimal, Forensic, Bars, Quadrants, Numeric, Hacker, Alpha, Geometric). Add background modes: blurred picture, original picture, solid, none. Add a coverage control that thins cells by a fixed hash, so animation never shimmers. |
| ASCII Studio | asciiStudio | Pro | ASCII Renderer (colour on black) | B | Add a Studio look: fine glyphs or palette shapes in image colour on black, with glyph glow. |
| Block | block-chars | Free | ASCII "Blocks" ramp | B | Real half- and quarter-block rendering: two or four sub-pixels per cell, each with its own colour (▀▄▌▐▘▝▖▗). |
| Dots | dots | Free | Dots | A | |
| Mixed | mixed | Free | ASCII custom ramp only | B | Add a Mixed ramp built from several glyph families. |
| Braille | braille | Free | ASCII "Braille" ramp | B | True braille: each cell is 2 × 4 dots, each dot set from its own pixel, not a tone ramp. |

### Pixel and Blocks (6)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Pixel Art | pixel | Free | Image To Pixel Art | A | |
| Mosaic | mosaic | Free | Pixel Art / Quadtree Mosaic | B | Add tile aspect (square, wide, tall) and grout to Pixel Art. |
| LEGO | lego | Free | Brick Mosaic | A | |
| Voxel | 3d | Free | Voxel Cubes | A | |
| Hex Mosaic | hexmosaic | Pro | Hex Mosaic | A | |
| LED Matrix | ledmatrix | Pro | LED Screen | B | Add SMD and marquee-bulb layouts and an "on black" sign mode. |

### Print and Paper (15)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Dither | dither | Free | Dithering Lab | B | Add Bayer 2×2, 4×4 and 16×16, Radial, horizontal / vertical / diagonal line dithers, Blue Noise, Sierra Lite. Add palettes: Mono, Grey 4, Grey 8, CGA 0, CGA 1, Pico-8, C64, NES, 3-bit RGB, Cyberpunk, Pastel, Sepia, Original colours. |
| Stippling | stippling | Pro | Stippling | A | |
| Risograph | risograph | Pro | PrintAnimate (Riso inks) | A | |
| Comic | comic | Pro | — | C | New: flat posterised fills, dot shading in the mid-tones, heavy ink outlines. |
| Sketch | sketch | Pro | — (Crayon is wax, Edge is outlines) | C | New: graphite pencil, fine directional strokes following edges, paper grain. |
| Engraving | engraving | Pro | Liner Pro (straight lines) | B | Add contour-following, wavy banknote lines to Liner Pro. |
| Warhol | warhol | Pro | — | C | New: grid of repeats, each in its own high-contrast screen-print colourway. |
| Cyanotype | blueprint | Pro | Cyanotype | A | |
| Halftone | halftone | Pro | Halftone | A | |
| Woodblock | ukiyoe | Pro | — | C | New: flat colour planes, carved dark outlines, woodgrain and paper texture. |
| Posterize | posterize | Pro | Posterize + Multi Threshold | A | |
| Mezzotint | mezzotint | Pro | — | C | New algorithm in Dithering Lab: clustered random grain (mezzotint rocker texture). |
| Pointillize | pointillize | Pro | Pointillism | A | |
| Crosshatch | crosshatch | Pro | Patterns › Crosshatch (layers with tone) | A | |
| CMYK Drops | halftonecmyk | Pro | CMYK Print | A | |

### Geometric (15)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Cross | cross | Free | Shape Halftone › Cross | A | |
| Diamond | diamond | Free | Shape Halftone › Diamond | A | |
| Lines | lines | Free | Shape Halftone › Lines | A | |
| Diagonal | diagonal | Free | Shape Halftone › Diagonal | A | |
| Specimen | specimen | Pro | — | C | New: a grid of boxed colour swatches sampled from the picture, with labels. |
| Low Poly | lowpoly | Pro | — | C | New: points placed by detail, Delaunay triangles, each filled flat. |
| Droste | droste | Pro | Polar Warp › Infinite Spiral | A | |
| Truchet | truchet | Pro | — | C | New: quarter-arc tiles, oriented and weighted by tone. |
| Iso Extrude | isoextrude | Pro | Voxel Cubes (Voxel City) | A | |
| Flow Field | flowfield | Pro | — | C | New: streamlines traced along the image's flow, coloured from it. |
| Lattice | lattice | Pro | — | C | New: woven over-under strips, warped and shaded by the picture. |
| Topography | topography | Pro | Topo Survey + Contour Field | A | |
| Forms | forms | Pro | — (Shape Halftone uses one shape) | C | New: mixed Bauhaus shapes (circles, half-circles, quarter-circles, triangles, squares) chosen and scaled by tone. |
| Schematic | schematic | Pro | Circuit Board / Node Network | A | |
| Neon Grid | neongrid | Pro | — | C | New: glowing wireframe grid displaced by brightness. |

### Distort (8)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Smudge | smudge | Pro | — (Liquify is noise-driven) | C | New: a directional finger smear dragged from a point. |
| Pinch | pinch | Pro | Distort › Bulge / Pinch | A | |
| Spherize | spherize | Pro | Lens Warp / Distort › Bulge | A | |
| Twirl | twirl | Pro | Distort › Swirl | A | |
| ZigZag | ripple | Pro | Distort › ZigZag | A | |
| Ripple | zigzag | Pro | Distort › Ripple | A | |
| Polar | polar | Pro | Polar Warp (Little Planet, Unwrap) | A | |
| Shear | shear | Pro | Distort › Shear Bands | B | Add a continuous skew with a period, as well as bands. |

### Blur and Focus (4)

| Reference | Mode | Tier | AirFx | Class |
|---|---|---|---|---|
| Motion Blur | motionblur | Pro | Focus & Motion Blur › Motion | A |
| Tilt-Shift | tiltshift | Pro | Focus & Motion Blur › Tilt-Shift | A |
| Gaussian Blur | gaussianblur | Pro | Focus & Motion Blur › Gaussian | A |
| Radial Blur | radialblur | Pro | Radial Blur | A |

### Glitch and Signal (10)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| CRT Screen | crt | Pro | CRT | A | |
| Pixel Sort | pixelsort | Pro | Pixel Sort | A | |
| Forensics | forensics | Pro | — | C | New: error-level analysis look, recompression difference mapped to a heat palette. |
| Digital Distortion | glitch | Pro | Glitch / Glitch 2.0 | A | |
| Datamosh | datamosh | Pro | Datamosh | A | |
| Lofi | lofi | Pro | VHS presets | A | |
| RGB Split | rgbsplit | Pro | RGB Shift | A | |
| Scanline | scanline | Pro | CRT / VHS scanlines | A | |
| Thermal | thermal | Pro | Thermal Vision | A | |
| Beacon | beacon | Pro | Light Rays / Anamorphic Streaks | A | |

### Light and Colour (11)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Disco | disco | Free | — | C | New: mirror-ball, the picture wrapped onto a sphere of glitter tiles with sparkles. |
| Anaglyph 3D | anaglyph | Pro | — (RGB Shift is not a stereo pair) | C | New: red/cyan anaglyph, with depth-driven parallax when a depth map exists. |
| Gradient Map | gradientmap | Pro | Gradient Map | A | |
| Prism | prism | Pro | — (Chromatic Aberration splits RGB only) | C | New: spectral rainbow dispersion through faceted prism cells. |
| Dreamdust | dreamdust | Pro | Light Particles / Dreamy | B | Add a mode where glowing dust is sampled from the picture's edges and colours. |
| Light Wind | lightwind | Pro | — | C | New: long-exposure streaks of light swept sideways from the highlights. |
| Kaleidoscope | starburst | Pro | — (Polar Warp repeats, does not mirror) | C | New: mirrored wedges, any segment count. |
| Warpbloom | warpbloom | Pro | Radial Blur + Glow & Bloom | A | |
| Duotone | duotone | Pro | Duotone | A | |
| Edge Glow | edgeglow | Pro | Edge › Neon | A | |
| Aberration | lens | Pro | Chromatic Aberration + Lens Warp | A | |

### Glass (16 tiles, 7 modes)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Frosted Glass | frostedglass | Pro | — | C | New: frosted pane, fine random scatter plus diffusion. |
| Tinted Glass | stainedglass | Pro | — | C | New: stained glass, Voronoi panes with lead lines and tinted, glowing glass. |
| Shatter | shatter | Pro | — | C | New: radial cracks from an impact point, shards displaced and lit. |
| Vitrine | vitrine | Pro | Reeded Glass › Grid | B | Add pressed-glass facets with highlights. |
| Glass Orb | glassorb | Pro | — (Lens Warp has no sphere or reflection) | C | New: crystal ball, refraction through a sphere with rim and reflection. |
| Fluted Glass | flutedglass | Pro | Reeded Glass › Lines | A | |
| 10 Liquid Glass textures | liquidglass | Pro | Reeded Glass (Lines, Waves, Grid, Concentric, Chevron) | B | Add the missing textures to Reeded Glass: Hammered, Diamond, Hexagon, Ice Crackle, Seedy Bubbles, Glass Pixel, Jello. Cross Reeded = Grid, Ripple = Concentric, Chevron Prism = Chevron. *Known by name only.* |

### Material and Texture (9)

| Reference | Mode | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Waves | waves | Pro | Water Surface | A | |
| Oil Paint | oilpaint | Pro | Oil Paint | A | |
| Watercolor | watercolor | Pro | — (Ink Bleed is ink, not wash) | C | New: soft pigment washes, granulation, edge darkening, paper. |
| Chrome | chrome | Pro | Liquid Chrome | A | |
| Thin-Film | thinfilm | Pro | Iridescent Film | A | |
| Marble | marble | Pro | — | C | New: tone veined into swirling polished stone. |
| Molten Metal | molten | Pro | — (Liquid Chrome is cold metal) | C | New: glowing liquid alloy, hot ramp with crust. |
| Crystallize | crystallize | Pro | — (Hex Mosaic is a regular grid) | C | New: Voronoi crystal cells, each one flat colour. |
| Emboss | emboss | Pro | Bevel › Emboss | A | |

## Post effects (28) plus Levels and Curves

| Effect | Key | Tier | AirFx | Class | Work |
|---|---|---|---|---|---|
| Vignette | vignette | Free | Only inside CRT, Film Grain, VHS | C | New standalone Vignette: centre, size, feather, roundness, colour. |
| Scan Lines | scanLines | Free | Inside CRT | B | Standalone scanlines: spacing, thickness, colour. |
| CRT Curvature | crtCurve | Free | CRT › Curvature | A | |
| Chromatic | chromatic | Free | Chromatic Aberration (radial only) | B | Add angle (linear split) and a radial / linear mix. |
| Bloom | bloom | Free | Glow & Bloom | A | |
| Character Bloom | charBloom | Free | — | C | Add to ASCII: each glyph glows. |
| Character Chromatic | charChroma | Free | — | C | Add to ASCII: each glyph drawn with an RGB offset. |
| Film Grain | filmGrain | Free | Film Grain | A | |
| Glitch | glitch | Free | Glitch | A | |
| RGB Split | rgbSplit | Free | RGB Shift | A | |
| Pixelate | pixelate | Free | Image To Pixel Art | A | |
| Halftone | halftone | Free | Halftone | A | |
| ASCII | ascii | Pro | ASCII Renderer | A | |
| Diffuse | diffuse | Pro | — | C | New: Photoshop-style diffuse (normal, darken only, lighten only, anisotropic). |
| Threshold | threshold | Pro | Threshold (level, softness) | A | |
| Reduce Noise | reduceNoise | Pro | — | C | New: edge-preserving denoise (bilateral), amount and radius. |
| Pinch / Spherize / Twirl / ZigZag / Ripple / Polar | | Pro | Distort, Lens Warp, Polar Warp | A | |
| Shear | shear | Pro | Distort › Shear Bands | B | As above. |
| Fragment | fragment | Pro | — | C | New: overlapping offset copies (2 to 8). |
| Film Dust | filmDust | Free | — (Grunge and VHS damage are different) | C | New: dust, hairs and scratches over the frame, animated per frame. |
| Noise | noise | Free | Noise | A | |
| Sharpen | sharpen | Free | — (Clarity is local contrast) | C | New: unsharp mask, amount, radius, threshold. |
| Blur | advBlur | Free | Focus & Motion Blur (Gaussian, Motion, Tilt-Shift) | B | Add lens blur (bokeh disc) and progressive blur (near, far, angle). |
| Levels | | Pro | Levels (composite only) | B | Add per-channel levels. |
| Curves | | Pro | Curves (monotone, per channel) | A | |

## Dither engine, palettes and ramps

Covered in the Dither and Characters rows above. All 15 reference algorithms and all 15 palettes will exist in Dithering Lab, and all 17 ramps in ASCII.

## Generative presets (171, AI, server-side)

Not reproduced with AI. The 8 public names, mapped to AirFx's own processing:

| Preset | Group | AirFx route |
|---|---|---|
| Bit Press | Retro digital | Pixel Crusher |
| Terminal Print | Retro digital | ASCII (green on black) + CRT |
| Heat Signature | Photo and film | Thermal Vision |
| Riso Drum | Print and zine | PrintAnimate (Riso) |
| Sprite Sheet | Retro digital | Image To Pixel Art |
| Voxel World | Objects and toys | Voxel Cubes |
| Tape Static | Retro digital | VHS (Degraded Tape) |
| Security Feed | Retro digital | VHS + CRT, with timestamp |

The other 163 presets are not visible without an account, so they are not claimed as researched.

## Totals

- **C (new):** 27 render modes (Comic, Sketch, Warhol, Woodblock, Mezzotint as a Dithering Lab algorithm, Specimen, Low Poly, Truchet, Flow Field, Lattice, Forms, Neon Grid, Smudge, Forensics, Disco, Anaglyph, Prism, Light Wind, Kaleidoscope, Frosted Glass, Stained Glass, Shatter, Glass Orb, Watercolor, Marble, Molten Metal, Crystallize) and 8 post effects (Vignette, Character Bloom, Character Chromatic, Diffuse, Reduce Noise, Fragment, Film Dust, Sharpen).
- **B (improve):** Characters, ASCII Studio, Block, Mixed, Braille, Mosaic, LED Matrix, Dither, Engraving, Shear, Dreamdust, Vitrine, Liquid Glass, Scan Lines, Chromatic, Blur, Levels.
- **A (already covered):** everything else.

## Stages

1. ✅ Done: Vignette, Scan Lines, Film Dust, Fragment, Sharpen, Reduce Noise, Diffuse (new); Chromatic linear mode, Blur Lens and Progressive modes, per-channel Levels (improved). Sharpen, Reduce Noise, Diffuse and Chromatic run on the GPU (1 to 3 ms at 1080p) with a matching CPU fallback.
2. Glyph modes: ASCII ramps, background modes, coverage, Character Bloom and Chromatic, Studio, Mixed, true Block and Braille.
3. Dither engine: algorithms, palettes, Mezzotint.
4. Glass: Frosted, Stained, Shatter, Glass Orb, Vitrine facets, Liquid Glass textures.
5. Print and paint: Comic, Sketch, Warhol, Woodblock, Watercolor, Engraving lines.
6. Geometric: Low Poly, Crystallize, Truchet, Forms, Specimen, Flow Field, Lattice, Neon Grid.
7. Light, material and signal: Disco, Anaglyph, Prism, Light Wind, Kaleidoscope, Dreamdust, Marble, Molten Metal, Forensics, Smudge, Shear, Mosaic tiles, LED layouts.

Each stage: test on a portrait, a landscape, architecture, typography, an abstract image and a video, at preview size and at 4K, alone and in a stack.
