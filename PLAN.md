# Build plan

1. `index.html` + `main.js`: Three.js scene (pinned CDN version), ground plane, lights, OrbitControls.
2. Data layer: fetch a user's last-year contributions from a public contributions API (no token needed); fall back to bundled `demo-data.json` when it fails.
3. City generator: 53 weeks x 7 days grid; building height = f(count), color ramp by intensity, empty days as low plots/parks.
4. Interaction: hover tooltip (date + count), username input, `?user=` URL param.
5. Polish: day/night toggle with emissive windows, fly-in intro animation, screenshot export, mobile touch controls.
6. GitHub Pages deploy via Actions; add a GIF to the README.
