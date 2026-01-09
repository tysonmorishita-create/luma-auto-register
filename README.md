# Luma Auto Register - Chrome Extension

Automatically register for multiple Luma events from calendar pages. Perfect for registering for hundreds of events quickly and efficiently.

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

### Important: Prepare Your Luma Account

Before using the extension, ensure:

1. **You're logged into Luma** in your Chrome browser
2. **Your profile is complete** with name and email
3. **Test manual registration** on one event to ensure Luma has your info saved
   - If Luma offers "one-click registration", you're ready!
   - If you have to fill out forms each time, the extension may have issues

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
4. Extracts event titles and URLs
5. Presents them to you for selection

### Registration Phase

For each selected event:

1. Opens event page in a background tab
2. Waits for page to fully load
3. Looks for registration button ("Register", "RSVP", "Sign Up", etc.)
4. Clicks the button
5. Waits for form/modal to appear
6. Clicks submit button
7. Waits to detect success or failure
8. Closes the tab and moves to next event

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

## Limitations

1. **Must be logged in**: Extension cannot log you in automatically
2. **Requires saved profile**: Luma must have your info for quick registration
3. **Free events only**: Paid events or events requiring payment details won't work
4. **No CAPTCHA solving**: If Luma shows CAPTCHAs, registration will fail
5. **Approval required events**: Events needing host approval will only submit request
6. **Calendar page structure**: Extension relies on current Luma HTML structure

## Privacy & Security

- **No data collection**: Extension doesn't collect or transmit your data
- **Local storage only**: All data stored locally in your browser
- **No external servers**: Extension operates entirely in your browser
- **Open source**: Review all code in this repository

## Technical Details

### Files Structure

```
luma-auto-register/
├── manifest.json           # Extension configuration
├── background.js          # Service worker (queue manager)
├── content.js            # Runs on Luma pages
├── popup/
│   ├── popup.html        # Extension UI
│   ├── popup.css         # Styles
│   └── popup.js          # UI logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Permissions Used

- `tabs`: Create and manage registration tabs
- `storage`: Save queue and results locally
- `scripting`: Inject code to interact with Luma pages
- `host_permissions`: Access lu.ma and luma.com domains

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

**Last Updated:** January 9, 2026

Made with ❤️ for busy event-goers
