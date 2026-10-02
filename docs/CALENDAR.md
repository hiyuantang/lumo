# Calendar and Reminders

Open **Calendar** from the Dock. The left rail switches between Calendar,
Reminders, and Accounts. No account is needed for local events or reminders.

Calendar provides day, week, month and year views. Click a date to open its day,
or use **+** to create an event. Double-click an empty month cell or time slot to
start an event there. Search filters the current date range. Click an event for
details, Edit or Delete. Local deletions offer Undo; editing or deleting a local
repeating event applies to the series. Google edits apply to the selected
occurrence. Read-only Google calendars have no editing controls.

Month view scrolls continuously through week rows, with the weekday headings
fixed at the top. Scroll down for later dates and up for earlier dates. Rows
follow your fingers and native momentum, then settle promptly to the nearest
week row. Box heights adapt to fit whole rows inside the window. The month
occupying the largest visible cell area determines both the title and which
dates are highlighted; an equal split keeps the current month. Today positions
the current month.
Week and Day scroll continuously through day columns. Horizontal movement
follows your fingers, then settles to the nearest day column. Week fits as many
whole day columns as the window allows, up to seven; Day shows one full-width
column. Hour rows also adapt to the window height and settle to whole rows after
vertical scrolling. Date headings and all-day events stay at the top, and the
time labels stay at the left. Resizing preserves the visible date and time.
Both views use the same prompt settling behavior as Month. Reduced motion
preserves finger tracking and settles without animation.
Year uses horizontal trackpad swipes to reveal the adjacent year continuously
and settle when input ends. Swipes over search, sidebars, details, editors or
Reminders do not change dates. Previous and Next remain available by keyboard
or mouse through the month arrows beside the sidebar's small calendar. These
arrows browse that small calendar without moving the main view; click a date to
open its day. Today returns the main view to the current date. Year marks Today
only in its own month, and date hover highlights remain circular.

Reminders belong to local Lumo lists. Today includes due and overdue reminders;
Scheduled, All, Flagged, Urgent and Completed provide other filters. Urgent means
high priority. Completion uses the checkbox on the right; clicking the title
opens details. Completing a repeating reminder creates its next scheduled item,
up to its repeat-end date. Reopening/recompleting the old item does not create a
duplicate successor. Reminders are never uploaded to Google.

Timed events and reminders have explicit time zones. Calendar views display
instants in the browser's time zone; details retain the item's zone. Repeats keep
local clock time across daylight-saving changes. Monthly/yearly repeats skip
invalid dates, such as February 31. All-day event end dates are exclusive in the
API, and inclusive in the editor. Date-only reminders alert at 09:00 in their
specified zone.

Local due reminders and event alerts appear in Lumo's notification cards while
the browser is open and signed in. They continue while the Calendar window is
closed. Polling is once per minute and browser background throttling can delay
it; alerts missed in the last 24 hours are claimed on return. This is not a web
push service and cannot alert after the browser closes. Google Calendar manages
its own event popup alerts.

## Connect Google Calendar

Lumo uses Google's official OAuth authorization-code flow and Calendar REST API.
It does not use an unofficial account connector, Google Tasks or reminder sync.
A Google Cloud project and Web application OAuth client are required:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or
   select a project. Enable the **Google Calendar API** in APIs & Services.
2. Configure Google Auth Platform's Branding, Audience and Data Access. For an
   External app in Testing, add your Google account as a test user. Request only
   `https://www.googleapis.com/auth/calendar.events` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
3. Create an OAuth client with application type **Web application**.
4. In **Authorized redirect URIs**, add the exact Callback URL shown in Lumo:
   `https://<your-lumo-host>/api/v1/calendar/google/callback`. For local
   development Google allows `http://localhost` or `http://127.0.0.1`, including
   the port, such as `http://127.0.0.1:51012/api/v1/calendar/google/callback`.
   Remote addresses require HTTPS. This server flow does not need a JavaScript
   origin entry for Google Identity Services.
5. In **Calendar → Accounts**, enter the Client ID, Client secret and Callback
   URL, then choose **Save setup**. Do not put the secret into source code,
   browser storage or chat.
6. Choose **Connect Google**. Google opens its official sign-in and consent page.
   Allow both Calendar permissions. Its return opens Calendar's Accounts page.
   Your Google calendars then appear alongside local calendars.

Use **Disconnect** to revoke Lumo's grant. Remote events are retained. Disconnect
before changing the OAuth client setup. Google may require app verification for
production access or restrict the lifetime of a testing app's authorization; see
[Google's web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server)
and [Calendar event concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars).
The server requires outbound HTTPS to Google's authorization, token, revocation
and Calendar API services. Failed Google reads keep local data available and
show an error with Retry.

## Pi extension

**Pi → Settings → Extensions → Calendar & Reminders** enables the built-in
extension. Pi can list items and calendars, add/edit/delete events and reminders,
restore local deletions, complete reminders, and create local calendars/lists.
It must read current IDs and revisions before modifying an existing item.

Read only mode allows listing. Ask mode requires approval for the exact
mutation; Approve for me uses the existing Pi permission rules. Disabling the
extension removes its tools. Google credentials and account setup are not
available through these tools.

The extension invokes the installed `lumod` executable directly with JSON on
stdin, as the same Linux user as the agent. It does not launch a shell or use the
privileged broker. `lumod calendar list` accepts `from`/`to` RFC3339 timestamps;
`lumod calendar change` accepts the typed change described in
[PROTOCOL.md](PROTOCOL.md#calendar-and-reminders).

## Storage and privacy

Local collections, items, deletion history, alert delivery records and Google
configuration/tokens are stored in the authenticated user's private
`~/.local/share/lumo/calendar/calendar.db`. SQLite transactions coordinate app
and Pi writes. Every edit has a revision to prevent lost changes. Google data
remains authoritative in Google; Lumo reads it directly and does not keep a
second desired-state database for those calendars.

The client secret and tokens stay on the server and are excluded from API
snapshots and Pi output. They are protected by the user's filesystem permissions,
not encrypted at rest; include this private directory in an appropriate server
backup policy. The browser receives only connection status and the public OAuth
URL. A one-use OAuth state and PKCE protect the code exchange. The gateway uses a
short-lived HttpOnly callback-only cookie for Google's return while retaining
Strict cookies for ordinary Lumo sessions.
