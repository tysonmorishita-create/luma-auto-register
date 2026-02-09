# Luma Auto Register - Chrome Extension

Automatically register for multiple Luma events from calendar pages. Perfect for registering for hundreds of events quickly and efficiently. Supports **team workflows** with a shared Google Sheets database to track registrations across multiple people.

## Features

- 🔍 **Automatic Event Discovery**: Scan Luma calendar pages and extract all event links
- ✅ **Bulk Selection**: Select which events to register for with checkbox interface
- ⚡ **Parallel Processing**: Register for multiple events simultaneously (2-5 tabs at once)
- 📊 **Real-time Progress**: Live dashboard showing registration progress and results
- 🛡️ **Smart Detection**: Automatically detects already registered events, full events, and errors
- 📝 **Activity Logging**: Detailed logs of all registration attempts
- 💾 **Export Results**: Download CSV report of all registration attempts
- ⏸️ **Pause/Resume**: Control the registration process at any time
- 🎯 **Configurable**: Adjust parallel tabs and delay between registrations
- 🗄️ **Google Sheets Database**: Track registrations in a shared spreadsheet for team coordination
- 👥 **Multi-Person Support**: Each team member's registrations tracked separately by email
- 📅 **Per-Calendar Organization**: Automatic tabs for each calendar/conference (CHK2026, ethdenver, etc.)
- 🤖 **Cloudflare/Turnstile Bypass**: Automatic human-like click simulation to bypass CAPTCHA challenges

## Prerequisites

- Google Chrome or any Chromium-based browser (Edge, Brave, etc.)
- Active Luma account (you must be logged in)
- Luma profile with saved name/email (for one-click registration)

## Installation

### Method 1: Load Unpacked Extension (Development)

1. **Download the extension files**
   - Clone or download this repository

2. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/`
   - Or Menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle "Developer mode" in the top right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the `luma-auto-register` folder
   - The extension icon should appear in your toolbar

### Method 2: Package and Install (Optional)

1. On the Extensions page, click "Pack extension"
2. Select the `luma-auto-register` folder
3. Install the generated `.crx` file

## Setup

### Step 1: Prepare Your Luma Account

Before using the extension, ensure:

1. **You're logged into Luma** in your Chrome browser
2. **Your profile is complete** with name and email
3. **Test manual registration** on one event to ensure Luma has your info saved
   - If Luma offers "one-click registration", you're ready!
   - If you have to fill out forms each time, the extension may have issues

### Step 2: Configure the Extension

1. Click the extension icon and go to **Settings**
2. Enter your **Registration Email** - this is how your registrations are tracked
3. Enter your **Registration Name** - used for form filling
4. Enter the **Google Sheets API URL** (get this from your team admin - see below)
5. Click **Save Settings**

### Step 3: Google Sheets Database Setup (Admin Only)

The extension uses Google Sheets as a shared database. One person sets this up for the team:

#### Create the Google Apps Script API:

1. **Create a new Google Sheet** for tracking registrations
2. Go to **Extensions > Apps Script**
3. Delete the default code and paste the contents of `google-apps-script.js` from this repo
4. Click **Deploy > New deployment**
5. Choose **Web app** as the type
6. Set **Execute as**: "Me"
7. Set **Who has access**: "Anyone" (or "Anyone with Google account" for more security)
8. Click **Deploy** and copy the Web App URL
9. Share this URL with your team members to put in their extension settings

#### What the Database Tracks:

| Column | Description |
|--------|-------------|
| event_url | The Luma event URL (used for matching) |
| title | Event name |
| event_date | When the event occurs |
| person_email | Who registered (case-insensitive matching) |
| person_name | Name used for registration |
| calendar | Which calendar/conference (auto-detected from URL) |
| registered_at | Timestamp of registration |

#### How Registrations Are Matched:

When scanning events, the extension checks the database using:
- **Event URL** (exact match)
- **Person Email** (case-insensitive)

If a match is found, that event shows as "Registered" for that person. Name is NOT used for matching, so slight name variations won't cause duplicates.

#### Automatic Calendar Organization:

The database automatically creates separate tabs based on the calendar URL:
- Scanning `lu.ma/calendar/CHK2026` → Creates "CHK2026" tab
- Scanning `lu.ma/ethdenver` → Creates "ethdenver" tab
- A **"Master"** tab contains all registrations across all calendars

This keeps registrations organized by conference/event series.

#### Migrating Existing Data (Optional):

If you have registration data in an old format (e.g., tabs named "VITO PENDING", "MICHAEL PENDING"), you can migrate it:

1. Open the Apps Script editor (Extensions > Apps Script)
2. Find the `MIGRATION_CONFIG` array near the bottom
3. Update it with your old tab names and person info:
   ```javascript
   const MIGRATION_CONFIG = [
     { oldTabName: 'VITO PENDING', personEmail: 'vito@company.io', personName: 'Vito', targetCalendar: 'CHK2026' },
     { oldTabName: 'MICHAEL PENDING', personEmail: 'mike@company.io', personName: 'Michael', targetCalendar: 'CHK2026' }
   ];
   ```
4. Run `previewMigration()` first to see what would be imported (dry run)
5. Run `migrateOldData()` to perform the actual migration
6. Only checked rows (Column C = true) will be imported

## Team Onboarding

For team members joining an existing setup:

1. **Download the extension** from GitHub (Code > Download ZIP)
2. **Extract** the ZIP file
3. **Load in Chrome**: Go to `chrome://extensions/`, enable Developer Mode, click "Load unpacked", select the extracted folder
4. **Configure settings**: Click extension icon > Settings
   - Enter YOUR email address (this identifies your registrations)
   - Enter your name
   - Enter the **Google Sheets API URL** (get this from your team admin)
5. **Test**: Scan a calendar page and verify it shows previously registered events

That's it! All registrations will now be tracked in the shared database.

## Usage

### Step 1: Find a Calendar Page

Navigate to a Luma calendar page with multiple events, such as:
- `https://luma.com/consensus?k=c&period=past`
- `https://luma.com/[any-calendar-name]`

Copy the full URL.

### Step 2: Open the Extension

Click the extension icon in your Chrome toolbar to open the popup.

### Step 3: Scan for Events

1. Paste the calendar URL into the input field
2. Click "Scan Events"
3. The extension will:
   - Open the calendar page
   - Extract all event links
   - Display them in a list

### Step 4: Select Events

1. Review the list of found events
2. Use "Select All" or manually check events you want to register for
3. Use "Deselect All" to uncheck everything

### Step 5: Configure Settings

- **Parallel Tabs**: How many events to process at once (1-5)
  - Recommended: 2-3 to avoid rate limiting
  - Higher = faster but more risk of detection
  
- **Delay Between**: Seconds to wait between batches (3-30)
  - Recommended: 5-10 seconds
  - Add randomization to appear more human

### Step 6: Start Registration

1. Click "Start Registration"
2. Watch the progress in real-time:
   - Progress bar shows completion
   - Success/Failed/Pending counters update live
   - Activity log shows each registration attempt

### Step 7: Monitor and Control

- **Pause**: Temporarily stop processing (can resume later)
- **Stop**: Cancel all remaining registrations
- **Export Results**: Download a CSV file with all results

### Step 8: Review Results

After completion:
- View success/failure statistics
- Check the activity log for details
- Export results for your records
- Click "Start New Batch" to process more events

## How It Works

### Event Discovery Phase

1. Extension opens the calendar page in a background tab
2. Scrapes all event links matching `lu.ma/[event-id]` or `luma.com/[event-id]`
3. Filters out non-event pages (calendars, profiles, etc.)
4. Extracts event titles, URLs, and dates (including relative dates like "Tomorrow")
5. **Checks Google Sheets database** to see which events you've already registered for
6. Marks events as "Registered", "Available", or "NEW" based on database status
7. Presents them to you for selection (registered events shown greyed out)

### Database Check

When scanning, the extension queries the Google Sheets database:
- **Registered**: You (your email) have already registered for this event
- **Available**: Someone else on the team registered, but you haven't
- **NEW**: No one has registered for this event yet

### Registration Phase

For each selected event:

1. Opens event page in a background tab
2. Waits for page to fully load
3. Looks for registration button ("Register", "RSVP", "Sign Up", etc.)
4. Clicks the button
5. Waits for form/modal to appear
6. Clicks submit button
7. Waits to detect success or failure
8. **Saves successful registration to Google Sheets database**
9. Closes the tab and moves to next event

### Success Detection

The extension considers registration successful if it detects:
- "You're going"
- "You're registered"
- "Registration confirmed"
- "See you there"

### Failure Detection

Registration is marked as failed if:
- No registration button found
- Event is full / sold out
- Event requires approval
- Already registered (counted as success)
- Error during process

## Best Practices

### Avoiding Detection

1. **Start Small**: Test with 5-10 events first
2. **Use Delays**: Set 5-10 second delays between batches
3. **Limit Parallel Tabs**: Use 2-3 tabs, not 5
4. **Take Breaks**: Process 20-30 events, pause for 5 minutes, continue
5. **Randomize**: The extension adds random delays automatically

### Handling Large Batches

For 100+ events:
1. Split into batches of 20-30
2. Process one batch
3. Wait 5-10 minutes
4. Process next batch
5. Monitor for any errors or blocks

### Troubleshooting

**No events found:**
- Make sure you're on a calendar page with visible events
- Try scrolling down to load more events before scanning
- Check if the page uses lazy loading

**Registration failing:**
- Verify you're logged into Luma
- Check if your profile has saved name/email
- Try manually registering for one event first
- Some events may require approval or payment

**Extension not working:**
- Reload the extension in `chrome://extensions/`
- Check browser console for errors (F12)
- Ensure you're on a valid Luma domain

**Rate limiting:**
- Reduce parallel tabs to 1-2
- Increase delay between batches to 10-15 seconds
- Take longer breaks between batches

**Cloudflare/Turnstile CAPTCHA:**
- The extension automatically attempts to bypass Turnstile "Verify you are human" challenges
- Uses Chrome Debugger API to send trusted mouse events with human-like Bezier curve movement
- If auto-bypass fails, you have 2 minutes to manually click the checkbox
- VPN usage often triggers more aggressive CAPTCHAs - try disabling VPN if challenges persist
- The extension will retry bypass attempts up to 5 times with 8-second intervals

## Limitations

1. **Must be logged in**: Extension cannot log you in automatically
2. **Requires saved profile**: Luma must have your info for quick registration
3. **Free events only**: Paid events or events requiring payment details won't work
4. **No CAPTCHA solving**: If Luma shows CAPTCHAs, registration will fail
5. **Approval required events**: Events needing host approval will only submit request
6. **Calendar page structure**: Extension relies on current Luma HTML structure

## Privacy & Security

- **Your data, your Sheet**: Registration data only goes to YOUR Google Sheet
- **No third-party servers**: Extension only communicates with your own Google Apps Script
- **Email used for matching**: Your registration email is sent to the Sheet for tracking
- **Open source**: Review all code in this repository

## Technical Details

### Files Structure

```
luma-auto-register/
├── manifest.json           # Extension configuration
├── background.js           # Service worker (queue manager, API integration)
├── content.js              # Runs on Luma pages
├── settings.html           # Settings page for email/API configuration
├── settings.js             # Settings page logic
├── dashboard.html          # Registration dashboard UI
├── dashboard.js            # Dashboard logic
├── google-apps-script.js   # Google Apps Script code (copy to your Sheet)
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Styles
│   └── popup.js            # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Permissions Used

- `tabs`: Create and manage registration tabs
- `storage`: Save queue and results locally
- `scripting`: Inject code to interact with Luma pages
- `debugger`: Send trusted mouse events for CAPTCHA bypass
- `host_permissions`: Access lu.ma, luma.com, and challenges.cloudflare.com domains

## Development

### Testing

1. Load extension in developer mode
2. Open popup and test with a small calendar (5-10 events)
3. Check browser console for errors
4. Monitor network tab for rate limiting

### Debugging

- Enable "Inspect popup" in extension menu
- Check `background.js` logs in extension service worker
- View `content.js` logs in page console (F12)

### Modifying

Key areas to customize:

- **Event scraping**: `scrapeEventsFromPage()` in `background.js`
- **Registration logic**: `performRegistration()` in `background.js`
- **UI styling**: `popup.css`
- **Detection patterns**: Update button text searches in `content.js`

## Changelog

### Version 2.1.0 (Turnstile Bypass)
- **Cloudflare/Turnstile Bypass**: Automatic human-like click simulation to bypass CAPTCHA challenges
- Uses Chrome Debugger API for trusted mouse events (indistinguishable from real user input)
- Bezier curve mouse movement for natural-looking trajectories
- Randomized timing, hover events, and click pressure for realism
- Auto-retry up to 5 times with 8-second intervals
- Falls back to 2-minute manual completion window if bypass fails
- Improved success detection during verification challenges

### Version 2.0.0 (Team Edition)
- **Google Sheets Database**: Shared tracking across team members
- **Multi-Person Support**: Track registrations per email address
- **Per-Calendar Tabs**: Auto-organize by calendar/conference (CHK2026, ethdenver, etc.)
- **Master Tab**: Overview of all registrations across all calendars
- **Relative Date Parsing**: Handles "Tomorrow", "Today", "Saturday" etc.
- **Migration Tools**: Import existing registration data from old formats
- **Settings Page**: Configure email, name, and API URL
- **Improved Detection**: Better matching using event URL + email (case-insensitive)

### Version 1.0.0 (Initial Release)
- Event discovery from calendar pages
- Bulk registration with parallel processing
- Real-time progress tracking
- Pause/resume functionality
- Results export to CSV
- Activity logging

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly
4. Submit a pull request

## Disclaimer

This extension is for educational and personal use. Use responsibly and in accordance with Luma's Terms of Service. The developers are not responsible for any account restrictions or violations resulting from misuse.

**Note**: Automated registration may be against Luma's ToS. Use at your own risk.

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check existing issues for solutions
- Review troubleshooting section above

## License

MIT License - See LICENSE file for details

---

**Last Updated:** February 9, 2026

Made with ❤️ for busy event-goers
