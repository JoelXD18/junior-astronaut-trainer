# Base Commander

**A Junior Astronaut Mission Trainer for kids aged 7–12, driven by the real Sun.**
Built solo by team RAMOS for the NASA Space Apps Challenge 2026 (Salamanca local event).

**▶ Play in the browser (no download, no account):** https://joelxd18.github.io/junior-astronaut-trainer/

## What it is

You command a base on the Moon or on Mars. Every day you get energy from the Sun and you decide where it goes:

- **Oxygen machine** – the crew breathes every day; an empty tank ends the mission.
- **Radiation shield** – blocks solar storms, but only on the day you power it.
- **Battery** – whatever you don't use is saved for the lunar night or a Martian dust storm.
- **Building** – more solar towers, batteries or oxygen tanks, also paid with energy.

There is no free option: energy you spend on one thing is not there for another. The game explains every hard word
(radiation dose, sol, solar storm…) the moment a child taps it, in English or Spanish.

### Real space weather
Every solar storm in the game is a **real solar flare recorded by NASA** (DONKI). The flare's class (C, M or X)
sets how strong the storm is, and **how active the real Sun was in the last 7 days sets how often storms come**.
Mission Control warns you when "scientists saw a flare", and after a storm tells you which real flare it was.
If NASA can't be reached, the game clearly says it is using a saved copy, not live data.

### Three modes
- **Escape** – your ship crash-lands. Send the rover for its 5 broken parts: each trip takes 1–2 days, outside there is
  no shield, and a strong storm damages the rover (it comes back late and must be repaired). The food lasts 21 days on the
  Moon and 18 sols on Mars. Repair
  the ship and fly home.
- **Survival** – keep the crew safe for 14 days.
- **Infinite** – last as long as you can and beat your record, with a world ranking per map and difficulty. There is no everyday background radiation here (only storms add dose), and storms slowly become more frequent.

The Moon has 7 days of sun and 7 of night (shortened from the real ~14 + 14 Earth days). Mars has less sunlight,
dust storms, slower warnings (messages from Earth take minutes) and a thinner radiation dose thanks to its air.
Mars is unlocked by winning on the Moon (or in Settings, for teachers and judges).

## NASA data used

- **NASA DONKI** (space weather, https://ccmc.gsfc.nasa.gov/DONKI/): the game asks the DONKI API live for the
  last 30 days of solar flares, solar particle events and geomagnetic storms, and keeps a saved library of one year
  of real flares in `data/donki-snapshot.json` (made with `node tools/update-donki.mjs`). Every storm in the game is
  one of those real flares: its class (C, M, X) sets its strength, and the real Sun's activity in the last 7 days
  sets how often storms come. If DONKI can't be reached, the game says the data is a saved copy, not live.
- **NASA OSDR RadLab** (https://visualization.osdr.nasa.gov/radlab/): real dose rates used in the game's rules and
  explanations (ISS ≈ 4.7 µGy/h in June 2020; Artemis I near the Moon ≈ 16.5 µGy/h median; Curiosity on Mars ≈
  6.1 µGy/h; CRaTER up to 61,829 µGy/h during the 24 Jan 2012 solar storm). Saved values, not live.
- **NASA 3D Resources**: 3D models (Apollo Lunar Module, Habitat Demonstration Unit, Astronaut, Mars 2020
  Perseverance Rover), Earth image and Mars map.
- **NASA LRO / LROC color map** (NASA SVS CGI Moon Kit, https://svs.gsfc.nasa.gov/4720): the real Moon around the
  base, which sits at the Apollo 16 landing site. The Mars base sits at Jezero crater.
- Facts from NASA missions in the texts: MOXIE (oxygen made on Mars, 2021), lunar night length, Neil Armstrong.

## Credits and sources

- 3D models and Earth texture: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources)
  (Apollo Lunar Module, Habitat Demonstration Unit, Astronaut, Mars 2020 Perseverance Rover).
- 3D engine: [three.js](https://threejs.org) (MIT license).
- World ranking (Infinite mode): [Supabase](https://supabase.com) free tier. Only a random player code, a nickname picked from word lists, the map, the difficulty and the days are stored; no personal data.
- Music (Pixabay Content License):
  [Synthwave No Copyright](https://pixabay.com/es/music/pop-sintetizado-synthwave-no-copyright-630654/) by MiroMaxMusic,
  [Background Music](https://pixabay.com/es/music/sintetizador-background-music-618629/) by JonasBlakewood,
  [The Grid Part](https://pixabay.com/es/music/electr%C3%B3nico-the-grid-part-514948/) by pietiX,
  [Robo Cop (Synthwave)](https://pixabay.com/es/music/sintetizador-robo-cop-synthwave-100bpm-117s-12714/) by Sub_Clair,
  [Metropolis of Progress (Cinematic Orchestral)](https://pixabay.com/es/music/titulo-principal-metropolis-of-progress-cinematic-orchestral-298820/) by Luis_Humanoide.
- Fonts: Lilita One and Nunito (Google Fonts, SIL Open Font License).
- Voices: generated with Google Gemini text-to-speech (AI voices Charon, Kore and Leda), recorded once with `tools/make-voices-gemini.mjs`; the radio lines get a radio-interference effect with ffmpeg. If a clip is missing, the browser's own speech synthesis reads the line.
- Sound effects (engine, landing, crash, launch, alarm, storm, building, rover): made in code with the Web Audio API, no sound files.
- Game idea and design: JoelXD18 (team RAMOS).

## Use of AI

The game idea, the modes, the look and every design choice are the creator's. An AI coding assistant
(**Claude Code, by Anthropic**) wrote the code under his direction, offered options with pros and cons when he asked
(he chose), looked up and summarised the NASA data sources, wrote the English/Spanish texts and the radio script,
and balanced the numbers by simulating thousands of games. **All code in this repository was written with AI
assistance.** No AI-generated images or music are used. The voices (in the game and in the demo video narration) are AI-generated with Google Gemini text-to-speech from texts written for the game.

## Run locally

It is a static website: serve the folder with any web server (for example `npx http-server`) and open it.
License: MIT.
