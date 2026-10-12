# Commit City

Your GitHub contribution history, rebuilt as a 3D city you can fly through in the browser.

Every day you coded becomes a building. Busier days make taller, brighter towers, and each week forms a street. Type any GitHub username and watch their year rise out of the ground.

## Features (planned)

- Enter any GitHub username to generate their city
- One building per day, height and glow based on contribution count
- Fly-through camera (drag to orbit, scroll to zoom, WASD to fly)
- Hover a building to see the date and commit count
- Day/night toggle, with lit windows at night
- Share link: `?user=<name>` opens that person's city directly
- Export a screenshot of your city

## Tech

- [Three.js](https://threejs.org/) for 3D rendering
- Plain HTML/JS with no build step, hosted on GitHub Pages
- Contribution data from a public contributions API, with a demo dataset as a fallback

## Run locally

Open `index.html` through any static server, for example:

```bash
npx serve .
```
