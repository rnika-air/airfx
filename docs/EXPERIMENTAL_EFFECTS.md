# Experimental Effects (4.2)

Neo Y2K was removed in 4.4.

Each effect is an original implementation of a technique, not a copy of a post. The references were read from Instagram's public embed pages, without signing in.

## What each reference showed

| Effect | Reference | What was visible | What that changed |
| --- | --- | --- | --- |
| Dreamy | synkitnet, carousel slide 4 | A still: a dark blue figure on white, with grainy pigment spreading from it. Panel labels show Paper Color, Pigment Saturation and Pigment Ramp. | Dreamy gained a Pigment Bloom look next to the soft photographic one in the brief. |
| Sound Visualizer | beatsbycryptic, reel | Cover frame only: soft colour circles on grainy off-white, rows of dots, a large arc, a thin ring with a hand. | 4.2 added the Soft Orbits layer and paper background. The 4.4 redesign keeps that paper-and-orbits look as the Swiss Orbits preset, and adds organic forms, ridgelines, an XY scope, kinetic type and flow particles. |
| Image To Pixel Art | fishuus_lens, reel | Cover frame only: a chunky pixel spiral with a photo showing through it on white, and the same spiral drawn over the photo. | Added Pixel Cutout, with its own coarse pixel size. |
| Glitch 2.0 | ty200641, reel | Cover frame only, a Photoshop tutorial: a blown-out hand on black, red and blue fringing, fine scanlines. | Added Signal Burn and the Burnt Feed preset. Steps of the tutorial could not be seen. |
| Ink Bleed | None given | | Built from the brief. |

## Not duplicates

| New | Nearest existing | Why it is separate |
| --- | --- | --- |
| Dreamy | Glow & Bloom, Light Leak, Chromatic Aberration | One look with a shared order and master amount, plus Pigment Bloom, which nothing else does. |
| Ink Bleed | Motion Trails, Datamosh | Measures direction of motion and runs a fluid simulation. Trails only blend frames. |
| Sound Visualizer | Audio links | Links move a slider. This draws the waveform and spectrum. |
| Image To Pixel Art | Pixel Crusher, Gameboy, Dithering Lab | A complete pixel-art tool. Reuses Dithering Lab's palette extraction and palettes. |
| Glitch 2.0 | Glitch, Pixel Sort, Datamosh | Shared timing and one damage pattern that every stage follows. |

## Custom content

- **Ink Bleed:** text, icons, SVG or PNG as the ink shape.
- **Sound Visualizer:** as the main form (with echoes) and as particles.
- **Image To Pixel Art:** as pixels, or as the cutout shape.
- **Dreamy and Glitch 2.0:** colours and text are not part of what they do, so there is no content block. Glitch 2.0 has a noise tint.

## Performance

640 × 360 with default settings, one effect, this PC: Ink Bleed about 31 ms per frame. On a 640 px photo: Pixel Art 3 ms, Dreamy 28 ms, Glitch 2.0 30 ms, Sound Visualizer 68 ms with every default layer and the first frame's setup. The adaptive preview lowers size while playing if needed. Export renders every frame at full size.

Ink Bleed simulates on a fixed 300 px grid, so preview size does not change its look and the ink itself stays soft at 4K.
