# AirFx Effect Audit

Generated from `src/effects/registry.ts` by `scripts/audit-effects.mjs`. 129 effects.

Every effect below was rendered through the real stack renderer on a photo with default settings, without errors. All can be added, reordered, disabled, duplicated and removed in the stack. Each effect was also rendered at 1920×1080 and 960×540 and compared, and rendered twice to confirm the same frame gives the same result. The controls of the effects added in 3.0 and 4.0 were each changed one at a time and confirmed to change the picture.

## Stacks (7)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Hyper Glitch** | Image, video | 5 | Intensity, Block Size, RGB Split, Speed, Seed |  |
| **Red Data** | Image, video | 4 | Character Size, Contrast, Characters, Red |  |
| **Pixel Stars** | Image, video | 4 | Pixel Size, Star Threshold, Star Size, Twinkle |  |
| **Multi Threshold** | Image, video | 6 | Levels, Contrast, Shadow, Low Mid, High Mid, Highlight |  |
| **Gameboy** | Image, video | 3 | Pixel Size, Contrast, Dither |  |
| **Array Riso** | Image, video | 5 | Cell Size, Target Color, Tolerance, Tile Color, Motion |  |
| **Array Airbrush** | Image, video | 4 | Cell Size, Coverage, Shape Color, Motion |  |

## Pattern & Generative (17)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Moiré** | Image, video | 19 | Pattern Type, Frequency, Pattern Scale, Angle, Rotation, Layer Offset, Image Influence, Line Width, Second Layer Frequency, Line Waver, Contrast, Intensity, Blend Mode, Invert Pattern, Color 1, Color 2, Original Opacity, Animate (video), Drift Speed |  |
| **Stippling** | Image, video | 13 | Spacing, Jitter, Seed, Dot Size, Size Variation, Contrast, Brightness, Tone Curve, Invert, Color Mode, Ink Color, Paper Color, Transparent Background |  |
| **Dots** | Image, video | 45 | Cell Size, Dot Scale, Offset Rows, Shape, Size by Brightness, Minimum Size, Contrast, Invert Size, Color Mode, Dot Color, Background Color, Transparent Background, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Patterns** | Image, video | 12 | Pattern, Scale, Angle, Wave Amplitude, Phase, Drift Speed, Contrast, Brightness, Invert, Ink Mode, Ink Color, Paper Color |  |
| **Cellular Automata** | Image, video | 17 | Cell Size, Threshold, Invert Seed, Rule, Birth Lower Bound, Birth Upper Bound, Survive Lower Bound, Survive Upper Bound, Steps, Animate, Generations / sec, Cell Shape, Alive Color, Alive Color, Dead Color, Image Ghost, Transparent Background |  |
| **Topo Survey** | Image, video | 13 | Terrain Smoothing, Contour Levels, Sea Level, Invert Terrain, Tide Motion, Water, Lowland, Upland, Peak, Contour Color, Contour Strength, Survey Grid, Map Frame |  |
| **Knitwear** | Image, video | 7 | Stitch Size, Stitch Height, Yarn Weight, Fuzz, Yarn Colors, Backing Color, Seed |  |
| **Glyph Array** | Image, video | 47 | Cell Size, Shapes, Mixed Tile Sizes, Coverage, Seed, Apply To, Target Color, Tolerance, Threshold, Tile Color, Tile, Glyph, Tile Opacity, Shuffle Rate, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Brick Mosaic** | Image, video | 12 | Stud Size, Edge Rounding, Gap, Show Studs, Gloss, Shading Depth, Color Mode, Color Levels, Board Color, Animation, Speed, Seed |  |
| **Node Network** | Image, video | 46 | Node Count, Link Distance, Links Per Node, Nodes Follow, Turbulence, Seed, Line Width, Node Size, Color Mode, Color A, Color B, Background, Original Opacity, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Circuit Board** | Image, video | 48 | Grid Pitch, Traces, Trace Length, Routing, Threshold, Use Dark Areas, Seed, Trace Width, Pad Size, Glow, Color Mode, Color A, Color B, Background, Original Opacity, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Radial Array** | Image, video | 46 | Rings, Spokes, Centre X, Centre Y, Twist, Spin, Shape, Max Size, Min Size, Invert Tone, Color Mode, Ink, Background, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Wave Lines** | Image, video | 12 | Line Spacing, Line Width, Displacement, Softness, Drift, Thin In Shadows, Invert, Glow, Line Color, Accent Every, Band Accent, Background |  |
| **Metaballs** | Image, video | 10 | Drive Region, Blob Pitch, Merge, Spread, Wobble, Blob Color, Color From Image, Background, Transparent Background, Invert |  |
| **Blob Tracker** | Image, video | 47 | Detect, Target Color, Color Tolerance, Threshold, Targets, Marker, Connect Lines, Numbered Labels, Line Width, Target Color, Dim Image, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend, Content Size, Orientation, Smooth Motion |  |
| **Contour Field** | Image, video | 14 | Levels, Smoothness, Noise Mix, Noise Size, Flow, Seed, Line Width, Stroke Style, Dash Length, Color System, Line / Low, High, Background, Transparent Background |  |
| **Data Bars** | Image, video | 11 | Columns, Bar Height, Gap, Measure, Grow From, Value Labels, Grid, Color, Bar Color, Dim Image, Label Font |  |

## Distortion & Glitch (19)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Scatter** | Image, video | 45 | Point Density, Scatter Amount, Random Seed, Minimum Size, Maximum Size, Shape, Size by Brightness, Color Mode, Shape Color, Background Color, Transparent Background, Distribution, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Distort** | Image, video | 10 | Mode, Amount, Frequency, Direction, Phase, Animation Speed, Center X, Center Y, Radius, Edges |  |
| **Displace** | Image, video | 10 | Map Source, Strength, Direction, Map Smoothing, Noise Scale, Octaves, Seed, Animation Speed, Channel Split, Edges |  |
| **PixDisplace** | Image, video | 8 | Block Size, Coverage, Mixed Sizes, Displacement, Direction, Smear, Steps / sec, Seed |  |
| **Datamosh** | Image, video | 9 | Block Size, Smear, Drift Angle, Drift Strength, Turbulence, Fresh Bleed, Mosh Moving Areas Only, Keyframe Every, Seed | Keeps earlier frames: it develops during playback. |
| **Pixel Sort** | Image, video | 7 | Direction, Sort By, Lower Threshold, Upper Threshold, Max Span, Reverse Order, Show Mask |  |
| **RGB Shift** | Image, video | 3 | Distance, Angle, Shift Green |  |
| **Glitch** | Image, video | 9 | Glitch Intensity, Glitch Bands, Horizontal Shift, Vertical Shift, RGB Separation, Noise Amount, Scanline Intensity, Seed, Animate (video) |  |
| **Displacement Map** | Image, video | 6 | Map Image, Strength, Direction, Scale, Smoothing, Edges |  |
| **Liquify** | Image, video | 8 | Brush Points, Brush Scale, Strength, Twirl, Push Direction, Animation Speed, Seed, Edges |  |
| **Turbulence** | Image, video | 7 | Strength, Scale, Complexity, Domain Warp, Animation Speed, Seed, Edges |  |
| **Channel Displacement** | Image, video | 8 | Strength, Frequency, Direction, Animation Speed, Red Amount, Green Amount, Blue Amount, Edges |  |
| **JPEG Artifacts** | Image, video | 4 | Quality, Block Scale, Chroma Subsampling, Generations |  |
| **Pixel Crusher** | Image, video | 10 | Pixel Width, Pixel Height, Levels per Channel, Color Boost, Black Threshold, Row Smear, Row Shift, Scanlines, Glitch Rate, Seed |  |
| **Lens Warp** | Image, video | 7 | Warp, Center X, Center Y, Radius, Chromatic Split, Vignette, Pulse |  |
| **Fluid Distortion** | Image, video | 5 | Amount, Swirl Size, Turbulence, Speed, Seed |  |
| **Ink Bleed** | Image, video | 63 | Ink Follows, Motion Sensitivity, Motion Threshold, Follow Motion, On A Still Image, Ink Amount, Ink Strength, Color Layers, Ink 1, Ink 2, Ink 3, Layer Separation, Ink Shape, Shape Size, Bleed Spread, Bleed Radius, Edge Hardness, Edge Texture, Wet Edge, Fade Time, Direction, Flow Speed, Turbulence, Swirl Detail, Fluid Distortion, Ink Blend, Ink Opacity, Background, Paper, Seed, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Glitch 2.0** | Image, video | 28 | Glitch Intensity, Timing, Glitch Speed, Burst Frequency, Burst Length, Direction, Glitch Pattern, Glitch Frequency, Span Size, Seed, RGB Separation, Separation Angle, Color Channel Shift, Signal Burn, Digital Displacement, Horizontal Tearing, Vertical Tearing, Tear Detail, Pixel Sorting, Sort From Tone, Sort To Tone, Datamosh Melt, Mosh Block Size, Frame Distortion, Digital Noise, Noise Tint, Scanlines, Scanline Size |  |
| **Modulation** | Image, video | 58 | Output, Modulation, Modulated By, Text, Font, Text Size, Invert Source, Modulation Depth, Source Smoothing, Waveform, Frequency, Amplitude, Phase, Speed, Direction, Repetition, Distortion, Distortion Drift, Line Width, Width Follows Source, Color, Line Color, Second Color, Background, Show Image Under Lines, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |

## Texture & Print (27)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Halftone** | Image, video | 44 | Grid Spacing, Dot Size, Angle, Shape, Contrast, Brightness, Invert, Color Mode, Ink Color, Background Color, Transparent Background, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Dithering Lab** | Image, video | 16 | Algorithm, Dither Intensity, Cell Size, Pattern Angle, Pattern Scale, Random Seed, Palette, Color Count, Custom Palette, Ink, Background Color, Transparent Background, Contrast, Brightness, Gamma, Invert |  |
| **Dithering** | Image, video | 7 | Method, Pixel Size, Levels, Per-Channel Color, Contrast, Dark Color, Light Color | A 1-pixel-scale pattern, so a downscaled copy of a 4K render differs slightly from the preview. |
| **Edge** | Image, video | 9 | Look, Strength, Threshold, Pre-Smooth, Thickness, Line Color, Background Color, Image Mix, Transparent Background |  |
| **Bevel** | Image, video | 10 | Material, Depth, Smoothness, Invert Height, Light Angle, Light Elevation, Specular, Light Spin, Clay / Chrome Tint, Ambient |  |
| **PrintAnimate** | Image, video | 9 | Ink Set, Dot Size, Contrast, Ink Density, Mis-registration, Jitter, Boil Rate, Paper Color, Paper Grain |  |
| **Film Grain** | Image, video | 7 | Grain Amount, Grain Size, Colored Grain, Animate Noise (video), Contrast, Brightness, Vignette |  |
| **Noise** | Image, video | 11 | Type, Scale, Octaves, Contrast, Seed, Animation Speed, Amount, Blend Mode, Colors, Color A, Color B |  |
| **Texture Overlay** | Image, video | 7 | Texture, Scale, Strength, Blend Mode, Tint, Seed, Animate (Film Weave) |  |
| **Airbrush** | Image, video | 10 | Pigment Levels, Softness, Saturation, Overspray, Grain Size, Density, Animate Grain, Knock Out Highlights, Paper Color, Transparent Paper |  |
| **Pattern Merge** | Image, video | 10 | Pixel Size, Edge Threshold, Outline Width, Outline Color, Inner Pattern, Pattern in Tones Below, Image Mix, Pixelate Image, Background, Crawl Speed |  |
| **Liner Pro** | Image, video | 13 | Line Spacing, Angle, Minimum Weight, Maximum Weight, Contrast, Black Cut-Off, Line Shift, Block Breakup, Line Color, Highlight Color, Background, Line Scroll, Seed |  |
| **Shape Halftone** | Image, video | 45 | Shape, Grid Spacing, Shape Scale, Grid Angle, Shape Rotation, Tone Curve, Invert, Color Mode, Ink, Highlight Ink, Background Color, Transparent Background, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **CMYK Print** | Image, video | 10 | Screen Size, Dot Gain, Black Generation, Misregistration, Contrast, Paper, Cyan Plate, Magenta Plate, Yellow Plate, Black Plate |  |
| **Cyanotype** | Image, video | 8 | Wash Density, Wet Bleed, Grain, Paper Texture, Seed, Shadow Pigment, Mid Pigment, Paper |  |
| **Newspaper Print** | Image, video | 8 | Plate 1 Coverage, Plate 2 Coverage, Ink Contrast, Grain Scale, Seed, Ink 1, Ink 2, Paper |  |
| **Spray Stencil** | Image, video | 8 | Blur Before Cut, Threshold, Overspray, Speckle, Seed, Paint, Paper, Transparent Background |  |
| **Torn Paper Collage** | Image, video | 11 | Collage Pieces, Tear Roughness, Torn Fiber Width, Screen Pitch, Misregistration, Seed, Plate Ink A, Plate Ink B, Plate Ink C, Paper, Torn Fiber White |  |
| **Pointillism** | Image, video | 40 | Dots, Dot Size, Size Variation, Color Jitter, Saturation Boost, Seed, Canvas, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Liquid Chrome** | Image, video | 8 | Smoothness, Relief, Reflection Bands, Contrast, Flow, Metal, Metal Tint, Shadow Tint |  |
| **Frozen Ice** | Image, video | 7 | Shard Size, Refraction, Crack Brightness, Frost, Seed, Ice Tint, Tint |  |
| **Cracked Print** | Image, video | 6 | Crack Size, Crack Width, Worn Patches, Ink Fade, Seed, Base Surface |  |
| **Grunge** | Image, video | 6 | Shadow Crush, Contrast, Granulation Scale, Pigment Speckle, Spill Reach, Seed |  |
| **Quadtree Mosaic** | Image, video | 39 | Smallest Cell, Largest Cell, Detail, Cell, Gap, Background, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Pixel Gradient** | Image, video | 8 | Pixel Size, Gradient Angle, Follow Image, Dither, Color 1, Color 2, Color 3, Color 4 |  |
| **Image To Pixel Art** | Image, video | 65 | Resolution By, Pixel Size, Sprite Width, Pixel Density, Pixel Shape, Gap Color, Color Palette, Colors, Levels, Custom Palette, Lock Palette On Video, Contrast, Saturation, Brightness, Dithering, Dither Strength, Edge Preservation, Sprite Outline, Outline Threshold, Outline Color, Pixel Cutout, Cutout Shape, Cutout Pixel Size, Cutout Size, Position X, Position Y, Line Thickness, Spiral Turns, Filled Shape, Invert Shape, Pixelate Image Too, Paper, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Crayon** | Image, video | 25 | Crayon Colors, Crayons In The Box, Color Blending, Saturation, Color Variation, Stroke Density, Stroke Length, Stroke Width, Stroke Direction, Direction, Direction Jitter, Pressure, Crayon Texture, Texture Scale, Edge Preservation, Outline Width, Outline Darkness, Broken Outline, Background, Paper Threshold, Paper Color, Paper Texture, Hand-Drawn Boil, Show Image Under Paper, Seed |  |

## Light & Optical (14)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Stars** | Image, video | 45 | Threshold, Spacing, Seed, Star Size, Rays, Ray Thickness, Glow, Color, Star Color, Twinkle Speed, Spin, Dim Image, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Lens Flare** | Image, video | 20 | Light Sources, Light 1 X, Light 1 Y, Light 2 X, Light 2 Y, Light 3 X, Light 3 Y, Intensity, Radius, Color, Glow Spread, Starburst Rays, Streak Length, Streak Angle, Light Elements, Chromatic Separation, Halo Ring, Random Seed, Blend Mode, Opacity |  |
| **Glow & Bloom** | Image, video | 8 | Threshold, Intensity, Glow Spread, Wide Halo, Tint, Glow Color, Blend Mode, Opacity |  |
| **Anamorphic Streaks** | Image, video | 7 | Threshold, Streak Length, Streak Angle, Intensity, Color, Blend Mode, Opacity |  |
| **Chromatic Aberration** | Image, video | 4 | Chromatic Separation, Center X, Center Y, Edge Falloff |  |
| **Light Rays** | Image, video | 14 | Light Sources, Light 1 X, Light 1 Y, Light 2 X, Light 2 Y, Light 3 X, Light 3 Y, Threshold, Ray Length, Intensity, Color, Shimmer, Blend Mode, Opacity |  |
| **Light Leak** | Image, video | 9 | Light Elements, Radius, Intensity, Color A, Color B, Drift Speed, Random Seed, Blend Mode, Opacity |  |
| **Aurora** | Image, video | 10 | Intensity, Scale, Curtain Height, Position Y, Color A, Color B, Speed, Random Seed, Blend Mode, Opacity |  |
| **Light Particles** | Image, video | 43 | Particle Density, Size, Shape, Color, Speed, Direction, Twinkle, Random Seed, Blend Mode, Opacity, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Reeded Glass** | Image, video | 7 | Reed Size, Reed Pattern, Angle, Refraction, Light Dispersion, Frosting, Rib Shading |  |
| **Water Surface** | Image, video | 7 | Ripple Scale, Refraction, Caustics, Speed, Water Tint, Tint, Seed |  |
| **Iridescent Film** | Image, video | 8 | Film Thickness, Follow Image, Surface Ripple, Ripple Size, Flow, Amount, Apply As, Seed |  |
| **Digital Bubbles** | Image, video | 8 | Bubbles, Size, Size Variation, Refraction, Iridescent Rim, Highlight, Rise Speed, Seed |  |
| **Dreamy** | Image, video | 39 | Look, Intensity, Paper, Deep Pigment, Mid Pigment, Thin Pigment, Subject Threshold, Bleed, Pigment Density, Pigment Grain, Keep Image Color, Light Subject, Bloom, Bloom Threshold, Bloom Size, Dreamy Blur, Blur Size, Light Leaks, Leak Count, Leak Size, Leak Drift, Leak Color A, Leak Color B, Haze, Haze Size, Haze Drift, Haze Color, Chromatic Distortion, Fringe Shape, Fringe Angle, Color Grade, Shadows, Midtones, Highlights, Saturation, Lifted Blacks, Film Grain, Grain Motion, Seed |  |

## Color & Image Adjustments (21)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Light** | Image, video | 7 | Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks |  |
| **Color & Vibrance** | Image, video | 7 | Temperature, Tint, Saturation, Vibrance, Red Intensity, Green Intensity, Blue Intensity |  |
| **Clarity & Dehaze** | Image, video | 4 | Clarity, Radius, Dehaze, Haze Patch Size |  |
| **Levels** | Image, video | 5 | Black Point, Midtone (Gamma), White Point, Output Black, Output White |  |
| **Curves** | Image, video | 1 | Curves |  |
| **Exposure** | Image, video | 3 | Exposure, Offset, Gamma Correction |  |
| **Hue / Saturation** | Image, video | 15 | Hue, Saturation, Lightness, Reds Hue, Reds Saturation, Yellows Hue, Yellows Saturation, Greens Hue, Greens Saturation, Cyans Hue, Cyans Saturation, Blues Hue, Blues Saturation, Magentas Hue, Magentas Saturation |  |
| **Color Balance** | Image, video | 10 | Cyan ↔ Red, Magenta ↔ Green, Yellow ↔ Blue, Cyan ↔ Red, Magenta ↔ Green, Yellow ↔ Blue, Cyan ↔ Red, Magenta ↔ Green, Yellow ↔ Blue, Preserve Luminosity |  |
| **Black & White** | Image, video | 8 | Reds, Yellows, Greens, Cyans, Blues, Magentas, Tint, Tint Color |  |
| **Photo Filter** | Image, video | 4 | Filter, Filter Color, Density, Preserve Luminosity |  |
| **Channel Mixer** | Image, video | 13 | From Red, From Green, From Blue, Constant, From Red, From Green, From Blue, Constant, From Red, From Green, From Blue, Constant, Monochrome |  |
| **Color Lookup** | Image, video | 3 | Look, .cube File, Intensity |  |
| **Selective Color** | Image, video | 2 | Ranges, Method |  |
| **Gradient Map** | Image, video | 3 | Gradient, Reverse, Intensity |  |
| **Recolor** | Image, video | 13 | Mode, Palette, Color 1, Color 2, Color 3, Color 4, Map Offset, Cycle Speed, Hue Rotate, Saturation, Contrast, Brightness, Mix |  |
| **Gradients** | Image, video | 12 | Mode, Step Size, Threshold, Shape Type, Gradient Angle, Bands, Drift Speed, Contrast, Saturation Boost, Grain, Background Color, Transparent Background |  |
| **Duotone** | Image, video | 4 | Shadow Color, Highlight Color, Contrast, Brightness |  |
| **Posterize** | Image, video | 3 | Levels, Contrast, Brightness |  |
| **Invert** | Image, video | 2 | Amount, Luminance Only |  |
| **Threshold** | Image, video | 15 | Mode, Level, Softness, Copy Contrast, Ink Density, Toner Grain, Grain Size, Toner Spread, Paper Texture, Copier Streaks, Dust & Noise, Copy Of A Copy, Seed, Dark Color, Light Color |  |
| **Posterized Gradient** | Image, video | 6 | Bands, Gradient, Band Gradient, Scale, Direction, Grain |  |

## VHS & Analog (5)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **VHS** | Image, video | 36 | Text Elements, Show Overlay, Timestamp Noise, Date Shows, Date (YYYY-MM-DD), Custom Stamp, Date Format, Time (HH:MM:SS), Time Format, Clock, Chroma Shift, Color Bleeding, RGB Separation, Desaturation, Analog Softness, Black Lift, Color Cast, Cast Color, Tracking Distortion, Tracking Speed, Tracking Band Size, Tracking Bars, Line Wobble, Wobble Frequency, Vertical Jitter, Head-Switch Noise, Tape Noise, Static, Signal Interference, Tape Damage, Damage Seed, Flicker, Scanlines, Interlacing, Vignette, Animate Signal |  |
| **CRT** | Image, video | 13 | Curvature, Convergence, Vignette, Bloom, Brightness, Phosphor Mask, Mask Strength, Mask Scale, Scanlines, Line Size, Noise, Flicker, Rolling Bar |  |
| **Holographic** | Image, video | 8 | Chroma Spread, Scanlines, Wave Amount, Wave Frequency, Speed, Saturation, Contrast, Base Tint |  |
| **Night Vision** | Image, video | 20 | Phosphor, Phosphor Color, Infrared Variation, Light Amplification, Brightness, Contrast, Glow, Glow Size, Glow Threshold, Phosphor Softness, Noise, Grain Size, Animate Noise, Sensor Sparkle, Scanlines, Scanline Size, Vignette, Tube Shape, Flicker, Seed |  |
| **Thermal Vision** | Image, video | 26 | Heat Comes From, Nearness Weight, Subject Weight, Warm Color Weight, Brightness Weight, Subject Runs Warm, Temperature, Heat Contrast, Sensitivity, Color Range Low, Color Range High, Heat Palette, Coldest, Cool, Warm, Hottest, Heat Glow, Sensor Softness, Sensor Resolution, Edge Detection, Edge Color, Sensor Noise, Heat Shimmer, Show Heat Scale, Show Crosshair, Seed |  |

## Background Removal (3)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **AirFx Key** | Image, video | 19 | Key Mode, What To Do, Key Color, Similarity, Tolerance, Foreground Preservation, Matte Contrast, Expand / Contract, Feather, Edge Smoothing, Refine Edges, Fine Detail From Matte, Spill Suppression, Edge Decontamination, Background, Background Color, Background Media, Background Blur, View | Selection and Auto Matte need a model loaded. Hair is good, not perfect. |
| **AirFx Cleanup** | Image, video | 2 | Reconstruction Strength, View | Shows nothing until a reconstruction exists. |
| **Invisible / Reveal** | Image, video | 20 | Activation, Mode, Subject From, Start Hidden, Interaction, Paint Only While Pinching, Brush Restores Instead, Brush Size, Brush Softness, Smoothness, Fade Transition, Painted Areas Return After, Hidden Areas Show, Reveal Color, Image Underneath, Learn Background Automatically, Distortion, Edge Glow, Edge Color, Shimmer |  |

## Depth & Focus (2)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **AirFx Depth** | Image, video | 25 | Depth Source, View, Depth Contrast, Invert Depth, Near Depth, Far Depth, Depth Smoothing, Depth Balance, Edge Refinement, Focus Distance, Focus Range, Focus Falloff, Blur Strength, Foreground Blur, Background Blur, Bokeh Shape, Highlight Boost, Depth Glow, Glow Color, Depth Color Grade, Near Tint, Far Tint, Depth Displacement, Parallax, Parallax Speed | Passes the image through until a depth map exists. |
| **Depth Particles** | Image, video | 43 | Particles, Size, Near Size, Far Fade, Place On, Drift, Seed, Color, Particle Color, Dim Image, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend | Needs a depth map. |

## Typography & ASCII (5)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **ASCII Renderer** | Image, video | 18 | Character Set, Custom Characters, Font Family, Bold, Cell Size, Font Size, Character Spacing, Character Density, Character Offset, Contrast, Brightness, Mapping Curve, Invert, Video Stability, Color Mode, Text Color, Background Color, Transparent Background |  |
| **Text Portrait** | Image, video | 9 | Text, Font, Row Height, Thinnest Letter, Heavier In Shadows, Light Text On Dark, Color, Ink, Background |  |
| **Chrome Type** | Image, video | 15 | Text, Font, Size, Position X, Position Y, Letter Spacing, Bevel Softness, Reflection Bands, Contrast, Flow, Metal, Metal Tint, Shadow, Dim Image, Transparent Background |  |
| **Kinetic Type** | Image, video | 13 | Text, Font, Size, Tracking, Position Y, Wave Height, Wave Length, Stretch, Weight Swing, Speed, Fill, Text Color, Bend | Weight changes in named steps unless the font is variable. |
| **Speech Typography** | Image, video | 26 | Words, Text From, Typed Text, Case, Body Tracking, Silhouette From, Threshold, Head, Torso, Arms, Legs, Hands, Newest Word On Fingertip, Font, Font Size, Text Density, Weight, Text Color, Newest Words, Highlight Newest, Background, Background Color, Dim Picture, Show Person Faintly, Text Animation, Animation Speed |  |

## Animate (9)

| Effect | Media | Controls | Parameters | Known limitation |
| --- | --- | --- | --- | --- |
| **Motion Trails** | Video | 4 | Trail Length, Trail Mode, Frame Tint, Tint Color | Keeps earlier frames: it develops during playback. |
| **Line Scan** | Video | 3 | Time Depth, Bands, Direction | Keeps earlier frames: it develops during playback. |
| **Liquid Transition** | Image, video | 11 | Progress, Auto Speed, Blob Size, Edge Softness, Drip Direction, Edge Glow, Seed, Edge Color, Target Color, Target Image, Reveal Transparency |  |
| **Sound Visualizer** | Image, video | 92 | Audio Source, Test Signal, Sensitivity, Bass Response, Treble Response, Release, Lowest Frequency, Highest Frequency, Palette, Low, Mid, High, Color Follows, Glow, Background, Dim Image, Background Color, Paper Color, Image Reacts, Main Form, Size, Position X, Position Y, Frequency Deformation, Organic Motion, Symmetry, Echo Contours, Echo Spread, Style, Lines, Perspective, Hide Lines Behind, Phase Offset, Phosphor Trail, Rings, Line Weight, Rotation Speed, Field, Density, Reaction, Opacity, Flow Particles, Particles, Flow Speed, Size, Beat Burst, Particle Look, Kinetic Type, Text, Font, Size, Position Y, Motion, Bass Tracking, Type Color, Animation Speed, Overall Scale, Grain, Vignette, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Particle Simulation** | Image, video | 71 | Particles Come From, Density, Pick Pixels Above, Prefer Dark Pixels, Emitter X, Emitter Y, Birth Rate, Lifetime, Dissolve, Breaks From, Speed, Flow Field, Flow Detail, Gravity, Gravity Direction, Turbulence, Return To Picture, Drag, At The Frame Edge, Particles Push Apart, Pointer, Pointer Strength, Pointer Radius, Hands Act As Pointers, Hand Tracking, Video Movement Pushes Particles, Sound Bursts, Particle Shape, Particle Size, Color, Particle Color, Fast Color, Trails, Glow (Add Light), Background, Dim Picture, Background Color, Seed, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Audio Shapes & Distortion** | Image, video | 67 | Audio Source, Test Signal, Sensitivity, Smoothing, Element, Shape, Points / Petals, Text, Font, Copies, Layout, Size, Position X, Position Y, Shape Deformation, Waveform Deformation, Scale Follows, Scale Amount, Rotation Follows, Rotation Amount, Movement Follows, Movement Amount, Fill Follows, Fill Amount, Picture Bend Follows, Bend Amount, Bend Style, Look, Color, Second Color, Line Width, Show On, Dim Picture, Background Color, Content, Text, Elements, Case, Icon, Files, Points, Inner Radius, SVG Path (0 to 100), Element Order, Font, Weight, Letter Spacing, Line Spacing, Alignment, Wrap After Letters, Color, Fill, Fill Shape, Outline, Outline Color, Treatment, Brightness, Contrast, Scale, Width, Height, Rotation, Random Rotation, Opacity, Offset X, Offset Y, Blend |  |
| **Slide** | Image, video | 17 | Planes, Plane Size, Orbit Radius, Orbit Tilt, Orbit Direction, Plane Facing, Cycles, Duration, Curve, Step Plane by Plane, Card Content, Card Images, Include Main Media, Corner Radius, Depth Fade, Shadow, Background Color | Faux 3D, not true perspective. |
| **Stack** | Image, video | 17 | Cards, Card Size, Rotation Range, Rotation Seed, X Shift Scale, Y Shift Scale, Depth Scale, Cycles, Duration, Speed Curve, Exit Direction, Card Content, Card Images, Include Main Media, Corner Radius, Shadow, Background Color | Faux 3D, not true perspective. |
| **Stutter** | Video | 10 | BPM, Division, Beat Offset, Pattern, Mode, Repeat Length, Chance, Seed, Gate Color, Gate to Transparent | Repeat and Freeze need moving footage. |

