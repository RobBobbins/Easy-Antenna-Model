# Easy Antenna Model

A simple antenna modeler that runs in the browser. Pick an antenna, set its size and height,
and see its SWR, gain and 3D radiation pattern.

Antennas: dipole, inverted V, end-fed half wave, ground plane vertical, and a 3-element
ground plane array.

## Run it on your computer

Needs Node.js.

```
cd app
npm install
npm run dev
```

Then open http://localhost:5173/ in a browser.

- `npm run build` makes the finished site in `app/dist/`.
- `npm test` runs the engine tests.

## The antenna engine

The calculations are done by nec2c (NEC-2 in C), compiled to WebAssembly from the unmodified
source. The source is in `engine/nec2c` (a link to https://github.com/KJ7LNW/nec2c at the
version used). The compiled engine is already in `app/public/engine/`; `engine/build.bat`
rebuilds it with Emscripten.

To get the engine source after cloning:

```
git submodule update --init
```

## Licence and credits

Easy Antenna Model is free software under the GNU General Public License, version 3 or later
(`app/LICENSE`).

- **Antenna engine:** nec2c, the NEC-2 antenna code translated to C by Neoklis Kyriazis (5B4AZ)
  and maintained by KJ7LNW. https://github.com/KJ7LNW/nec2c. GPL v3. Compiled for the browser
  from the unmodified source.
- **Star positions, brightness and colours:** Yale Bright Star Catalogue, 5th revised edition
  (BSC5P), from NASA HEASARC. https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html.
  Public domain.
- **Constellation lines:** d3-celestial by Olaf Frohn. https://github.com/ofrohn/d3-celestial.
  Copyright (c) 2015 Olaf Frohn, BSD 3-Clause licence (full text in
  `app/public/sky/CONSTELLATIONS-LICENSE.txt`).
- **3D graphics:** three.js, MIT licence. https://threejs.org
