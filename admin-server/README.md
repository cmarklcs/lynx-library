# Lynx Library settings server

A small separate server (no dependencies, Node 18+) that lets teachers show or hide topics.
It is not connected to Flex Bookings.

- `GET /` – teacher checklist (Microsoft sign-in, @lausanneschool.com only)
- `GET /api/visibility` – public, read-only list of hidden topics that the student site reads
- Settings are saved in `$DATA_DIR/visibility.json` (put this on a Railway volume)

Run locally with a fake sign-in: `npm run dev`, then open http://localhost:8080.

## Railway variables
| Variable | Value |
|---|---|
| `MS_TENANT_ID` | Lausanne directory (tenant) ID |
| `MS_CLIENT_ID` | Application (client) ID of the **Lynx Library** app registration |
| `MS_CLIENT_SECRET` | Client secret from that app registration (keep private) |
| `SESSION_SECRET` | Any long random text |
| `BASE_URL` | This server's public address, e.g. `https://lynx-library-settings.up.railway.app` |
| `SITE_URL` | `https://cmarklcs.github.io/lynx-library` |
| `DATA_DIR` | `/data` (the volume's mount path) |
