# BizBlock Google Calendar Sync

Google OAuth and Google Calendar schedule synchronization plugin for BizBlock.

## Scope

- Save Google OAuth client ID / secret
- Start Google OAuth for the logged-in NocoBase user
- Receive OAuth callback
- Store access / refresh token for the logged-in user
- Fetch `calendarList` and display calendar IDs
- Manage schedules from a user-facing NocoBase screen
- Sync schedule create / update / delete operations with Google Calendar
- Pull events from Google Calendar into NocoBase schedules

This plugin currently stores OAuth tokens as plain text in the NocoBase DB. Encrypt token fields before production use.
