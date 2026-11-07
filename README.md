# Seams

A Teams client in the TwoDrive house style. Chats, group chats, channels, replies, reactions,
@mentions, edits, deletes and presence, sent through Microsoft Graph so they arrive in Teams as you.

Seams runs on one Microsoft Entra app registration (the application credentials). Each person signs in
once with their work account; from then on Seams reads and sends their messages with their own token,
so everyone else sees them in Teams exactly as if they had typed in Teams. While Seams is open and in
use, it keeps a presence session (Available, then Away when idle), as the Teams app does.
[docs/ENTRA.md](docs/ENTRA.md) explains the setup, the permissions, and why sending needs each person's
sign-in.

## Layout

Teams' structure in TwoDrive's look (after typesafe.ai: Inter Tight with JetBrains Mono labels, ink on
paper, square corners, hairlines, crop marks, a dot grid and one pink accent):

- **Rail**: Activity (unread), Chat, Teams.
- **List**: Unread / Channels / Chats filters, Favorites, Chats, then Teams and channels.
- **Conversation**: header with Chat / Shared / People tabs, day dividers, grouped messages (yours in
  ink on the right), a hover bar for reactions, edit, delete and quote, and a composer
  (`Enter` sends, `Shift+Enter` new line, `**bold**`, `_italic_`, `` `code` ``, `@` mentions,
  `↑` edits your last message).
- **Channels**: posts as framed cards with their replies and a Reply box.
- **You**: status menu (Available, Busy, Do not disturb, Be right back, Appear away, Appear offline),
  theme (system, light, dark), sign out.

## Run it

Example data, no Microsoft account needed:

```bash
npm run demo
```

With your organisation's Teams (after [docs/ENTRA.md](docs/ENTRA.md)):

```bash
cp .env.example .env
```

```bash
npm start
```

Then open `http://localhost:8090` and sign in with Microsoft. Node 22 or later; no npm dependencies.
`docker build -t seams .` builds an image that keeps its data in `/data`.

## How it works

```
browser ── /api/* (session cookie, x-seams header) ──> Seams server ──> Microsoft Graph
                                                         │  person's token: chats, channels, messages, status
                                                         │  app token: presence session
                                                         └─ data/seams.json: refresh tokens sealed with SEAMS_SECRET_KEY
```

| File | What it does |
| --- | --- |
| `server/auth.js` | Client credentials (secret or certificate), authorization code with PKCE, refresh. |
| `server/teams.js` | Chats, messages, channels, people, presence through Graph, trimmed for the client. |
| `server/http.js` | Static files with a strict CSP, sign-in routes, the `/api`. |
| `server/store.js` | The sealed token store and browser sessions. |
| `web/app.js` | The client. Teams message HTML goes through an allow-list sanitiser before it is shown. |
| `web/demo.js` | Example conversations for demo mode. |

Live updates poll: the open conversation every 5 seconds and the chat list every 20, only while the
tab is visible.

## Tests

```bash
npm test
```

The tests run the whole sign-in and send flow against a fake Microsoft: the state cookie check, sealed
refresh tokens, messages leaving with the person's token, mention filtering, the CSRF header, the
app-token presence session, and the image proxy's host check.

## Not yet

File attachments (upload to OneDrive, then reference), calls and meetings, the calendar, and change
notifications instead of polling.
