# Junior Astronaut Mission Trainer

A browser game for kids aged 7–12: run a base on the Moon or Mars and share out energy, oxygen and radiation
shielding. Every choice has a cost. Built for the NASA Space Apps Challenge 2026.

**Play:** https://joelxd18.github.io/junior-astronaut-trainer/

## NASA data used

- **NASA DONKI** (space weather, https://ccmc.gsfc.nasa.gov/DONKI/): the game asks the DONKI API live for the
  last 30 days of solar flares, solar particle events and geomagnetic storms, and keeps a saved library of one year
  of real flares in `data/donki-snapshot.json` (made with `node tools/update-donki.mjs`). Every storm in the game is
  one of those real flares: its class (C, M, X) sets its strength, and the real Sun's activity in the last 7 days
  sets how often storms come. If DONKI can't be reached, the game says the data is a saved copy, not live.
- **NASA OSDR RadLab** (https://visualization.osdr.nasa.gov/radlab/): real dose rates used in the explanations
  (ISS ≈ 4.7 µGy/h in June 2020; Artemis I near the Moon ≈ 16.5 µGy/h median; CRaTER up to 61,829 µGy/h on
  24 Jan 2012). Saved values, not live.
- **NASA 3D Resources**: 3D models and Earth texture.

## Credits and sources

- 3D models and Earth texture: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources)
  (Apollo Lunar Module, Habitat Demonstration Unit, Astronaut).
- 3D engine: [three.js](https://threejs.org) (MIT license).
- Game idea and design: JoelXD18. Code written with the help of an AI assistant (Claude, by Anthropic).
