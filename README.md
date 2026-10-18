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

GNU General Public License, version 3 or later (`app/LICENSE`).
Credits for nec2c, the Yale Bright Star Catalogue, d3-celestial constellation lines and
three.js are in `app/public/CREDITS.txt`.
