# Synkit and Nexus research

Used to find techniques AirFx lacked. Every AirFx effect here is an original implementation written from public descriptions. No Synkit code, shaders, presets or assets were used, and no effect copies a Synkit name where it could be avoided.

## What could and could not be inspected

| Source | Status |
| --- | --- |
| nexus.synkit.net/effects | Read: 30 featured effects with short descriptions, a library of 73 effect names (62 raster, 11 vector), 14 stack names |
| nexus.synkit.net/docs | Read: five core filters and general parameter behaviour |
| nexus.synkit.net/figma, /welcome | Read |
| 11 individual effect pages | Read for technique and controls: Plexus, Blob Tracking, Torn Paper Collage, Reeded Glass, CCTV, Holographic, Wave Lines, Cyanotype, Metaball, Circuit Board, Newspaper, Stencil, Grunge (13 in all) |
| The other effect pages | Not opened. Names and one-line descriptions only |
| synkit.net main site | Could not be read: the server answered HTTP 429 (too many requests) |
| instagram.com/synkitnet | Login wall. Only the profile text, highlight names (Band Machine, Nexus, Array Machine, Node Machine) and the first six post thumbnails were visible. No captions, carousels or videos. I did not sign in. Screen recordings from you would fill this gap |
| The editor itself | Not used. Nothing here reflects how Nexus works internally |

## Comparison

"Already in AirFx" means before this round. Priority reflects what adds something new, not what Synkit has.

| Technique | Source | Already in AirFx? | Missing before | Difficulty | Image | Video | Priority | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Node network / plexus | Node, Plexus | No | All | Medium | Yes | Yes | High | **Added**: Node Network |
| Circuit traces | Circuit, Circuit Board | No | All | Medium | Yes | Yes | High | **Added**: Circuit Board. Rasters only; Nexus also exports vector |
| Shape arrays | Array | Partly: Glyph Array | Radial layouts | Low | Yes | Yes | Medium | **Added**: Radial Array. Grid arrays stay in Glyph Array, not duplicated |
| Text as image | Typeset, Text Portrait | Partly: ASCII Renderer | Proportional rows of real type | Low | Yes | Yes | Medium | **Added**: Text Portrait |
| Displaced scanlines | Wave Lines | No | All | Low | Yes | Yes | High | **Added**: Wave Lines. Error modes not added; use Glitch after it |
| Metaballs | Metaball, Metablob | No | All | Medium | Yes | Yes | High | **Added**: Metaballs |
| Blob tracking overlay | Blob Tracking, BlobTracker PRO, Tracker | No | All | Medium | Yes | Yes | High | **Added**: Blob Tracker. Like the source, detects per frame with no persistent IDs |
| Cyanotype | Cyanotype | No | All | Low | Yes | Yes | Medium | **Added** |
| Newspaper plates | Newspaper | No | All | Low | Yes | Yes | Medium | **Added**: Newspaper Print |
| Stencil / spray | Stencil, Spray Paint | No | All | Low | Yes | Yes | Medium | **Added**: Spray Stencil |
| Torn collage | Torn Paper Collage, Pop Art, Collage | No | All | High | Yes | Yes | Medium | **Added**: Torn Paper Collage |
| Pointillism | Pointillism, Pointillize | Partly: Stippling is ink dots | Paint dots | Low | Yes | Yes | Medium | **Added** |
| Ribbed glass | Reeded Glass, Glass Pane, Glass | No | All | Medium | Yes | Yes | High | **Added**: Reeded Glass, with dispersion |
| Chrome / metal | Layer styles seen on Instagram thumbnail, Gold Emboss | Partly: Bevel | Environment reflection | Medium | Yes | Yes | Medium | **Added**: Liquid Chrome, with gold and copper |
| Holographic | Holographic, Holo Card | No | All | Medium | Yes | Yes | Medium | **Added** |
| Grunge | Grunge, Grunge Print, Grime Halftone | No | All | Low | Yes | Yes | Medium | **Added** |
| Water, ice, cracked print | Your brief | No | All | Medium | Yes | Yes | Medium | **Added**: Water Surface, Frozen Ice, Cracked Print |
| Light trails, slit scan | Light Trails, Line Scan | No | All | Medium | No | Yes | Medium | **Added**: Motion Trails, Line Scan |
| Riso | Riso, RisoPrint | Yes: PrintAnimate, Array Riso | None | | Yes | Yes | None | Not duplicated |
| Halftone, Shape Halftone, CMYK, Stipple, Dither, ASCII, Topographic, Knit, Brick, Airbrush, Pixel Sort, Datamosh, VHS, CRT, Threshold, Scatter, Stars, PixDisplace, Glitch | Several | Yes | None | | Yes | Yes | None | Not duplicated |
| CCTV | CCTV | Partly: CRT | Monochrome and mask presets | Low | Yes | Yes | Low | Not added. CRT covers most of it |
| Thermal | Gallery | Partly: Recolor has a Thermal palette | None worth adding | Low | Yes | Yes | Low | Not added |
| Bloom, Glare Glow | Library | Yes: Glow & Bloom | None | | Yes | Yes | None | Not duplicated |
| Prism Ray, Prism Fold | Library name only | Unknown | Not seen | Unknown | | | Unknown | Not added: I have not seen what these do |
| Band Machine | Instagram highlight name | Unknown | Not seen | Unknown | | | Unknown | Not added: only the name is visible |
| Vector export (SVG) | Nexus plugins | No | Whole vector pipeline | High | Yes | No | Later | Not added. Would need a separate vector renderer for each effect |
| AI-generated effects | Nexus Create | No | Needs a paid or remote model | High | | | Not planned | Not added. Against the local-first rule |
| Gooey Print, MixedMedia, Dreamy, Crayons, Signal Bleed, Data Streak, Wind Grain, Ink Press and other library names | Library names only | Unknown | Not seen | Unknown | | | Unknown | Not added. Names alone are not enough, and I did not invent looks for them |
