# Crimson Grid Interactive Atlas

Source for the Crimson Grid map viewer, on the dedicated `atlas-pages` branch.

The website includes Oakland, San Fangcisco, Westfield Mall and their Umbra layers, named-area search, and clickable stairs, ladders, manholes, transfers and elevator stops. Following a link preserves zoom and positions the destination exactly where its source marker was on screen. Back restores the previous view.

## Deployment

The `Publish Crimson Grid Atlas` workflow renders all 18 layers from game-source commit `75c11f5496d4b691fc71c74186dd843ba07f436b`, extracts area definitions and transitions, verifies the 727 directed links, and deploys GitHub Pages. The renderer is pinned to SpacemanDMM suite 1.12 and verified by SHA-256. Generated tiles are deployment artifacts; the game branch does not need image commits.

For the initial deployment, GitHub Actions must be enabled for this fork and **Settings → Pages → Source** must be set to **GitHub Actions**. Pushes to `atlas-pages` trigger a build. There are no scheduled updates.

## Rebuild locally

Install Python 3.12 and `pip install -r tools/requirements.txt`, then follow the exact source-download, renderer and build commands in `.github/workflows/pages.yml`. Serve `_site` using `python -m http.server 8000 --directory _site`.

## Map fidelity

Coordinates/Z numbers are local to the map files. Runtime loading can offset them. This is a static atlas; live doors, locks, elevator availability, randomized objects and round changes are not simulated. Elevator links represent mapped call stops. Gray portal endpoints are one-way arrivals. The configured city/Umbra map pairs are included; admin maps, unconfigured adventure maps and runtime-generated levels are excluded.

Transfer points use exact paired IDs; ladders use vertical connection rules; stair destinations use the terminating step, direction, vertical map traits and upper landing geometry. See `tools/build_data.py`. Desktop/mobile navigation and alignment were verified before publishing; see `validation.json`.

Map art and source attribution: [ATTRIBUTION.md](ATTRIBUTION.md). Atlas code: AGPL v3, [LICENSE](LICENSE).
