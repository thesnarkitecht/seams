# Setting up the app registration

Seams uses one Microsoft Entra app registration. Its client ID and secret (or certificate) are the
application credentials that the Seams server holds. Each person signs in once with their own work
account, and Seams uses that sign-in to read and send their messages.

## Why sending needs each person's sign-in

Microsoft Graph does not let an app-only token post a chat or channel message as a person. The only
app-only route (`Teamwork.Migrate.All`) is for one-time imports into a team in migration mode. So:

| What | Token | Why |
| --- | --- | --- |
| Read and send chats, channel posts, replies, edits, deletes, reactions | The person's own (delegated) | Teams shows them as the sender, the same as typing in Teams. |
| Seams' presence session (Available while you're using Seams, Away when idle) | The app's own (application) | This is how Teams clients keep a presence session. Falls back to the person's token if the application permission isn't granted. |
| Your status menu (Busy, Do not disturb, Be right back…) | The person's own | Sets your preferred status, as Teams' status menu does. |

The person signs in once. Their refresh token is stored encrypted with `SEAMS_SECRET_KEY` and renewed
on use, so they stay signed in until they sign out, an admin revokes the session, or it goes unused
for 90 days.

## Steps

1. **Register the app.** Entra admin center → Applications → App registrations → New registration.
   - Name: `Seams`
   - Supported account types: *Accounts in this organizational directory only*
   - Redirect URI: platform **Web**, `PUBLIC_URL/auth/callback` (for example
     `https://seams.example.com/auth/callback`, or `http://localhost:8090/auth/callback` for local use)
2. **Add a credential.** Certificates & secrets → New client secret (or upload a certificate and set
   `CLIENT_CERT_PATH`). Put the secret value in `CLIENT_SECRET`.
3. **Add API permissions** (Microsoft Graph):

   Delegated:
   `User.Read`, `User.ReadBasic.All`, `Chat.ReadWrite`, `ChatMessage.Send`, `Team.ReadBasic.All`,
   `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`, `Presence.Read.All`,
   `Presence.ReadWrite`, `offline_access`, `openid`, `profile`, `email`

   Application:
   `Presence.ReadWrite.All` (optional; set `APP_PRESENCE=0` if you leave it out)

4. **Grant admin consent** for the organisation. `ChannelMessage.Read.All` (delegated) and every
   application permission need it.
5. Copy the **Directory (tenant) ID** and **Application (client) ID** from Overview into `TENANT_ID`
   and `CLIENT_ID`.
6. Generate `SEAMS_SECRET_KEY`, set `PUBLIC_URL`, and start Seams. Open it and choose
   **Sign in with Microsoft**.

## Running it for several people

Anyone in the tenant can sign in unless `ALLOWED_USERS` lists who may. Each person only ever sees and
sends as themselves: a browser session maps to one person's own Microsoft sign-in. Serve Seams over
HTTPS (behind a reverse proxy) when it isn't on `localhost`; cookies are then marked `Secure`.
