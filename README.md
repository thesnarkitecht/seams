# Seams

Self-hosted team chat with video calls and AI agents. One small Node server, one SQLite file, no build step.

- **Chat**: 1:1 DMs, group chats, team channels, Markdown, emoji reactions, edit/delete, file sharing, link previews, quick replies, typing indicators, presence, unread counts, favorites, search
- **Tabs per conversation**: Chat · Shared (files and links) · Notes (shared, live-synced) · Recap (activity plus one-click AI recap)
- **Calls**: audio/video calls and screen sharing over WebRTC (peer-to-peer mesh, best for small groups)
- **Agents**: bots that live in your chats like teammates (see below)
- Works on desktop and phone browsers, with light and dark themes

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. The first account you create becomes the admin. Everyone joins **Everyone › General**.

Or with Docker:

```bash
docker compose up -d
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SEAMS_DATA` | `./data` | Where the database and uploaded files live (back this up) |
| `SEAMS_OPEN_SIGNUP` | `true` | Set `false` to stop new sign-ups once your team is in |
| `ANTHROPIC_API_KEY` | none | Turns on built-in Claude agents |
| `SEAMS_ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers for calls, e.g. `[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]` |

Requires Node 22.13 or newer, for the built-in `node:sqlite`.

**Video calls outside localhost need HTTPS**, because browsers only allow the camera on secure origins. Put Seams behind a reverse proxy such as Caddy (`caddy reverse-proxy --from chat.example.com --to localhost:3000`), which handles certificates and WebSockets for you. Calls use a public STUN server. People behind strict corporate NATs may also need a TURN server.

## Put it online

**Render (easiest):** `render.yaml` is included. In Render, choose **New → Blueprint**, pick this repo, and set `ANTHROPIC_API_KEY` if you want Claude agents. You get an HTTPS URL, so calls work right away, and the database lives on a 1 GB disk. Disks need a paid plan.

**Any VPS:** install Docker, run `docker compose up -d`, then put Caddy in front for HTTPS.

## Calls

Calls connect people directly (WebRTC). The ringing screen lets people answer with video or audio only, or decline. A green outline shows who is speaking, and muted people show a crossed-out mic. Shortcuts: **M** mutes, **V** toggles the camera. Calls work best with up to about 6 people. If people on locked-down networks can't connect, add a TURN server via `SEAMS_ICE_SERVERS`.

## Agents

Open **Agents → +** in the app. Every agent gets a DM with you. Add it to any chat with the add-people button. In DMs and group chats it answers every message; in channels it answers only when someone @mentions it. Agents never reply to other agents, so they can't get into reply loops.

There are three kinds:

1. **Claude**: built in. Give it instructions, and it replies using the Claude API. Needs `ANTHROPIC_API_KEY`.
2. **Webhook**: Seams POSTs each message to your URL, then posts your reply.
   ```json
   { "agent": {...}, "convo": {"id": 1, "kind": "dm", "name": null}, "message": {"body": "hi", ...}, "history": [...] }
   ```
   Answer with `200 {"text": "reply"}`, or `204` to stay quiet. Each request carries the header `x-seams-signature: sha256=<HMAC-SHA256 of the raw body, keyed with the agent secret>`.
3. **API bot**: your own program connects with the agent token.
   ```bash
   curl -X POST http://localhost:3000/api/convos/CONVO_ID/messages \
     -H "Authorization: Bearer AGENT_TOKEN" -H "content-type: application/json" \
     -d '{"body":"Build finished ✅"}'
   ```
   ```js
   const ws = new WebSocket('ws://localhost:3000/ws?token=AGENT_TOKEN');
   ws.onmessage = (e) => console.log(JSON.parse(e.data)); // {type:"message", message:{...}}
   ```

Any agent kind can post with its token, so a webhook agent can also send messages on its own. An agent token can only read and post in conversations the agent belongs to. It cannot manage users or other agents.

## Development

```bash
npm test
```

The server is in `server.js`, the agent runners are in `agents.js`, and the web client is in `public/` (plain HTML, CSS and JS).
