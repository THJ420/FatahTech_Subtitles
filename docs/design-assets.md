# Landing page asset

`public/creator-hero-target.png` is the hero photograph vendored from the approved design reference and used for the landing page's editor and feature illustrations. The image is a fictional creator, not a testimonial or the app's author. All surrounding interface illustrations are HTML and CSS components.

Generation prompt:

> Use case: photorealistic-natural. Asset type: photograph used inside a subtitle editor product demo on a website. Create one landscape 3:2 photo, natural editorial camera frame of an adult male content creator age 28-35 with dark wavy short hair and light stubble, plain black crewneck t-shirt, speaking to camera with one hand lightly gesturing. Frame chest-up with entire head and shoulders visible, centered. Warm modern home recording studio, amber desk light, blurred green houseplants and shelves in background, cinematic but realistic warm daylight, authentic friendly focused expression. High detail face, natural skin. No text, no captions, no logos, no UI, no border, no watermark. The photo will be cropped for landscape and portrait previews.

`public/vlad-pfp.jpg` is the existing author image. The redesign retains it unchanged.

## Background removal comparison

`public/creator-background-removed.webp` is the after-side illustration for the Background Removal card, paired with `public/creator-hero-target.png` so both sides show the same person. It is a decorative preview, not an alpha-mask asset. Both comparison images use the same full-frame crop, with the after layer clipped at 55%, so the person remains visible on both sides.

Edit prompt:

> Edit target: the supplied creator-studio photograph. Remove only the room/background, retaining the exact same man, hair, face, black T-shirt, arms, and hand with true transparent alpha outside his silhouette. Preserve original 1200 x 800 canvas, exact subject position, scale, pose, colors and framing so this cutout overlays the original photograph perfectly without any seam in a before/after comparison. Do not crop, recenter, redraw, beautify, add shadow, or change the person. Output a transparent PNG asset for a website. No checkerboard baked into the image. Save the output file.
