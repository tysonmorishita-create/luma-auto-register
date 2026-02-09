/**
 * Google Apps Script for Luma Auto Register Extension
 * 
 * This script manages registration tracking with automatic tab creation per calendar.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com/
 * 2. Create a new project
 * 3. Copy and paste this entire script
 * 4. Click "Deploy" > "New deployment"
 * 5. Select "Web app" as the type
 * 6. Set "Execute as" to "Me"
 * 7. Set "Who has access" to "Anyone"
 * 8. Click "Deploy" and copy the URL
 * 9. Paste the URL in the extension settings
 * 
 * SPREADSHEET SETUP:
 * - Create a new Google Sheet
 * - The script will automatically create tabs as needed
 * - Tab names will match calendar IDs (e.g., "CHK2026", "ethdenver")
 * - A "Master" tab will contain all registrations for overview
 */

// Headers for registration sheets
const HEADERS = ['event_url', 'title', 'event_date', 'person_email', 'person_name', 'calendar', 'registered_at'];

/**
 * Normalize a Luma event URL to a consistent format for comparison
 * Handles both lu.ma and luma.com domains
 * 
 * Examples:
 * - "https://lu.ma/h7i66r2z" -> "h7i66r2z"
 * - "https://luma.com/h7i66r2z" -> "h7i66r2z"
 * - "https://lu.ma/h7i66r2z?ref=abc" -> "h7i66r2z"
 * - "h7i66r2z" -> "h7i66r2z" (already just a slug)
 */
function normalizeEventUrl(url) {
  if (!url) return '';
  
  url = String(url).trim();
  
  // If it's already just a slug (no slashes), return as-is
  if (!url.includes('/') && !url.includes('.')) {
    return url.toLowerCase();
  }
  
  // Try to extract slug from various URL formats
  // Match: lu.ma/SLUG, luma.com/SLUG, or just /SLUG
  const match = url.match(/(?:lu\.ma|luma\.com)\/([a-zA-Z0-9_-]+)(?:[?#]|$)/i);
  if (match) {
    return match[1].toLowerCase();
  }
  
  // Fallback: try to get the last path segment
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    if (pathParts.length > 0) {
      // Return the last path segment, removing any query/hash
      return pathParts[pathParts.length - 1].toLowerCase();
    }
  } catch (e) {
    // URL parsing failed, try simple extraction
    const simplePath = url.split('?')[0].split('#')[0];
    const parts = simplePath.split('/').filter(p => p);
    if (parts.length > 0) {
      return parts[parts.length - 1].toLowerCase();
    }
  }
  
  // Return original URL lowercased as last resort
  return url.toLowerCase();
}

// Headers for SeenEvents sheet (tracks when events were first discovered)
const SEEN_EVENTS_HEADERS = ['event_url', 'title', 'event_date', 'calendar', 'first_seen_date', 'first_seen_by'];
const SEEN_EVENTS_SHEET_NAME = '_SeenEvents'; // Underscore prefix = internal sheet

// Get the active spreadsheet (the one this script is bound to)
// Or specify a spreadsheet ID if using a standalone script
function getSpreadsheet() {
  // If bound to a spreadsheet, use that
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    // If standalone, you can specify a spreadsheet ID here:
    // return SpreadsheetApp.openById('YOUR_SPREADSHEET_ID_HERE');
    throw new Error('Script must be bound to a spreadsheet or specify a spreadsheet ID');
  }
}

// Get or create a sheet (tab) by name
function getOrCreateSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    // Create new sheet with headers
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(HEADERS);
    
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4a86e8');
    headerRange.setFontColor('white');
    
    // Freeze header row
    sheet.setFrozenRows(1);
    
    // Set column widths for better readability
    sheet.setColumnWidth(1, 300); // event_url
    sheet.setColumnWidth(2, 250); // title
    sheet.setColumnWidth(3, 120); // event_date
    sheet.setColumnWidth(4, 200); // person_email
    sheet.setColumnWidth(5, 150); // person_name
    sheet.setColumnWidth(6, 100); // calendar
    sheet.setColumnWidth(7, 180); // registered_at
    
    console.log('Created new sheet:', sheetName);
  }
  
  return sheet;
}

// Get or create the SeenEvents sheet
function getSeenEventsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SEEN_EVENTS_SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SEEN_EVENTS_SHEET_NAME);
    sheet.appendRow(SEEN_EVENTS_HEADERS);
    
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, SEEN_EVENTS_HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#34a853'); // Green for seen events
    headerRange.setFontColor('white');
    
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 300); // event_url
    sheet.setColumnWidth(2, 250); // title
    sheet.setColumnWidth(3, 120); // event_date
    sheet.setColumnWidth(4, 100); // calendar
    sheet.setColumnWidth(5, 150); // first_seen_date
    sheet.setColumnWidth(6, 200); // first_seen_by
    
    console.log('Created SeenEvents sheet');
  }
  
  return sheet;
}

// Main entry point for GET requests
function doGet(e) {
  return handleRequest(e);
}

// Main entry point for POST requests
function doPost(e) {
  return handleRequest(e);
}

// Handle incoming requests
function handleRequest(e) {
  try {
    const action = e.parameter.action;
    
    switch (action) {
      case 'getScanStatus':
        return jsonResponse(getScanStatus(e.parameter.email, e.parameter.calendar));
      
      case 'addRegistration':
        const regData = JSON.parse(e.parameter.registration);
        return jsonResponse(addRegistration(regData));
      
      case 'recordSeenEvents':
        const seenData = JSON.parse(e.parameter.events);
        return jsonResponse(recordSeenEvents(seenData, e.parameter.calendar, e.parameter.scannedBy));
      
      case 'getAllData':
        return jsonResponse(getAllData(e.parameter.calendar));
      
      case 'getCalendars':
        return jsonResponse(getCalendars());
      
      default:
        return jsonResponse({ error: 'Unknown action: ' + action });
    }
  } catch (error) {
    console.error('Request error:', error);
    return jsonResponse({ error: error.message });
  }
}

// Return JSON response
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Get list of all calendar tabs
function getCalendars() {
  const ss = getSpreadsheet();
  const sheets = ss.getSheets();
  const calendars = [];
  
  for (const sheet of sheets) {
    const name = sheet.getName();
    // Skip any special sheets
    if (name !== 'Master' && !name.startsWith('_')) {
      calendars.push(name);
    }
  }
  
  return { calendars: calendars };
}

// Get seen events and registrations for a specific email
// Returns: seenEvents (all URLs), myRegistrations (this user's), teamRegistrations (others'), firstSeenDates
// NOTE: All URLs are NORMALIZED (just the slug) for consistent matching across lu.ma and luma.com domains
function getScanStatus(email, calendar) {
  if (!email) {
    return { error: 'Email is required' };
  }
  
  const ss = getSpreadsheet();
  const seenEvents = new Set();
  const myRegistrations = new Set();
  const teamRegistrations = {}; // { normalizedUrl: [emails who registered] }
  const firstSeenDates = {}; // { normalizedUrl: { date, by } }
  
  // First, get first_seen data from SeenEvents sheet
  try {
    const seenSheet = ss.getSheetByName(SEEN_EVENTS_SHEET_NAME);
    if (seenSheet) {
      const lastRow = seenSheet.getLastRow();
      if (lastRow > 1) {
        // Columns: event_url, title, event_date, calendar, first_seen_date, first_seen_by
        const seenData = seenSheet.getRange(2, 1, lastRow - 1, 6).getValues();
        for (const row of seenData) {
          const eventUrl = row[0];
          const eventCalendar = row[3];
          const firstSeenDate = row[4];
          const firstSeenBy = row[5];
          
          // Filter by calendar if specified
          if (calendar && eventCalendar !== calendar) continue;
          
          if (eventUrl) {
            // Normalize URL for consistent matching
            const normalizedUrl = normalizeEventUrl(eventUrl);
            seenEvents.add(normalizedUrl);
            firstSeenDates[normalizedUrl] = {
              date: firstSeenDate,
              by: firstSeenBy
            };
          }
        }
      }
    }
  } catch (e) {
    console.log('Error reading SeenEvents sheet:', e);
  }
  
  // Get registrations from Master sheet ONLY (to avoid duplicates)
  // Master sheet is the single source of truth for all registrations
  const masterSheet = ss.getSheetByName('Master');
  
  if (masterSheet) {
    const lastRow = masterSheet.getLastRow();
    if (lastRow >= 2) {
      const firstRow = masterSheet.getRange(1, 1, 1, 4).getValues()[0];
      if (firstRow[0] === 'event_url') {
        // Get all data: event_url, title, event_date, person_email, person_name, calendar, registered_at
        const data = masterSheet.getRange(2, 1, lastRow - 1, 7).getValues();
        
        for (const row of data) {
          const eventUrl = row[0];
          const personEmail = row[3];
          const eventCalendar = row[5]; // calendar column
          const registeredAt = row[6];
          
          // If calendar filter is specified, only include events from that calendar
          if (calendar && eventCalendar !== calendar) continue;
          
          if (eventUrl) {
            // Normalize URL for consistent matching
            const normalizedUrl = normalizeEventUrl(eventUrl);
            seenEvents.add(normalizedUrl);
            
            if (personEmail) {
              // Track who registered for this event (using normalized URL as key)
              if (!teamRegistrations[normalizedUrl]) {
                teamRegistrations[normalizedUrl] = [];
              }
              
              // Add registration info (avoid duplicates by checking email)
              const alreadyAdded = teamRegistrations[normalizedUrl].some(
                r => r.email.toLowerCase() === personEmail.toLowerCase()
              );
              
              if (!alreadyAdded) {
                teamRegistrations[normalizedUrl].push({
                  email: personEmail,
                  registeredAt: registeredAt
                });
              }
              
              // Check if this is the current user
              if (personEmail.toLowerCase() === email.toLowerCase()) {
                myRegistrations.add(normalizedUrl);
              }
            }
          }
        }
      }
    }
  }
  
  // Build team registrations - include ALL events where teammates registered
  // But exclude the current user from the registrations list (we don't need to show "you" as a teammate)
  const allTeamRegistrations = {};
  for (const [normalizedUrl, registrations] of Object.entries(teamRegistrations)) {
    // Filter out the current user from the list of registrants
    const teammatesOnly = registrations.filter(
      r => r.email.toLowerCase() !== email.toLowerCase()
    );
    // Only include if there are teammates who registered (not just the current user)
    if (teammatesOnly.length > 0) {
      allTeamRegistrations[normalizedUrl] = teammatesOnly;
    }
  }
  
  return {
    seenEvents: Array.from(seenEvents),
    myRegistrations: Array.from(myRegistrations),
    teamRegistrations: allTeamRegistrations, // ALL events where teammates registered (excluding current user from list)
    firstSeenDates: firstSeenDates
  };
}

// Record events that were seen during a scan (for "first seen" tracking)
function recordSeenEvents(events, calendar, scannedBy) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return { recorded: 0, newEvents: 0 };
  }
  
  const sheet = getSeenEventsSheet();
  const now = new Date().toISOString();
  const calendarName = calendar || 'default';
  
  // Get existing URLs to avoid duplicates (normalized for comparison)
  const lastRow = sheet.getLastRow();
  const existingNormalizedUrls = new Set();
  
  if (lastRow > 1) {
    const existingData = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (const row of existingData) {
      if (row[0]) {
        // Normalize existing URLs for consistent comparison
        existingNormalizedUrls.add(normalizeEventUrl(row[0]));
      }
    }
  }
  
  // Add new events
  let newCount = 0;
  const newRows = [];
  const addedNormalized = new Set(); // Track what we're adding to avoid duplicates within batch
  
  for (const event of events) {
    if (event.url) {
      const normalizedUrl = normalizeEventUrl(event.url);
      // Check against existing AND what we're about to add
      if (!existingNormalizedUrls.has(normalizedUrl) && !addedNormalized.has(normalizedUrl)) {
        newRows.push([
          event.url, // Store original URL
          event.title || '',
          event.date || '',
          calendarName,
          now,
          scannedBy || ''
        ]);
        addedNormalized.add(normalizedUrl);
        newCount++;
      }
    }
  }
  
  // Batch append for efficiency
  if (newRows.length > 0) {
    const startRow = lastRow + 1;
    sheet.getRange(startRow, 1, newRows.length, SEEN_EVENTS_HEADERS.length).setValues(newRows);
    console.log('Recorded', newRows.length, 'new events for calendar:', calendarName);
  }
  
  return {
    recorded: events.length,
    newEvents: newCount,
    calendar: calendarName
  };
}

// Add a registration
function addRegistration(reg) {
  if (!reg.event_url || !reg.person_email) {
    return { error: 'event_url and person_email are required', added: false };
  }
  
  const calendarName = reg.calendar || 'default';
  const now = new Date().toISOString();
  const normalizedEventUrl = normalizeEventUrl(reg.event_url);
  
  // Get or create the calendar-specific sheet
  const calendarSheet = getOrCreateSheet(calendarName);
  
  // Check for duplicates in this calendar (using normalized URL comparison)
  const lastRow = calendarSheet.getLastRow();
  if (lastRow > 1) {
    const existingData = calendarSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    for (const row of existingData) {
      const existingNormalized = normalizeEventUrl(row[0]);
      if (existingNormalized === normalizedEventUrl && 
          row[3] && row[3].toLowerCase() === reg.person_email.toLowerCase()) {
        console.log('Duplicate found (normalized match), skipping:', reg.event_url, reg.person_email);
        return { added: false, reason: 'duplicate' };
      }
    }
  }
  
  // Add to calendar-specific sheet
  const newRow = [
    reg.event_url, // Store original URL
    reg.title || '',
    reg.event_date || '',
    reg.person_email,
    reg.person_name || '',
    calendarName,
    now
  ];
  
  calendarSheet.appendRow(newRow);
  console.log('Added registration to', calendarName, ':', reg.event_url, 'for', reg.person_email);
  
  // Also add to Master sheet for overview
  const masterSheet = getOrCreateSheet('Master');
  
  // Check for duplicates in Master using normalized URL
  const masterLastRow = masterSheet.getLastRow();
  let isDuplicateInMaster = false;
  
  if (masterLastRow > 1) {
    const masterData = masterSheet.getRange(2, 1, masterLastRow - 1, 4).getValues();
    for (const row of masterData) {
      const existingNormalized = normalizeEventUrl(row[0]);
      if (existingNormalized === normalizedEventUrl && 
          row[3] && row[3].toLowerCase() === reg.person_email.toLowerCase()) {
        isDuplicateInMaster = true;
        break;
      }
    }
  }
  
  if (!isDuplicateInMaster) {
    masterSheet.appendRow(newRow);
    console.log('Added registration to Master sheet');
  }
  
  return { added: true, calendar: calendarName };
}

// Get all registration data (optionally filtered by calendar)
function getAllData(calendar) {
  const ss = getSpreadsheet();
  const allData = [];
  
  // Determine which sheets to read
  let sheetsToRead = [];
  
  if (calendar) {
    const sheet = ss.getSheetByName(calendar);
    if (sheet) {
      sheetsToRead.push(sheet);
    }
  } else {
    // Read from Master sheet only to avoid duplicates
    const masterSheet = ss.getSheetByName('Master');
    if (masterSheet) {
      sheetsToRead.push(masterSheet);
    }
  }
  
  for (const sheet of sheetsToRead) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    
    const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    
    for (const row of data) {
      allData.push({
        event_url: row[0],
        title: row[1],
        event_date: row[2],
        person_email: row[3],
        person_name: row[4],
        calendar: row[5],
        registered_at: row[6]
      });
    }
  }
  
  return { data: allData, count: allData.length };
}

// Test function - run this to verify the script works
function testScript() {
  // Test getOrCreateSheet
  const testSheet = getOrCreateSheet('TestCalendar');
  console.log('Created/got test sheet:', testSheet.getName());
  
  // Test addRegistration
  const result = addRegistration({
    event_url: 'https://lu.ma/test-event-' + Date.now(),
    title: 'Test Event',
    event_date: 'Feb 10',
    person_email: 'test@example.com',
    person_name: 'Test User',
    calendar: 'TestCalendar'
  });
  console.log('Add registration result:', JSON.stringify(result));
  
  // Test getScanStatus
  const status = getScanStatus('test@example.com');
  console.log('Scan status:', JSON.stringify(status));
  
  // Test getCalendars
  const calendars = getCalendars();
  console.log('Calendars:', JSON.stringify(calendars));
  
  console.log('All tests completed!');
}

// ============================================================================
// MIGRATION FUNCTIONS
// Run migrateOldData() once to import existing registrations from old format
// ============================================================================

/**
 * Configuration for migrating old sheet data
 * Maps old tab names to person details and target calendar
 * 
 * CUSTOMIZE THIS for your specific sheets:
 */
const MIGRATION_CONFIG = [
  {
    oldTabName: 'VITO PENDING',
    personEmail: 'vito@chainpatrol.io',
    personName: 'Vito Giovannetti',
    targetCalendar: 'CHK2026'
  },
  {
    oldTabName: 'MICHAEL PENDING',
    personEmail: 'mike@chainpatrol.io',
    personName: 'Michael Kehren',
    targetCalendar: 'CHK2026'
  }
  // Add more mappings here if needed:
  // {
  //   oldTabName: 'ANOTHER TAB',
  //   personEmail: 'another@email.com',
  //   personName: 'Another Person',
  //   targetCalendar: 'ethdenver'
  // }
];

/**
 * Main migration function - RUN THIS ONCE to import old data
 * 
 * Old format expected:
 * Column A: URL LINK (event URL)
 * Column B: Title (event title, may include time)
 * Column C: DONE? CHECK BOX (checkbox - true = registered)
 * Column D: REMARKS (optional notes)
 * 
 * Only migrates rows where checkbox is checked (Column C = true)
 */
function migrateOldData() {
  console.log('=== STARTING MIGRATION ===');
  
  const ss = getSpreadsheet();
  const migrationStats = {
    totalProcessed: 0,
    totalMigrated: 0,
    totalSkipped: 0,
    totalDuplicates: 0,
    byTab: {}
  };
  
  for (const config of MIGRATION_CONFIG) {
    console.log(`\nProcessing tab: ${config.oldTabName}`);
    
    const oldSheet = ss.getSheetByName(config.oldTabName);
    if (!oldSheet) {
      console.log(`  WARNING: Tab "${config.oldTabName}" not found, skipping...`);
      migrationStats.byTab[config.oldTabName] = { error: 'Tab not found' };
      continue;
    }
    
    const tabStats = {
      processed: 0,
      migrated: 0,
      skipped: 0,
      duplicates: 0
    };
    
    // Get all data from the old sheet
    const lastRow = oldSheet.getLastRow();
    if (lastRow < 2) {
      console.log(`  Tab "${config.oldTabName}" is empty, skipping...`);
      migrationStats.byTab[config.oldTabName] = { error: 'Empty tab' };
      continue;
    }
    
    // Read all data (skip header row)
    // Columns: A=URL, B=Title, C=Checkbox, D=Remarks
    const data = oldSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const eventUrl = row[0] ? String(row[0]).trim() : '';
      const title = row[1] ? String(row[1]).trim() : '';
      const isChecked = row[2] === true || row[2] === 'TRUE' || row[2] === 'true';
      const remarks = row[3] ? String(row[3]).trim() : '';
      
      tabStats.processed++;
      
      // Skip if no URL
      if (!eventUrl) {
        tabStats.skipped++;
        continue;
      }
      
      // Skip if not checked (not registered)
      if (!isChecked) {
        tabStats.skipped++;
        continue;
      }
      
      // Try to extract date from title (format like "7:00 PM Event Name" or "Feb 10 Event")
      let eventDate = extractDateFromTitle(title);
      
      // Add registration using existing function
      const result = addRegistration({
        event_url: eventUrl,
        title: cleanTitle(title),
        event_date: eventDate,
        person_email: config.personEmail,
        person_name: config.personName,
        calendar: config.targetCalendar
      });
      
      if (result.added) {
        tabStats.migrated++;
        console.log(`  ✓ Migrated: ${eventUrl}`);
      } else if (result.reason === 'duplicate') {
        tabStats.duplicates++;
        console.log(`  - Duplicate: ${eventUrl}`);
      } else {
        tabStats.skipped++;
        console.log(`  ✗ Skipped: ${eventUrl} - ${result.error || 'unknown'}`);
      }
    }
    
    migrationStats.byTab[config.oldTabName] = tabStats;
    migrationStats.totalProcessed += tabStats.processed;
    migrationStats.totalMigrated += tabStats.migrated;
    migrationStats.totalSkipped += tabStats.skipped;
    migrationStats.totalDuplicates += tabStats.duplicates;
    
    console.log(`  Tab complete: ${tabStats.migrated} migrated, ${tabStats.duplicates} duplicates, ${tabStats.skipped} skipped`);
  }
  
  console.log('\n=== MIGRATION COMPLETE ===');
  console.log(`Total processed: ${migrationStats.totalProcessed}`);
  console.log(`Total migrated: ${migrationStats.totalMigrated}`);
  console.log(`Total duplicates: ${migrationStats.totalDuplicates}`);
  console.log(`Total skipped: ${migrationStats.totalSkipped}`);
  
  return migrationStats;
}

/**
 * Try to extract a date from the title string
 * Handles formats like:
 * - "7:00 PM Event Name"
 * - "Feb 10 Event Name"
 * - "2/10 Event Name"
 */
function extractDateFromTitle(title) {
  if (!title) return '';
  
  // Try to find month + day pattern (Feb 10, March 5, etc.)
  const monthDayMatch = title.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i);
  if (monthDayMatch) {
    return monthDayMatch[0];
  }
  
  // Try to find time pattern at the start (7:00 PM, 10:30 AM)
  const timeMatch = title.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  if (timeMatch) {
    return timeMatch[1];
  }
  
  // Try numeric date pattern (2/10, 02/10)
  const numericMatch = title.match(/\b(\d{1,2}\/\d{1,2})\b/);
  if (numericMatch) {
    return numericMatch[1];
  }
  
  return '';
}

/**
 * Clean up title by removing time prefix if present
 */
function cleanTitle(title) {
  if (!title) return '';
  
  // Remove time prefix like "7:00 PM " or "10:30 AM "
  let cleaned = title.replace(/^\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[·\-–—]\s*/i, '');
  
  // Also try without separator
  cleaned = cleaned.replace(/^\d{1,2}:\d{2}\s*(?:AM|PM)?\s+/i, '');
  
  return cleaned.trim();
}

/**
 * Dry run - see what would be migrated without actually doing it
 * Run this first to verify the migration config is correct
 */
function previewMigration() {
  console.log('=== MIGRATION PREVIEW (DRY RUN) ===');
  console.log('This shows what would be migrated without actually doing it.\n');
  
  const ss = getSpreadsheet();
  
  for (const config of MIGRATION_CONFIG) {
    console.log(`\n--- Tab: ${config.oldTabName} ---`);
    console.log(`  → Email: ${config.personEmail}`);
    console.log(`  → Name: ${config.personName}`);
    console.log(`  → Target Calendar: ${config.targetCalendar}`);
    
    const oldSheet = ss.getSheetByName(config.oldTabName);
    if (!oldSheet) {
      console.log(`  ⚠️ Tab not found!`);
      continue;
    }
    
    const lastRow = oldSheet.getLastRow();
    if (lastRow < 2) {
      console.log(`  ⚠️ Tab is empty`);
      continue;
    }
    
    const data = oldSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    
    let checkedCount = 0;
    let uncheckedCount = 0;
    
    for (const row of data) {
      const eventUrl = row[0] ? String(row[0]).trim() : '';
      const isChecked = row[2] === true || row[2] === 'TRUE' || row[2] === 'true';
      
      if (!eventUrl) continue;
      
      if (isChecked) {
        checkedCount++;
      } else {
        uncheckedCount++;
      }
    }
    
    console.log(`  ✓ Would migrate: ${checkedCount} registered events`);
    console.log(`  ○ Would skip: ${uncheckedCount} unchecked events`);
  }
  
  console.log('\n=== END PREVIEW ===');
  console.log('Run migrateOldData() to perform the actual migration.');
}
