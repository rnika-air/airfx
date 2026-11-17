AirFx showcase media
====================

The intro, log-in and About previews rotate through the files listed in
showcase.json, each with a different AirFx effect running on it live.

To add or change media:
  1. Put the file in this folder (photo: JPG; video: MP4/H.264; gif: GIF).
  2. Add a line for it to showcase.json:
     media   for the live showcase, e.g. { "type": "photo", "src": "photo-11.jpg", "effect": "halftone" }
     stills  for the still tiles, e.g. { "src": "photo-12.jpg", "effect": "moire" }
     Give every picture its own effect, and use each effect only once.
     Photos can have "focus": [x, y] (0 to 1) to choose what stays in frame,
     and "zoom" to crop in closer.

Keep files small: photos under 1 MB (about 1600 px wide), videos 5 to 15 s at
720p with no sound (under 3 MB), GIFs under 3 MB. Videos and GIFs show best
cropped to a tall 4:5 frame. Only use media you own or may publish: everything
here is public. Cloudflare Pages rejects any single file over 25 MB.

Original camera files belong in showcase-src/ (not uploaded), not here.
