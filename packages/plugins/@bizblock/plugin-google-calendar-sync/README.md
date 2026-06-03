# BizBlock Google Calendar Sync

PoC plugin for Google OAuth and Google Calendar list retrieval.

## Scope

- Save Google OAuth client ID / secret
- Start Google OAuth for the logged-in NocoBase user
- Receive OAuth callback
- Store access / refresh token for the logged-in user
- Fetch `calendarList` and display calendar IDs

This PoC stores OAuth tokens as plain text in NocoBase DB. Encrypt token fields before production use.
