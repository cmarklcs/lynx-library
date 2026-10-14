# Lynx Library

First grade research library for Lausanne Collegiate School: first-grade facts, photos, videos,
Epic books, and citable sources for 40 animals and plants.

- `data/<topic>.json` — facts, sources, videos, photo credits for each topic
- `data/epic/<topic>.json` — Epic book suggestions
- `images/` — photos from Wikimedia Commons (credited on each page)
- `build.py` — run `python3 build.py` to rebuild `site/` after editing data
- `site/` — the published website (GitHub Pages deploys this folder on every push to `main`)
