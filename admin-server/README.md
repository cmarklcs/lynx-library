# Lynx Library settings server

A small separate server (no dependencies, Node 18+) that stores which topics are hidden.
It is not connected to Flex Bookings.

- `GET /api/visibility`: public, read-only list of hidden topics. The student site reads it.
- `POST /api/login`: takes the teacher password and returns an 8-hour token. After 10 wrong tries from one address, login is blocked for 15 minutes.
- `GET/POST /api/settings`: reads or changes the hidden list. Needs the token.
- The teacher panel is `site/admin.html`, linked as "Teacher settings" at the bottom of every page.
- Settings are saved in `$DATA_DIR/visibility.json` on the Railway volume.

Deploy: from this folder, run `railway up --service settings`.

## Railway variables
| Variable | Value |
|---|---|
| `TEACHER_PASSWORD` | The shared teacher password. Change it here to change it for everyone. |
| `SESSION_SECRET` | Long random text. Changing it locks every teacher out until they sign in again. |
| `SITE_URL` | `https://cmarklcs.github.io/lynx-library` |
| `DATA_DIR` | `/data` (the volume) |
