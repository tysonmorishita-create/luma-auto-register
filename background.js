// Background Service Worker
console.log('[Background] Background script loading...');

class RegistrationManager {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.paused = false;
    this.activeTabs = new Map();
    this.results = [];
    this.settings = {
      parallelTabs: 2,
      delayBetween: 5000
    };
    this.stats = {
      processed: 0,
      success: 0,
      failed: 0,
      pending: 0
    };
    this.targetWindowId = null; // Track which window to open tabs in for consistent window usage
  }

  async init() {
    // Load saved state if any
    const stored = await chrome.storage.local.get(['queue', 'results', 'stats', 'targetWindowId']);
    if (stored.queue) this.queue = stored.queue;
    if (stored.results) this.results = stored.results;
    if (stored.stats) this.stats = stored.stats;
    if (stored.targetWindowId) {
      // Verify the window still exists
      try {
        await chrome.windows.get(stored.targetWindowId);
        this.targetWindowId = stored.targetWindowId;
        console.log('[Luma Auto Register] Restored target window ID: ' + this.targetWindowId);
      } catch (error) {
        // Window no longer exists, clear it
        this.targetWindowId = null;
        await chrome.storage.local.remove('targetWindowId');
        console.log('[Luma Auto Register] Stored window ID no longer exists, cleared');
      }
    }
  }

  async startScanCurrentTab(tabId) {
    console.log('[Background] ===== startScanCurrentTab STARTED =====');
    console.log('[Background] TabId:', tabId);
    console.log('[Background] Function called successfully!');
    try {
      console.log('[Background] Inside try block');
      this.sendLog('info', 'Scanning current page for events...');
      console.log('[Background] startScanCurrentTab called with tabId:', tabId);
      
      if (!tabId) {
        const error = new Error('No tab ID provided');
        console.error('[Background] Error:', error);
        this.sendLog('error', `Error: ${error.message}`);
        throw error;
      }
      
      // Verify tab is still valid
      let tab;
      try {
        console.log('[Background] Getting tab with ID:', tabId);
        tab = await chrome.tabs.get(tabId);
        console.log('[Background] Tab verified:', tab.id, tab.url);
        if (!tab) {
          throw new Error('Tab not found');
        }
        this.sendLog('info', `Tab verified: ${tab.url}`);
      } catch (error) {
        console.error('[Background] Tab error:', error);
        this.sendLog('error', `Tab error: ${error.message}`);
        throw error;
      }
      
      // Wait a moment for page to be ready
      this.sendLog('info', 'Waiting for page to be ready...');
      console.log('[Background] Waiting 2 seconds...');
      await this.sleep(2000);
      console.log('[Background] Wait complete, starting scroll...');
      
      // Simple scrolling: scroll to bottom multiple times to load all events
      this.sendLog('info', 'Scrolling to load all events...');
      console.log('[Background] Starting scroll loop...');
      
      for (let i = 0; i < 15; i++) {
        console.log(`[Background] Scroll ${i + 1}/15 starting...`);
        try {
          const scrollResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => {
              // Get previous scroll position
              var previousScroll = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
              
              // Calculate max scroll (scroll to bottom)
              var maxScroll = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              );
              
              // Scroll to bottom using multiple methods
              window.scrollTo(0, maxScroll);
              document.documentElement.scrollTop = maxScroll;
              document.body.scrollTop = maxScroll;
              
              // Also try scrolling any scrollable containers
              var scrollableContainers = document.querySelectorAll('main, [role="main"], .main-content, #main-content, [class*="scroll"], [class*="container"]');
              for (var j = 0; j < scrollableContainers.length; j++) {
                var container = scrollableContainers[j];
                if (container.scrollHeight > container.clientHeight) {
                  container.scrollTop = container.scrollHeight;
                }
              }
              
              // Dispatch scroll events to trigger lazy loading
              window.dispatchEvent(new Event('scroll'));
              document.dispatchEvent(new Event('scroll'));
              
              // Return current scroll position
              var currentScroll = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
              return {
                previousScroll: previousScroll,
                currentScroll: currentScroll,
                maxScroll: maxScroll,
                scrolled: currentScroll >= maxScroll - 10 || currentScroll > previousScroll
              };
            }
          });
          
          const scrollInfo = scrollResult[0]?.result;
          if (scrollInfo) {
            console.log(`[Background] Scroll ${i + 1}/15 result:`, scrollInfo);
            this.sendLog('info', `  Scroll ${i + 1}/15: ${scrollInfo.scrolled ? '✓' : '⚠'} (pos: ${scrollInfo.currentScroll}/${scrollInfo.maxScroll})`);
          } else {
            console.log(`[Background] Scroll ${i + 1}/15 complete (no result)`);
            this.sendLog('info', `  Scroll ${i + 1}/15 complete`);
          }
        } catch (error) {
          console.error(`[Background] Scroll ${i + 1} error:`, error);
          this.sendLog('warn', `  Scroll ${i + 1}/15 failed: ${error.message}`);
        }
        
        await this.sleep(1500); // Wait 1.5 seconds between scrolls for lazy loading
      }
      
      // Scroll back to top
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
          }
        });
      } catch (error) {
        this.sendLog('warn', `Failed to scroll to top: ${error.message}`);
      }
      await this.sleep(1500);
      
      console.log('[Background] Scroll completed!');
      
      // Scroll back to top
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
          }
        });
      } catch (error) {
        this.sendLog('warn', `Failed to scroll to top: ${error.message}`);
      }
      await this.sleep(1500);
      
      // Check for event links (use same logic as scraping)
      this.sendLog('info', 'Looking for event links...');
      const checkLinks = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          // Find all links that could be events
          const allLinks = document.querySelectorAll('a[href*="lu.ma"], a[href*="luma.com"]');
          let eventCount = 0;
          
          for (let i = 0; i < allLinks.length; i++) {
            const href = allLinks[i].getAttribute('href') || '';
            // Count as event if it matches event URL pattern
            if (href.match(/\/([a-zA-Z0-9_-]+)(?:\?|$|#)/) && 
                !href.includes('/calendar') && 
                !href.includes('/profile') &&
                !href.includes('BP-SideEvents') &&
                href !== 'https://lu.ma/' &&
                href !== 'https://luma.com/') {
              eventCount++;
            }
          }
          
          return { 
            eventLinks: eventCount, 
            totalLinks: allLinks.length,
            // Also check for .event-link for backwards compatibility
            eventLinkClass: document.querySelectorAll('a.event-link').length
          };
        }
      });
      
      const result = checkLinks[0]?.result || { eventLinks: 0, totalLinks: 0 };
      this.sendLog('info', `Found ${result.eventLinks} event links (${result.totalLinks} total Luma links)`);
      
      if (result.eventLinks === 0) {
        this.sendLog('error', 'No event links found. Make sure you\'re on a Luma calendar page.');
        try {
          chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            events: [],
            debug: { eventLinks: 0, totalLinks: result.totalLinks }
          });
        } catch (error) {
          // Popup is closed, ignore
        }
        return;
      }
      
      // Inject and execute event scraping with inline function
      this.sendLog('info', 'Scraping events from page...');
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: function() {
          // This function runs in the page context
          console.log('[Luma Auto Register] === SCRAPING STARTED ===');
          
          var events = [];
          var debugInfo = {
            totalLinks: 0,
            eventLinks: 0,
            filteredOut: [],
            foundEvents: []
          };
          
          // Find all event links - try multiple selectors
          var eventLinks = document.querySelectorAll('a.event-link');
          // Also find links by href pattern (more reliable for Luma pages)
          var allLumaLinks = document.querySelectorAll('a[href*="lu.ma"], a[href*="luma.com"]');
          
          // Combine and deduplicate
          var linkMap = new Map();
          for (var idx = 0; idx < eventLinks.length; idx++) {
            linkMap.set(eventLinks[idx].href, eventLinks[idx]);
          }
          for (var idx2 = 0; idx2 < allLumaLinks.length; idx2++) {
            var href = allLumaLinks[idx2].getAttribute('href') || '';
            if (href.match(/\/([a-zA-Z0-9_-]+)(?:\?|$|#)/) && 
                !href.includes('/calendar') && 
                !href.includes('/profile') &&
                !href.includes('BP-SideEvents') &&
                href !== 'https://lu.ma/' &&
                href !== 'https://luma.com/') {
              linkMap.set(href, allLumaLinks[idx2]);
            }
          }
          
          eventLinks = Array.from(linkMap.values());
          debugInfo.eventLinks = eventLinks.length;
          debugInfo.totalLinks = document.querySelectorAll('a').length;
          
          console.log('[Luma Auto Register] Found ' + eventLinks.length + ' event links');
          
          if (eventLinks.length === 0) {
            console.error('[Luma Auto Register] ERROR: No event links found!');
            return { events: [], debug: debugInfo };
          }
          
          // Process each link
          for (var i = 0; i < eventLinks.length; i++) {
            var link = eventLinks[i];
            var href = link.href || link.getAttribute('href') || '';
            
            if (i < 5) {
              console.log('[Luma Auto Register] Processing: ' + href);
            }
            
            // Skip calendar pages
            if (href.indexOf('/calendar') > -1 || 
                href.indexOf('/profile') > -1 || 
                href.indexOf('BP-SideEvents') > -1) {
              debugInfo.filteredOut.push({ href: href });
              continue;
            }
            
            // Extract event ID
            var match = href.match(/(?:lu\.ma|luma\.com)\/([a-zA-Z0-9_-]+)(?:\?|$|#)/);
            if (match && match[1]) {
              var eventId = match[1];
              var title = 'Event ' + eventId;
              
              // Try to get title
              var parent = link.closest('div');
              if (parent) {
                var contentDiv = parent.querySelector('.event-content');
                if (contentDiv) {
                  var text = contentDiv.textContent.trim();
                  var lines = text.split('\n');
                  for (var j = 0; j < lines.length; j++) {
                    var line = lines[j].trim();
                    if (line.length > 10 && 
                        line.indexOf('By ') !== 0 && 
                        line.indexOf('LIVE') !== 0) {
                      title = line;
                      break;
                    }
                  }
                }
              }
              
              // Clean title
              title = title.replace(/\s+/g, ' ').trim();
              title = title.split('By ')[0].trim();
              if (title.length > 100) {
                title = title.substring(0, 100);
              }
              
              // Add event
              var exists = false;
              for (var k = 0; k < events.length; k++) {
                if (events[k].url === href) {
                  exists = true;
                  break;
                }
              }
              
              if (!exists) {
                events.push({
                  title: title,
                  url: href,
                  eventId: eventId
                });
                debugInfo.foundEvents.push({ title: title });
                if (i < 5) {
                  console.log('[Luma Auto Register] Added: ' + title);
                }
              }
            }
          }
          
          console.log('[Luma Auto Register] === COMPLETE ===');
          console.log('[Luma Auto Register] Found ' + events.length + ' events');
          
          return { events: events, debug: debugInfo };
        }
      });

      const scrapingResult = results[0]?.result;
      const scrapedEvents = scrapingResult?.events || [];
      const debugInfo = scrapingResult?.debug || {};
      
      // Log debug information
      this.sendLog('info', `Total links: ${debugInfo.totalLinks || 0}`);
      this.sendLog('info', `Event links: ${debugInfo.eventLinks || 0}`);
      this.sendLog('info', `Events extracted: ${scrapedEvents.length}`);
      
      // Format events
      const formattedEvents = scrapedEvents.map(event => ({
        title: event.title,
        url: event.url,
        selected: true,
        status: 'pending'
      }));

      // Send results back to popup
      try {
        chrome.runtime.sendMessage({
          type: 'SCAN_COMPLETE',
          events: formattedEvents,
          debug: debugInfo
        });
      } catch (error) {
        // Popup is closed, ignore
      }

      if (formattedEvents.length === 0) {
        this.sendLog('error', 'No events found. Check Debug Console for details.');
      } else {
        this.sendLog('success', `✓ Scan complete: ${formattedEvents.length} events found!`);
      }
    } catch (error) {
      this.sendLog('error', `Scan failed: ${error.message}`);
      console.error('[Luma Auto Register] Scan error:', error);
      try {
        chrome.runtime.sendMessage({
          type: 'SCAN_COMPLETE',
          events: []
        });
      } catch (e) {
        // Popup is closed, ignore
      }
    }
  }

  async startScan(url) {
    try {
      this.sendLog('info', `Opening calendar page: ${url}`);
      
      // Open the calendar page in a new VISIBLE tab (browsers prioritize visible tabs)
      // Try to open in current window, or create new window if needed
      let windowId = null;
      try {
        const currentWindow = await chrome.windows.getCurrent();
        windowId = currentWindow.id;
        this.targetWindowId = windowId; // Remember for event registration tabs
      } catch (error) {
        // Use default window
        this.targetWindowId = null;
      }
      
      const tabOptions = { url, active: true };
      if (windowId) {
        tabOptions.windowId = windowId;
      }
      const tab = await chrome.tabs.create(tabOptions);
      this.sendLog('info', '⚠️ Keep this tab open! Extension is working...');
      
      // Wait for page to load
      await this.waitForTab(tab.id);
      
      // Add extra wait for initial page load
      this.sendLog('info', 'Waiting for page to load... (5 seconds)');
      await this.sleep(5000);
      
      // Simple scrolling: scroll to bottom multiple times to load all events
      this.sendLog('info', 'Scrolling to load all events...');
      for (let i = 0; i < 15; i++) {
        try {
          const scrollResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => {
              // Get previous scroll position
              var previousScroll = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
              
              // Calculate max scroll (scroll to bottom)
              var maxScroll = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              );
              
              // Scroll to bottom using multiple methods
              window.scrollTo(0, maxScroll);
              document.documentElement.scrollTop = maxScroll;
              document.body.scrollTop = maxScroll;
              
              // Also try scrolling any scrollable containers
              var scrollableContainers = document.querySelectorAll('main, [role="main"], .main-content, #main-content, [class*="scroll"], [class*="container"]');
              for (var j = 0; j < scrollableContainers.length; j++) {
                var container = scrollableContainers[j];
                if (container.scrollHeight > container.clientHeight) {
                  container.scrollTop = container.scrollHeight;
                }
              }
              
              // Dispatch scroll events to trigger lazy loading
              window.dispatchEvent(new Event('scroll'));
              document.dispatchEvent(new Event('scroll'));
              
              // Return current scroll position
              var currentScroll = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
              return {
                previousScroll: previousScroll,
                currentScroll: currentScroll,
                maxScroll: maxScroll,
                scrolled: currentScroll >= maxScroll - 10 || currentScroll > previousScroll
              };
            }
          });
          
          const scrollInfo = scrollResult[0]?.result;
          if (scrollInfo) {
            this.sendLog('info', `  Scroll ${i + 1}/15: ${scrollInfo.scrolled ? '✓' : '⚠'} (pos: ${scrollInfo.currentScroll}/${scrollInfo.maxScroll})`);
          } else {
            this.sendLog('info', `  Scroll ${i + 1}/15 complete`);
          }
        } catch (error) {
          this.sendLog('warn', `  Scroll ${i + 1}/15 failed: ${error.message}`);
        }
        
        await this.sleep(1500); // Wait 1.5 seconds between scrolls for lazy loading
      }
      
      // Scroll back to top
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
          }
        });
      } catch (error) {
        this.sendLog('warn', `Failed to scroll to top: ${error.message}`);
      }
      await this.sleep(1500);
      
      // Wait for React to render event links - be VERY patient
      this.sendLog('info', 'Waiting for React to render event links...');
      let eventLinksFound = false;
      let attempts = 0;
      const maxAttempts = 15; // Up to 30 seconds of checking
      
      while (!eventLinksFound && attempts < maxAttempts) {
        const checkLinks = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            const eventLinks = document.querySelectorAll('a.event-link');
            const totalLinks = document.querySelectorAll('a').length;
            return { eventLinks: eventLinks.length, totalLinks: totalLinks };
          }
        });
        
        const result = checkLinks[0]?.result || { eventLinks: 0, totalLinks: 0 };
        this.sendLog('info', `  Check ${attempts + 1}/${maxAttempts}: ${result.eventLinks} event links (${result.totalLinks} total links)`);
        
        if (result.eventLinks > 0) {
          eventLinksFound = true;
          this.sendLog('success', `✓ Found ${result.eventLinks} event links!`);
        } else {
          await this.sleep(2000); // Wait 2 seconds between checks
          attempts++;
        }
      }
      
      if (!eventLinksFound) {
        this.sendLog('error', 'Event links did not render. React may not be loading properly.');
        this.sendLog('error', 'Try: 1) Refresh the page manually, 2) Scroll down, 3) Run scan again');
      }
      
      // Inject and execute event scraping
      this.sendLog('info', 'Scraping events from page...');
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: this.scrapeEventsFromPage
      });

      const scrapingResult = results[0]?.result;
      const scrapedEvents = scrapingResult?.events || [];
      const debugInfo = scrapingResult?.debug || {};
      
      // Log debug information
      this.sendLog('info', `Total links found: ${debugInfo.totalLinks || 0}`);
      this.sendLog('info', `Event links found: ${debugInfo.eventLinks || 0}`);
      this.sendLog('info', `Events extracted: ${scrapedEvents.length}`);
      
      if (debugInfo.filteredOut && debugInfo.filteredOut.length > 0) {
        this.sendLog('info', `Filtered out ${debugInfo.filteredOut.length} non-event links`);
      }
      
      // Close the tab after a short delay so user can see it worked
      this.sendLog('info', 'Closing tab in 3 seconds...');
      await this.sleep(3000);
      await chrome.tabs.remove(tab.id);
      
      // Format events
      const formattedEvents = scrapedEvents.map(event => ({
        title: event.title,
        url: event.url,
        selected: true,
        status: 'pending'
      }));

      // Send results back to popup
      try {
        chrome.runtime.sendMessage({
          type: 'SCAN_COMPLETE',
          events: formattedEvents,
          debug: debugInfo
        });
      } catch (error) {
        // Popup is closed, ignore
      }

      if (formattedEvents.length === 0) {
        this.sendLog('error', 'No events found. Check the Debug Console for details.');
      } else {
        this.sendLog('success', `✓ Scan complete: ${formattedEvents.length} events found!`);
      }
    } catch (error) {
      this.sendLog('error', `Scan failed: ${error.message}`);
      console.error('[Luma Auto Register] Scan error:', error);
      try {
        chrome.runtime.sendMessage({
          type: 'SCAN_COMPLETE',
          events: []
        });
      } catch (e) {
        // Popup is closed, ignore
      }
    }
  }

  // This function will be injected and run in the page context
  scrapeEventsFromPage() {
    const events = [];
    const debugInfo = {
      totalLinks: 0,
      eventLinks: 0,
      filteredOut: [],
      foundEvents: []
    };
    
    console.log('[Luma Auto Register] === SCRAPING STARTED ===');
    
    // Look specifically for event-link elements
    const eventLinks = document.querySelectorAll('a.event-link');
    debugInfo.eventLinks = eventLinks.length;
    debugInfo.totalLinks = document.querySelectorAll('a').length;
    
    console.log('[Luma Auto Register] Found ' + eventLinks.length + ' event links out of ' + debugInfo.totalLinks + ' total links');
    
    if (eventLinks.length === 0) {
      console.error('[Luma Auto Register] ERROR: No event links found!');
      return { events: [], debug: debugInfo };
    }
    
    for (let index = 0; index < eventLinks.length; index++) {
      const link = eventLinks[index];
      const href = link.href;
      
      if (index < 5) {
        console.log('[Luma Auto Register] Processing link ' + index + ': ' + href);
      }
      
      // Filter out non-event pages
      if (href.includes('/calendar') || 
          href.includes('/profile') || 
          href.includes('/discover') ||
          href.includes('/create') ||
          href.includes('/login') ||
          href.includes('/settings') ||
          href === 'https://lu.ma/' ||
          href === 'https://luma.com/' ||
          href.endsWith('lu.ma') ||
          href.endsWith('luma.com') ||
          href.includes('BP-SideEvents')) {
        debugInfo.filteredOut.push({ href: href, reason: 'Non-event URL' });
        continue;
      }

      // Extract event ID from URL
      const match = href.match(/(?:lu\.ma|luma\.com)\/([a-zA-Z0-9_-]+)(?:\?|$|#)/);
      if (match && match[1]) {
        const eventId = match[1];
        
        // Get title
        let title = 'Event ' + eventId;
        
        const parent = link.closest('div');
        if (parent) {
          const contentDiv = parent.querySelector('.event-content');
          if (contentDiv) {
            const fullText = contentDiv.textContent.trim();
            const lines = fullText.split('\n').filter(function(l) { return l.trim().length > 3; });
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line.match(/^\d+:\d+/) && 
                  line.indexOf('By ') !== 0 && 
                  line.indexOf('LIVE') !== 0 && 
                  !line.match(/^\+\d+/) && 
                  line.length > 10) {
                title = line;
                break;
              }
            }
          }
        }
        
        // Clean up title
        title = title.replace(/\s+/g, ' ').trim();
        title = title.replace(/^LIVE\s*/i, '').trim();
        title = title.replace(/^\d+:\d+\s*[AP]M\s*/i, '').trim();
        title = title.split('\n')[0];
        title = title.split('By ')[0].trim();
        
        if (title.length > 100) {
          title = title.substring(0, 100) + '...';
        }

        // Check if already added
        let alreadyExists = false;
        for (let i = 0; i < events.length; i++) {
          if (events[i].url === href) {
            alreadyExists = true;
            break;
          }
        }
        
        if (!alreadyExists) {
          events.push({
            title: title,
            url: href,
            eventId: eventId
          });
          debugInfo.foundEvents.push({ title: title, url: href, eventId: eventId });
          if (index < 5) {
            console.log('[Luma Auto Register] Added: ' + title);
          }
        }
      } else {
        debugInfo.filteredOut.push({ href: href, reason: 'No event ID match' });
      }
    }

    console.log('[Luma Auto Register] === SCRAPING COMPLETE ===');
    console.log('[Luma Auto Register] Final count: ' + events.length + ' events');
    
    return {
      events: events,
      debug: debugInfo
    };
  }

  async startRegistration(events, settings, senderWindowId = null) {
    this.queue = events.map(e => ({ ...e, status: 'pending' }));
    
    // IMPORTANT: Force sequential processing (1 at a time) to ensure each tab stays active
    // Background tabs are throttled by Chrome and scripts don't work properly
    this.settings = {
      ...settings,
      parallelTabs: 1  // Override to 1 to ensure tabs stay active and visible
    };
    
    // Determine which window to use for registration tabs
    // Priority: 1) Window passed from sender, 2) Existing targetWindowId, 3) Create new window
    let targetWindowId = null;
    
    // First, try to use the window where registration was started (popup/dashboard window)
    if (senderWindowId) {
      try {
        await chrome.windows.get(senderWindowId);
        targetWindowId = senderWindowId;
        this.sendLog('info', `Using window ${targetWindowId} where registration was started`);
      } catch (error) {
        this.sendLog('warn', `Sender window ${senderWindowId} no longer exists, trying alternatives`);
      }
    }
    
    // If sender window not available, try existing targetWindowId
    if (!targetWindowId && this.targetWindowId) {
      try {
        await chrome.windows.get(this.targetWindowId);
        targetWindowId = this.targetWindowId;
        this.sendLog('info', `Using existing target window ${targetWindowId}`);
      } catch (error) {
        this.sendLog('warn', `Existing target window ${this.targetWindowId} no longer exists`);
        this.targetWindowId = null;
      }
    }
    
    // If still no window, create a dedicated background window
    if (!targetWindowId) {
      try {
        const backgroundWindow = await chrome.windows.create({
          url: 'about:blank',
          focused: false,  // Don't steal focus when created
          type: 'normal',
          state: 'normal'  // Normal window (not minimized, but won't focus)
        });
        targetWindowId = backgroundWindow.id;
        this.sendLog('info', `Created dedicated background window ${targetWindowId} for registration tabs`);
        
        // Close the initial blank tab
        if (backgroundWindow.tabs && backgroundWindow.tabs.length > 0) {
          chrome.tabs.remove(backgroundWindow.tabs[0].id).catch(() => {});
        }
      } catch (error) {
        this.sendLog('warn', `Could not create background window: ${error.message}, using current window`);
        // Fallback to current window if creation fails
        try {
          const currentWindow = await chrome.windows.getCurrent();
          targetWindowId = currentWindow.id;
        } catch (e) {
          targetWindowId = null;
        }
      }
    }
    
    // Store the target window ID
    this.targetWindowId = targetWindowId;
    if (targetWindowId) {
      // Persist to storage so it survives extension reloads
      await chrome.storage.local.set({ targetWindowId: targetWindowId });
      this.sendLog('info', `Target window set to ${targetWindowId} (persisted)`);
    }
    
    this.processing = true;
    this.paused = false;
    this.results = [];
    this.stats = {
      processed: 0,
      success: 0,
      failed: 0,
      manual: 0,
      pending: events.length,
      total: events.length
    };

    // Show start notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../icons/icon48.png',
      title: 'Luma Auto Register',
      message: `Starting registration for ${events.length} events (processing one at a time)...`,
      priority: 2
    }).catch(() => {}); // Ignore errors

    await this.saveState();
    this.processQueue();
  }

  async processQueue() {
    if (!this.processing || this.paused) return;

    while (this.queue.length > 0 && this.processing && !this.paused) {
      // Process in parallel batches
      const batch = this.queue.splice(0, this.settings.parallelTabs);
      const promises = batch.map(event => this.registerForEvent(event));
      
      await Promise.allSettled(promises);
      
      // Update stats
      this.updateStats();
      
      // Random delay between batches
      if (this.queue.length > 0) {
        const delay = this.settings.delayBetween + Math.random() * 1000; // Reduced random component from 2000ms to 1000ms
        await this.sleep(delay);
      }
    }

    if (this.queue.length === 0) {
      this.processing = false;
      
      // Clear badge
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
      
      // Show completion notification
      const manualText = this.stats.manual > 0 ? ` | ⚠️ Manual: ${this.stats.manual}` : '';
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '../icons/icon48.png',
        title: 'Luma Auto Register - Complete!',
        message: `✓ Success: ${this.stats.success} | ✗ Failed: ${this.stats.failed}${manualText}`,
        priority: 2
      }).catch(() => {}); // Ignore errors
      
      // Send completion message to dashboard (catch error if dashboard is closed)
      try {
        chrome.runtime.sendMessage({
          type: 'REGISTRATION_COMPLETE'
        });
      } catch (error) {
        // Dashboard is closed, ignore
      }
      
      this.sendLog('success', `Registration complete! Success: ${this.stats.success}, Failed: ${this.stats.failed}, Manual: ${this.stats.manual}`);
      await this.saveState();
    }
  }

  async registerForEvent(event) {
    let tab;
    try {
      this.sendLog('info', `Opening: ${event.title}`);
      
      // Load user settings for auto-filling forms
      const settingsResult = await chrome.storage.local.get('userSettings');
      const userSettings = settingsResult.userSettings || {};
      
      // Determine which window to open tabs in
      // Always use the targetWindowId that was set when registration started
      let windowId = this.targetWindowId;
      
      if (windowId) {
        // Verify the window still exists
        try {
          await chrome.windows.get(windowId);
          // Window exists, use it
        } catch (error) {
          // Window doesn't exist anymore, create a new one and update targetWindowId
          this.sendLog('warn', `  Target window ${windowId} no longer exists, creating new window`);
          try {
            const newWindow = await chrome.windows.create({
              url: 'about:blank',
              focused: false,
              type: 'normal',
              state: 'normal'
            });
            windowId = newWindow.id;
            this.targetWindowId = windowId;
            await chrome.storage.local.set({ targetWindowId: windowId });
            this.sendLog('info', `  Created new target window ${windowId}`);
            
            // Close the initial blank tab
            if (newWindow.tabs && newWindow.tabs.length > 0) {
              chrome.tabs.remove(newWindow.tabs[0].id).catch(() => {});
            }
          } catch (createError) {
            this.sendLog('error', `  Could not create new window: ${createError.message}`);
            windowId = null;
          }
        }
      } else {
        // This shouldn't happen if startRegistration worked, but handle it anyway
        this.sendLog('warn', `  No target window set, creating new window`);
        try {
          const newWindow = await chrome.windows.create({
            url: 'about:blank',
            focused: false,
            type: 'normal',
            state: 'normal'
          });
          windowId = newWindow.id;
          this.targetWindowId = windowId;
          await chrome.storage.local.set({ targetWindowId: windowId });
          this.sendLog('info', `  Created new target window ${windowId}`);
          
          // Close the initial blank tab
          if (newWindow.tabs && newWindow.tabs.length > 0) {
            chrome.tabs.remove(newWindow.tabs[0].id).catch(() => {});
          }
        } catch (createError) {
          this.sendLog('error', `  Could not create new window: ${createError.message}`);
          windowId = null;
        }
      }
      
      // Open event page - tabs must be active for proper rendering
      // Background tabs are throttled and may not render forms properly
      // We keep tabs in the same window for organization
      const tabOptions = { 
        url: event.url, 
        active: true // Must be active for proper DOM rendering and form detection
      };
      
      // Only add windowId if we have a valid one
      if (windowId) {
        tabOptions.windowId = windowId;
      }
      
      tab = await chrome.tabs.create(tabOptions);
      this.activeTabs.set(tab.id, event);
      
      this.sendLog('info', `  Tab opened: ${tab.id} in background window`);
      
      // Ensure the background window doesn't steal focus after tab creation
      // The window was created with focused: false, but we make sure it stays that way
      if (windowId) {
        setTimeout(async () => {
          try {
            // Update window to ensure it doesn't have focus
            await chrome.windows.update(windowId, { focused: false });
          } catch (error) {
            // Window might be closed, ignore
          }
        }, 50); // Small delay to let tab creation complete
      }
      
      // Wait for page to load
      await this.waitForTab(tab.id);
      
      // Give extra time for page to fully load
      this.sendLog('info', `  Waiting for page to load...`);
      await this.sleep(2000); // Reduced from 3000ms for faster processing
      
      this.sendLog('info', `  Injecting registration script...`);
      
      // Create a timeout promise (15 seconds)
      // This covers the full registration flow when there are no required questions
      // (or nothing is actively being filled), which should be quick.
      const REGISTRATION_TIMEOUT = 15000; // 15 seconds
      const CLOUDFLARE_EXTENDED_TIMEOUT = 90000; // 90 seconds if Cloudflare detected (increased for verification)
      
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(async () => {
          // Check if there's a Cloudflare popup before timing out
          try {
            const cloudflareCheck = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              function: () => {
                var bodyText = (document.body.textContent || '').toLowerCase();
                var bodyHTML = (document.body.innerHTML || '').toLowerCase();
                var hasCloudflare = bodyText.indexOf('verifying your browser') > -1 ||
                                   bodyText.indexOf("we're doing a quick check") > -1 ||
                                   bodyText.indexOf('verifying...') > -1 ||
                                   bodyText.indexOf('cloudflare') > -1 ||
                                   bodyHTML.indexOf('cf-browser-verification') > -1 ||
                                   bodyHTML.indexOf('challenge-platform') > -1 ||
                                   document.querySelector('[id*="cf-"], [class*="cf-"], [id*="challenge"], [class*="challenge"]') !== null;
                return hasCloudflare;
              }
            });
            
            const hasCloudflare = cloudflareCheck[0]?.result || false;
            
            if (hasCloudflare) {
              this.sendLog('info', `  Cloudflare challenge detected - extending timeout to ${CLOUDFLARE_EXTENDED_TIMEOUT / 1000} seconds`);
              // Extend timeout for Cloudflare - wait additional time
              setTimeout(() => {
                resolve({ timeout: true, cloudflare: true });
              }, CLOUDFLARE_EXTENDED_TIMEOUT - REGISTRATION_TIMEOUT);
              return; // Don't resolve yet, wait for extended timeout
            }
          } catch (error) {
            // If we can't check for Cloudflare, proceed with timeout
            this.sendLog('warn', `  Could not check for Cloudflare: ${error.message}`);
          }
          
          // No Cloudflare or check failed - timeout now
          resolve({ timeout: true, cloudflare: false });
        }, REGISTRATION_TIMEOUT);
      });
      
      // Inject and execute registration with inline function
      // IMPORTANT: Run in the MAIN world so we can observe the page's own fetch()
      // requests (for accurate registration success detection).
      const registrationPromise = chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [userSettings],
        function: function(settings) {
          return new Promise(function(resolve) {
            try {
              console.log('[Luma Auto Register] === REGISTRATION STARTED ===');
              
              // Reset network success flag for this registration attempt
              if (typeof window !== 'undefined') {
                window.__lumaAutoRegisterNetworkSuccessFlag = false;
                
                // Patch fetch once to detect successful registration responses
                try {
                  if (!window.__lumaAutoRegisterFetchPatched && window.fetch) {
                    window.__lumaAutoRegisterFetchPatched = true;
                    var originalFetch = window.fetch;
                    window.fetch = function() {
                      return originalFetch.apply(this, arguments).then(function(response) {
                        try {
                          var url = response && response.url ? response.url : '';
                          
                          // Detect direct registration responses
                          if (url.indexOf('/event/register') > -1) {
                            response.clone().json().then(function(data) {
                              try {
                                if (data && (data.status === 'success' || data.approval_status === 'approved')) {
                                  window.__lumaAutoRegisterNetworkSuccessFlag = true;
                                  console.log('[Luma Auto Register] ✓ Network registration success detected (fetch /event/register)');
                                }
                              } catch (e) {}
                            }).catch(function(){});
                          }
                          
                          // Also detect status responses that show current user as a guest
                          if (url.indexOf('get?event_api_id=') > -1) {
                            response.clone().json().then(function(data) {
                              try {
                                if (data) {
                                  var gd = data.guest_data || {};
                                  var role = data.role || {};
                                  var hasTicket = !!(gd.ticket_key || (gd.event_tickets && gd.event_tickets.length > 0));
                                  var isGuestRole = role && role.type === 'guest' && !!role.ticket_key;
                                  
                                  if (hasTicket || isGuestRole) {
                                    window.__lumaAutoRegisterNetworkSuccessFlag = true;
                                    console.log('[Luma Auto Register] ✓ Network registration success detected (fetch get?event_api_id) – user has ticket/guest role');
                                  }
                                }
                              } catch (e) {}
                            }).catch(function(){});
                          }
                        } catch (e) {}
                        return response;
                      });
                    };
                  }
                } catch (e) {
                  console.log('[Luma Auto Register] Could not patch fetch for network success detection: ' + e.message);
                }
              }
              
              // Show a gentle overlay to indicate automation is running and discourage manual edits
              try {
                if (typeof document !== 'undefined' && document.body) {
                  // Avoid duplicating the overlay if for some reason the script runs twice
                  if (!document.getElementById('__lumaAutoRegisterOverlay')) {
                    // Create full-screen overlay background
                    var overlay = document.createElement('div');
                    overlay.id = '__lumaAutoRegisterOverlay';
                    overlay.style.position = 'fixed';
                    overlay.style.left = '0';
                    overlay.style.top = '0';
                    overlay.style.right = '0';
                    overlay.style.bottom = '0';
                    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
                    overlay.style.zIndex = '2147483646'; // High z-index but below the message box
                    overlay.style.pointerEvents = 'none'; // Do not block clicks, just inform
                    overlay.style.display = 'flex';
                    overlay.style.alignItems = 'flex-start';
                    overlay.style.justifyContent = 'center';
                    overlay.style.paddingTop = '20px';
                    
                    // Create message box
                    var box = document.createElement('div');
                    box.style.background = 'rgba(15,23,42,0.95)';
                    box.style.color = '#e5e7eb';
                    box.style.padding = '16px 20px';
                    box.style.borderRadius = '8px';
                    box.style.fontSize = '14px';
                    box.style.fontFamily = '-apple-system, system-ui, sans-serif';
                    box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
                    box.style.maxWidth = '500px';
                    box.style.zIndex = '2147483647'; // Highest z-index
                    box.style.textAlign = 'center';
                    box.style.lineHeight = '1.5';
                    box.textContent = 'Luma Auto Register is filling this form. For best results, avoid editing fields until it finishes. To pause or stop, click the Luma Auto Register icon in Chrome\'s toolbar.';
                    
                    overlay.appendChild(box);
                    document.body.appendChild(overlay);
                  }
                }
              } catch (overlayError) {
                console.log('[Luma Auto Register] Could not show helper overlay: ' + overlayError.message);
              }
              
              // Look for registration button - Luma uses specific text
              var allButtons = document.querySelectorAll('button, a[role="button"], div[role="button"]');
              console.log('[Luma Auto Register] Found ' + allButtons.length + ' buttons');
              
              var registerBtn = null;
              for (var i = 0; i < allButtons.length; i++) {
                var btn = allButtons[i];
                var text = btn.textContent.trim();
                
                console.log('[Luma Auto Register] Button ' + i + ': "' + text + '"');
                
                // Luma specific button texts
                if (text === 'One-Click RSVP' ||
                    text === 'One-Click Apply' ||
                    text === 'Request to Join' ||
                    text === 'Register' ||
                    text.indexOf('RSVP') > -1 ||
                    text.indexOf('Register') > -1 ||
                    text.indexOf('Join') > -1 ||
                    text.indexOf('Apply') > -1) {
                  registerBtn = btn;
                  console.log('[Luma Auto Register] ✓ Found register button: "' + text + '"');
                  break;
                }
              }

              if (!registerBtn) {
                console.log('[Luma Auto Register] No register button found, checking status...');
                var bodyText = document.body.textContent || '';
                var bodyTextLower = bodyText.toLowerCase();
                
                // If no obvious register button but the page clearly shows paid ticket prices,
                // treat this as a paid event that requires manual review.
                try {
                  var bodyTextUpper = bodyText.toUpperCase();
                  var paidPattern = /(\bCA\$|\$|£|€|₹|INR|USD|CAD|EUR)\s*\d/;
                  var hasMoney = paidPattern.test(bodyTextUpper);
                  
                  // If we see any explicit currency amount on the page but no obvious
                  // "Register" style button, treat this as a paid ticketed event that
                  // requires manual review. We intentionally ignore generic "FREE"
                  // mentions elsewhere on the page (e.g. "subscribe for free") because
                  // they don't change the fact that tickets cost money.
                  if (hasMoney) {
                    console.log('[Luma Auto Register] ⚠️ Paid tickets detected (no free registration button) - requiring manual review.');
                    resolve({
                      success: false,
                      requiresManual: true,
                      message: 'Paid ticket detected (no free registration option) - manual registration required'
                    });
                    return;
                  }
                } catch (paidDetectError) {
                  console.log('[Luma Auto Register] Error while detecting paid event (no button case): ' + paidDetectError.message);
                }
                
                // Check if already registered
                if (bodyText.indexOf("You're going") > -1 ||
                    bodyText.indexOf("You're registered") > -1 ||
                    bodyText.indexOf("You're In") > -1 ||
                    bodyText.indexOf("You're in") > -1 ||
                    bodyText.indexOf("Already registered") > -1 ||
                    bodyText.indexOf("Request pending") > -1 ||
                    bodyText.indexOf("Approval pending") > -1 ||
                    bodyText.indexOf("Pending Approval") > -1 ||
                    bodyText.indexOf("pending approval") > -1 ||
                    bodyText.indexOf("You're on the Waitlist") > -1 ||
                    bodyText.indexOf("You're on the waitlist") > -1 ||
                    bodyText.indexOf("on the Waitlist") > -1 ||
                    bodyText.indexOf("on the waitlist") > -1 ||
                    bodyTextLower.indexOf("thank you for joining") > -1 ||
                    bodyTextLower.indexOf("thanks for joining") > -1) {
                  console.log('[Luma Auto Register] ✓ Already registered, pending approval, or on waitlist!');
                  resolve({ success: true, message: 'Already registered, pending approval, or on waitlist' });
                  return;
                }
                
                // Check if event is full
                var isEventFull = bodyText.indexOf('Event Full') > -1 ||
                                  bodyText.indexOf('Sold Out') > -1 ||
                                  bodyText.indexOf('No spots available') > -1;
                if (isEventFull) {
                  // If we also detect any paid ticket prices on the page, treat this as a
                  // paid event that requires manual review rather than a generic "full" event.
                  try {
                    var bodyTextUpper2 = bodyText.toUpperCase();
                    var paidPattern2 = /(\bCA\$|\$|£|€|₹|INR|USD|CAD|EUR)\s*\d/;
                    var hasMoney2 = paidPattern2.test(bodyTextUpper2);
                    
                    if (hasMoney2) {
                      console.log('[Luma Auto Register] ⚠️ Event has paid tickets and shows \"Sold Out\" text - treating as paid/manual, not generic full.');
                      resolve({
                        success: false,
                        requiresManual: true,
                        message: 'Paid ticket detected with sold-out wording - manual registration / waitlist required'
                      });
                      return;
                    }
                  } catch (paidFullError) {
                    console.log('[Luma Auto Register] Error while refining full/paid detection: ' + paidFullError.message);
                  }
                  
                  console.log('[Luma Auto Register] ✗ Event is full');
                  resolve({ success: false, message: 'Event is full' });
                  return;
                }
                
                console.log('[Luma Auto Register] ✗ No register button found');
                resolve({ success: false, message: 'Registration button not found' });
                return;
              }

              // Before clicking, detect if this is a PAID event (non-free ticket)
              // If so, require manual review instead of auto-registering.
              try {
                var paidEventDetected = false;
                var paidContainer = registerBtn.closest('section, div');
                var paidPattern = /(\bca\$|\$|£|€|₹|inr|usd|cad|eur)\s*\d/i;
                
                // Walk up a few levels from the button looking for currency + amount,
                // but ignore obvious "Free" indicators and $0-style prices.
                var depth = 0;
                var maxDepth = 4;
                while (paidContainer && depth < maxDepth && !paidEventDetected) {
                  var text = (paidContainer.textContent || '').toUpperCase();
                  if (paidPattern.test(text)) {
                    if (text.indexOf('FREE') === -1 && text.indexOf('$0') === -1 && text.indexOf('CA$0') === -1) {
                      paidEventDetected = true;
                      break;
                    }
                  }
                  paidContainer = paidContainer.parentElement;
                  depth++;
                }
                
                if (paidEventDetected) {
                  console.log('[Luma Auto Register] ⚠️ Paid event detected near register button - requiring manual review (no auto-registration).');
                  resolve({
                    success: false,
                    requiresManual: true,
                    message: 'Paid event detected (ticket price > 0) - manual review required'
                  });
                  return;
                }
              } catch (paidError) {
                console.log('[Luma Auto Register] Error while detecting paid event: ' + paidError.message);
              }

              // Click the register button
              var buttonText = registerBtn.textContent.trim();
              console.log('[Luma Auto Register] Clicking: "' + buttonText + '"');
              
              // Check if this is a One-Click RSVP (no form needed)
              var isOneClickRSVP = buttonText === 'One-Click RSVP' || buttonText === 'One-Click Apply';
              
              registerBtn.click();

              // For One-Click RSVP, skip form processing and check for success directly
              if (isOneClickRSVP) {
                console.log('[Luma Auto Register] One-Click RSVP detected - skipping form processing');
                console.log('[Luma Auto Register] Waiting for registration to complete...');
                
                // Wait for page to update after click - give more time for React to render
                setTimeout(function() {
                  console.log('[Luma Auto Register] === CHECKING REGISTRATION RESULT (One-Click RSVP) ===');
                  
                  // Check for success messages with multiple attempts
                  var checkForSuccess = function() {
                    // Normalization helper to handle curly quotes, case, etc.
                    var normalizeText = function(str) {
                      return (str || '')
                        .toLowerCase()
                        .replace(/[\u2018\u2019\u201B]/g, "'"); // map curly apostrophes to '
                    };
                    
                    // Check multiple sources for success indicators
                    var bodyText = document.body.textContent || '';
                    var bodyHTML = document.body.innerHTML || '';
                    var bodyTextLower = normalizeText(bodyText);
                    var bodyHTMLLower = normalizeText(bodyHTML);
                    
                    // Also check for specific elements that might contain success messages
                    var successElements = document.querySelectorAll('h1, h2, h3, [class*="success"], [class*="confirm"], [class*="registered"], [class*="in"]');
                    var elementText = '';
                    for (var el = 0; el < successElements.length; el++) {
                      var elText = (successElements[el].textContent || '').trim();
                      if (elText.length > 0 && elText.length < 100) {
                        elementText += ' ' + elText;
                      }
                    }
                    var elementTextLower = normalizeText(elementText);
                    
                    // Check for success indicators in all sources (case-insensitive)
                    // Also check variants like "you are in", "already registered",
                    // and approval-based flows (Approval Required / subject to host approval)
                    var success = bodyTextLower.indexOf("you're going") > -1 ||
                                  bodyTextLower.indexOf("you're registered") > -1 ||
                                  bodyTextLower.indexOf("you're in") > -1 ||
                                  bodyTextLower.indexOf("youre in") > -1 || // Without apostrophe
                                  bodyTextLower.indexOf("you are in") > -1 || // Alternative phrasing
                                  bodyHTMLLower.indexOf("you're going") > -1 ||
                                  bodyHTMLLower.indexOf("you're registered") > -1 ||
                                  bodyHTMLLower.indexOf("you're in") > -1 ||
                                  bodyHTMLLower.indexOf("youre in") > -1 || // Without apostrophe
                                  bodyHTMLLower.indexOf("you are in") > -1 || // Alternative phrasing
                                  elementTextLower.indexOf("you're going") > -1 ||
                                  elementTextLower.indexOf("you're registered") > -1 ||
                                  elementTextLower.indexOf("you're in") > -1 ||
                                  elementTextLower.indexOf("youre in") > -1 || // Without apostrophe
                                  elementTextLower.indexOf("you are in") > -1 || // Alternative phrasing
                                  bodyTextLower.indexOf("pending approval") > -1 ||
                                  bodyTextLower.indexOf("approval required") > -1 ||
                                  bodyTextLower.indexOf("subject to host approval") > -1 ||
                                  bodyTextLower.indexOf("registration confirmed") > -1 ||
                                  bodyTextLower.indexOf("registration successful") > -1 ||
                                  bodyTextLower.indexOf("successfully registered") > -1 ||
                                  bodyTextLower.indexOf("you're on the waitlist") > -1 ||
                                  bodyTextLower.indexOf("on the waitlist") > -1 ||
                                  bodyTextLower.indexOf("we will let you know when the host approves") > -1 ||
                                  bodyTextLower.indexOf("thank you for joining") > -1 ||
                                  bodyTextLower.indexOf("thanks for joining") > -1 ||
                                  bodyTextLower.indexOf("already registered") > -1; // Also check for "already registered" message
                    
                    // Fallback: trust network success flag if DOM hasn't updated yet
                    if (!success && typeof window !== 'undefined' && window.__lumaAutoRegisterNetworkSuccessFlag) {
                      console.log('[Luma Auto Register] Success inferred from network response (One-Click RSVP)');
                      success = true;
                    }
                    
                    console.log('[Luma Auto Register] Success check - bodyText length: ' + bodyText.length + ', found success: ' + success);
                    if (bodyText.length > 0 && bodyText.length < 500) {
                      console.log('[Luma Auto Register] Page text preview: ' + bodyText.substring(0, 300));
                    }
                    if (elementText.length > 0) {
                      console.log('[Luma Auto Register] Success element text: ' + elementText.substring(0, 200));
                    }
                    
                    return { success: success, bodyText: bodyText, bodyHTML: bodyHTML };
                  };
                  
                  // First check after 4 seconds (increased to give React more time to render)
                  var result1 = checkForSuccess();
                  if (result1.success) {
                    console.log('[Luma Auto Register] ✓✓✓ REGISTRATION CONFIRMED! (One-Click RSVP - first check)');
                    resolve({ 
                      success: true,
                      message: 'Registered successfully via One-Click RSVP'
                    });
                    return;
                  }
                  
                  console.log('[Luma Auto Register] First check failed, waiting for second check...');
                  
                  // Second check after 3 more seconds
                  setTimeout(function() {
                    var result2 = checkForSuccess();
                    if (result2.success) {
                      console.log('[Luma Auto Register] ✓✓✓ REGISTRATION CONFIRMED! (One-Click RSVP - second check)');
                      resolve({ 
                        success: true,
                        message: 'Registered successfully via One-Click RSVP'
                      });
                      return;
                    }
                    
                    console.log('[Luma Auto Register] Second check failed, waiting for third check...');
                    
                    // Third check after 3 more seconds
                    setTimeout(function() {
                      var result3 = checkForSuccess();
                      if (result3.success) {
                        console.log('[Luma Auto Register] ✓✓✓ REGISTRATION CONFIRMED! (One-Click RSVP - third check)');
                        resolve({ 
                          success: true,
                          message: 'Registered successfully via One-Click RSVP'
                        });
                      } else {
                        console.log('[Luma Auto Register] ✗✗✗ COULD NOT CONFIRM REGISTRATION (One-Click RSVP)');
                        console.log('[Luma Auto Register] Page text sample: ' + (result3.bodyText || '').substring(0, 500));
                        console.log('[Luma Auto Register] Page HTML sample: ' + (result3.bodyHTML || '').substring(0, 500));
                        resolve({ 
                          success: false, 
                          message: 'Could not confirm registration - please check manually'
                        });
                      }
                    }, 3000);
                  }, 3000);
                }, 4000); // Increased to 4 seconds for initial wait to give React more time to render
                
                return; // Exit early, don't process form
              }

              // Wait for modal/form to appear and check for custom fields
              // Use polling to wait for form to actually appear
              var waitForForm = function(attempts, maxAttempts) {
                attempts = attempts || 0;
                maxAttempts = maxAttempts || 30; // Try for up to 15 seconds (30 attempts * 500ms) - increased for slower loading forms
                
                console.log('[Luma Auto Register] === FORM PROCESSING STARTED (attempt ' + (attempts + 1) + ') ===');
                console.log('[Luma Auto Register] Checking for registration form...');
                
                // Look for form in modals/dialogs first, then in document
                var formContainer = null;
                var modalSelectors = [
                  '[role="dialog"]',
                  '.modal',
                  '[class*="modal"]',
                  '[class*="Modal"]',
                  '[class*="dialog"]',
                  '[class*="Dialog"]',
                  '[class*="form"]',
                  '[class*="Form"]',
                  '[class*="waitlist"]',
                  '[class*="Waitlist"]',
                  'form'
                ];
                
                // Check modals first
                for (var ms = 0; ms < modalSelectors.length; ms++) {
                  var modals = document.querySelectorAll(modalSelectors[ms]);
                  console.log('[Luma Auto Register] Checking ' + modals.length + ' elements matching: ' + modalSelectors[ms]);
                  for (var m = 0; m < modals.length; m++) {
                    var modal = modals[m];
                    // Check if modal is actually visible (or check display style)
                    var isVisible = modal.offsetParent !== null;
                    var style = window.getComputedStyle(modal);
                    var display = style.display;
                    var visibility = style.visibility;
                    var opacity = parseFloat(style.opacity) || 1;
                    
                    // Consider visible if offsetParent exists OR if it's not display:none
                    if (isVisible || (display !== 'none' && visibility !== 'hidden' && opacity > 0)) {
                      // Check if modal has form inputs
                      var inputsInModal = modal.querySelectorAll('input, textarea, select');
                      var visibleInputs = [];
                      for (var vi = 0; vi < inputsInModal.length; vi++) {
                        var inp = inputsInModal[vi];
                        if (inp.type !== 'hidden' && inp.type !== 'submit' && inp.type !== 'button') {
                          var inpStyle = window.getComputedStyle(inp);
                          if (inp.offsetParent !== null || (inpStyle.display !== 'none' && inpStyle.visibility !== 'hidden')) {
                            visibleInputs.push(inp);
                          }
                        }
                      }
                      
                      if (visibleInputs.length > 0) {
                        formContainer = modal;
                        console.log('[Luma Auto Register] ✓ Found form in modal: ' + modalSelectors[ms] + ' with ' + visibleInputs.length + ' visible inputs (out of ' + inputsInModal.length + ' total)');
                        break;
                      } else if (inputsInModal.length > 0) {
                        console.log('[Luma Auto Register] Found modal with ' + inputsInModal.length + ' inputs but none are visible yet');
                      }
                    }
                  }
                  if (formContainer) break;
                }
                
                // If no modal found, check document for form inputs (including those that might be in portals or shadow DOM)
                if (!formContainer) {
                  var allInputs = document.querySelectorAll('input, textarea, select');
                  console.log('[Luma Auto Register] Checking ' + allInputs.length + ' total inputs in document');
                  if (allInputs.length > 0) {
                    // Check if any are visible
                    var visibleCount = 0;
                    for (var ai = 0; ai < allInputs.length; ai++) {
                      var inp = allInputs[ai];
                      if (inp.type !== 'hidden' && inp.type !== 'submit' && inp.type !== 'button') {
                        var inpStyle = window.getComputedStyle(inp);
                        var isInpVisible = inp.offsetParent !== null || (inpStyle.display !== 'none' && inpStyle.visibility !== 'hidden');
                        if (isInpVisible) {
                          visibleCount++;
                          if (!formContainer) {
                            formContainer = document.body;
                            console.log('[Luma Auto Register] Found visible form inputs in document body');
                          }
                        }
                      }
                    }
                    if (visibleCount > 0) {
                      console.log('[Luma Auto Register] Found ' + visibleCount + ' visible inputs in document');
                    }
                  }
                  
                  // Also check for inputs by looking for common form labels/placeholders
                  if (!formContainer) {
                    var labelSelectors = [
                      'label:contains("Name")',
                      'label:contains("Email")',
                      'label:contains("name")',
                      'label:contains("email")'
                    ];
                    
                    // Check for inputs near labels with common form text
                    var allLabels = document.querySelectorAll('label');
                    for (var li = 0; li < allLabels.length; li++) {
                      var label = allLabels[li];
                      var labelText = (label.textContent || '').toLowerCase();
                      if (labelText.indexOf('name') > -1 || labelText.indexOf('email') > -1) {
                        // Check if there's an input associated with this label
                        var associatedInput = null;
                        if (label.htmlFor) {
                          associatedInput = document.getElementById(label.htmlFor);
                        }
                        if (!associatedInput) {
                          associatedInput = label.querySelector('input, textarea, select');
                        }
                        if (!associatedInput) {
                          // Check next sibling
                          associatedInput = label.nextElementSibling;
                          if (associatedInput && !['input', 'textarea', 'select'].includes(associatedInput.tagName.toLowerCase())) {
                            associatedInput = associatedInput.querySelector('input, textarea, select');
                          }
                        }
                        
                        if (associatedInput && (associatedInput.tagName.toLowerCase() === 'input' || 
                            associatedInput.tagName.toLowerCase() === 'textarea' || 
                            associatedInput.tagName.toLowerCase() === 'select')) {
                          formContainer = document.body;
                          console.log('[Luma Auto Register] Found form by label text: "' + label.textContent.substring(0, 50) + '"');
                          break;
                        }
                      }
                    }
                  }
                }
                
                // Also check iframes for form inputs (some forms load in iframes)
                if (!formContainer) {
                  try {
                    var iframes = document.querySelectorAll('iframe');
                    console.log('[Luma Auto Register] Checking ' + iframes.length + ' iframes for form inputs');
                    for (var ifi = 0; ifi < iframes.length; ifi++) {
                      try {
                        var iframe = iframes[ifi];
                        var iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                        if (iframeDoc) {
                          var iframeInputs = iframeDoc.querySelectorAll('input, textarea, select');
                          if (iframeInputs.length > 0) {
                            formContainer = iframeDoc.body;
                            console.log('[Luma Auto Register] Found form in iframe with ' + iframeInputs.length + ' inputs');
                            break;
                          }
                        }
                      } catch (e) {
                        // Cross-origin iframe, skip
                      }
                    }
                  } catch (e) {
                    console.log('[Luma Auto Register] Could not check iframes: ' + e.message);
                  }
                }
                
                // If form not found and we haven't exceeded max attempts, wait and try again
                if (!formContainer && attempts < maxAttempts) {
                  console.log('[Luma Auto Register] Form not found yet, waiting 500ms before retry... (found ' + document.querySelectorAll('input, textarea, select').length + ' total inputs in DOM)');
                  setTimeout(function() {
                    waitForForm(attempts + 1, maxAttempts);
                  }, 500);
                  return;
                }
                
                // If still no form after max attempts, proceed anyway (might be a different flow)
                if (!formContainer) {
                  console.log('[Luma Auto Register] ⚠️ Form not found after ' + maxAttempts + ' attempts, proceeding anyway...');
                  console.log('[Luma Auto Register] Debug: Found ' + document.querySelectorAll('input, textarea, select').length + ' total inputs, ' + 
                             document.querySelectorAll('[role="dialog"]').length + ' dialogs, ' + 
                             document.querySelectorAll('.modal, [class*="modal"]').length + ' modals');
                  formContainer = document.body; // Use document body as fallback
                }
                
                // Now process the form with the found container
                processForm(formContainer);
              };
              
              // Start waiting for form (will call processForm when found)
              waitForForm(0, 10);
              
              // Form processing function (called after form is found)
              function processForm(formContainer) {
                // Helper function to handle terms acceptance modal
                var handleTermsModal = function(callback) {
                  // Check if we've already handled the terms modal
                  if (typeof window !== 'undefined' && window.__lumaTermsModalHandled) {
                    console.log('[Luma Auto Register] Terms modal already handled, skipping duplicate check...');
                    return false;
                  }
                  
                  var termsModal = null;
                  var modalSelectors = [
                    '[role="dialog"]',
                    '.modal',
                    '[class*="modal"]',
                    '[class*="Modal"]',
                    '[class*="dialog"]',
                    '[class*="Dialog"]',
                    '[class*="overlay"]',
                    '[class*="Overlay"]',
                    '[class*="popup"]',
                    '[class*="Popup"]'
                  ];
                  
                  // First, try to find modal by text content (more reliable)
                  for (var ms = 0; ms < modalSelectors.length; ms++) {
                    var modals = document.querySelectorAll(modalSelectors[ms]);
                    for (var m = 0; m < modals.length; m++) {
                      var modal = modals[m];
                      // Check if modal is actually visible
                      if (!modal.offsetParent) continue;
                      var modalText = (modal.textContent || '').toLowerCase();
                      // More flexible matching for terms acceptance modals
                      if (modalText.indexOf('accept terms') > -1 || 
                          modalText.indexOf('accept term') > -1 ||
                          (modalText.indexOf('sign') > -1 && modalText.indexOf('accept') > -1) ||
                          (modalText.indexOf('type') > -1 && modalText.indexOf('name') > -1 && modalText.indexOf('agree') > -1) ||
                          (modalText.indexOf('confirm') > -1 && modalText.indexOf('agree') > -1)) {
                        termsModal = modal;
                        console.log('[Luma Auto Register] Found terms modal via text match: "' + (modalText.substring(0, 100)) + '"');
                        break;
                      }
                    }
                    if (termsModal) break;
                  }
                  
                  // If not found by text, try finding by button text (e.g., "Sign & Accept")
                  if (!termsModal) {
                    var allButtons = document.querySelectorAll('button');
                    for (var b = 0; b < allButtons.length; b++) {
                      var btn = allButtons[b];
                      if (!btn.offsetParent) continue; // Must be visible
                      var btnText = (btn.textContent || '').toLowerCase();
                      if ((btnText.indexOf('sign') > -1 && btnText.indexOf('accept') > -1) ||
                          btnText === 'sign & accept' ||
                          btnText === 'sign and accept') {
                        // Found the button, now find its modal parent
                        var parent = btn;
                        for (var p = 0; p < 10; p++) { // Search up to 10 levels up
                          parent = parent.parentElement;
                          if (!parent) break;
                          var parentText = (parent.textContent || '').toLowerCase();
                          if (parentText.indexOf('accept') > -1 || parentText.indexOf('terms') > -1) {
                            termsModal = parent;
                            console.log('[Luma Auto Register] Found terms modal via button parent');
                            break;
                          }
                          // Check if parent matches modal selectors
                          for (var ms2 = 0; ms2 < modalSelectors.length; ms2++) {
                            try {
                              if (parent.matches && parent.matches(modalSelectors[ms2])) {
                                termsModal = parent;
                                console.log('[Luma Auto Register] Found terms modal via button parent selector');
                                break;
                              }
                            } catch (e) {}
                          }
                          if (termsModal) break;
                        }
                        if (termsModal) break;
                      }
                    }
                  }
                  
                  if (termsModal) {
                    console.log('[Luma Auto Register] Terms modal found, handling it...');
                    // Mark that we're handling it to prevent duplicates
                    if (typeof window !== 'undefined') {
                      window.__lumaTermsModalHandled = true;
                    }
                    
                    // Try multiple strategies to find the name input
                    var nameInput = null;
                    
                    // Strategy 1: Look for input with placeholder containing "name"
                    nameInput = termsModal.querySelector('input[placeholder*="name" i], input[placeholder*="Name" i]');
                    
                    // Strategy 2: Look for input with label containing "name"
                    if (!nameInput) {
                      var labels = termsModal.querySelectorAll('label');
                      for (var l = 0; l < labels.length; l++) {
                        var labelText = (labels[l].textContent || '').toLowerCase();
                        if (labelText.indexOf('name') > -1 || labelText.indexOf('type') > -1) {
                          var labelFor = labels[l].getAttribute('for');
                          if (labelFor) {
                            nameInput = termsModal.querySelector('input#' + labelFor + ', input[name="' + labelFor + '"]');
                          }
                          if (!nameInput) {
                            // Try to find input near the label
                            nameInput = labels[l].querySelector('input') || labels[l].nextElementSibling;
                            if (nameInput && nameInput.tagName !== 'INPUT' && nameInput.tagName !== 'TEXTAREA') {
                              nameInput = nameInput.querySelector('input, textarea');
                            }
                          }
                          if (nameInput) break;
                        }
                      }
                    }
                    
                    // Strategy 3: Look for any text input in the modal
                    if (!nameInput) {
                      nameInput = termsModal.querySelector('input[type="text"], input:not([type]), input[type="email"]');
                    }
                    
                    // Strategy 4: Look for any input or textarea
                    if (!nameInput) {
                      nameInput = termsModal.querySelector('input, textarea');
                    }
                    
                    if (nameInput) {
                      console.log('[Luma Auto Register] Found name input in terms modal: type=' + (nameInput.type || 'text') + ', placeholder=' + (nameInput.placeholder || 'none'));
                    } else {
                      console.log('[Luma Auto Register] ⚠️ Could not find name input in terms modal');
                    }
                    
                    if (nameInput) {
                      var firstName = (settings.firstName || '').trim();
                      var lastName = (settings.lastName || '').trim();
                      var fullName = '';
                      
                      if (firstName && lastName) {
                        fullName = firstName + ' ' + lastName;
                      } else if (firstName) {
                        fullName = firstName;
                      } else if (lastName) {
                        fullName = lastName;
                      }
                      
                      if (fullName) {
                        console.log('[Luma Auto Register] Filling name in terms modal: "' + fullName + '"');
                        // Use the same character-by-character typing as the main handler
                        nameInput.focus();
                        nameInput.value = '';
                        
                        (function typeName(index) {
                          if (index >= fullName.length) {
                            console.log('[Luma Auto Register] ✓ Finished typing name in helper');
                            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                            nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                            nameInput.blur();
                            
                            setTimeout(function() {
                              var signButtons = termsModal.querySelectorAll('button, input[type="submit"]');
                              var signBtn = null;
                              
                              for (var sb = 0; sb < signButtons.length; sb++) {
                                var btn = signButtons[sb];
                                var btnText = (btn.textContent || '').toLowerCase();
                                if ((btnText.indexOf('sign') > -1 && btnText.indexOf('accept') > -1) ||
                                    btnText === 'sign & accept' ||
                                    btnText === 'sign and accept') {
                                  signBtn = btn;
                                  break;
                                }
                              }
                              
                              if (signBtn && !signBtn.disabled && signBtn.offsetParent) {
                                console.log('[Luma Auto Register] Clicking "Sign & Accept" button (helper)');
                                signBtn.click();
                                signBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                console.log('[Luma Auto Register] ✓ Terms modal signed and accepted (helper)');
                                
                                if (callback) {
                                  setTimeout(function() {
                                    callback();
                                  }, 1000);
                                }
                              } else {
                                console.log('[Luma Auto Register] ⚠️ Could not find or click "Sign & Accept" button (helper)');
                                if (callback) callback();
                              }
                            }, 300);
                            return;
                          }
                          
                          var char = fullName[index];
                          nameInput.value = fullName.substring(0, index + 1);
                          nameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
                          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                          nameInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
                          
                          var delay = 30 + Math.random() * 50; // Reduced from 50-150ms to 30-80ms for faster typing
                          setTimeout(function() {
                            typeName(index + 1);
                          }, delay);
                        })(0);
                        return true;
                      }
                    }
                  }
                  return false;
                };

                // Helper to set up a watcher that keeps a checkbox checked
                var setupCheckboxWatcher = function(checkbox, description) {
                  if (!checkbox) return;
                  var desc = description || 'checkbox';
                  
                  // Clean up any existing watcher for this checkbox
                  if (checkbox.__lumaCheckboxWatcher) {
                    checkbox.__lumaCheckboxWatcher.disconnect();
                  }
                  
                  // Create a MutationObserver to watch for the checkbox being unchecked
                  var observer = new MutationObserver(function(mutations) {
                    var wasUnchecked = false;
                    for (var m = 0; m < mutations.length; m++) {
                      var mutation = mutations[m];
                      if (mutation.type === 'attributes' && mutation.attributeName === 'checked') {
                        if (!checkbox.checked) {
                          wasUnchecked = true;
                          break;
                        }
                      }
                    }
                    
                    // Also check the checked property directly
                    if (!checkbox.checked && !wasUnchecked) {
                      wasUnchecked = true;
                    }
                    
                    if (wasUnchecked) {
                      console.log('[Luma Auto Register] ⚠️ ' + desc + ' was unchecked! Re-checking immediately...');
                      
                      // Immediately re-check it using the same strategies
                      var labelEl = checkbox.closest('label') ||
                                    document.querySelector('label[for="' + (checkbox.id || '') + '"]');
                      var parent = checkbox.parentElement;
                      var clickTarget = labelEl || parent || checkbox;
                      
                      // Try clicking first
                      try {
                        clickTarget.click();
                        // Also force set the property
                        checkbox.checked = true;
                        checkbox.setAttribute('checked', 'checked');
                        
                        // Dispatch React events
                        var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                        checkbox.dispatchEvent(changeEvent);
                        
                        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                        checkbox.dispatchEvent(inputEvent);
                        
                        // Try React's synthetic event system
                        try {
                          var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                          if (nativeInputValueSetter && nativeInputValueSetter.set) {
                            nativeInputValueSetter.set.call(checkbox, checkbox.value || '');
                          }
                        } catch (e) {
                          // Ignore
                        }
                        
                        console.log('[Luma Auto Register] ✓ ' + desc + ' re-checked (watcher)');
                      } catch (e) {
                        console.log('[Luma Auto Register] Error re-checking checkbox: ' + e.message);
                      }
                    }
                  });
                  
                  // Observe both attribute changes and property changes
                  observer.observe(checkbox, {
                    attributes: true,
                    attributeFilter: ['checked'],
                    attributeOldValue: true
                  });
                  
                  // Also poll the checked property periodically (as backup)
                  var pollInterval = setInterval(function() {
                    if (!checkbox.checked && checkbox.offsetParent !== null) {
                      console.log('[Luma Auto Register] ⚠️ ' + desc + ' unchecked (poll detected), re-checking...');
                      try {
                        var labelEl2 = checkbox.closest('label') ||
                                      document.querySelector('label[for="' + (checkbox.id || '') + '"]');
                        var parent2 = checkbox.parentElement;
                        var clickTarget2 = labelEl2 || parent2 || checkbox;
                        clickTarget2.click();
                        checkbox.checked = true;
                        checkbox.setAttribute('checked', 'checked');
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
                      } catch (e) {
                        // Ignore
                      }
                    }
                  }, 200); // Check every 200ms
                  
                  // Store the observer and interval for cleanup
                  checkbox.__lumaCheckboxWatcher = observer;
                  checkbox.__lumaCheckboxPollInterval = pollInterval;
                  
                  // Clean up after 30 seconds (form should be submitted by then)
                  setTimeout(function() {
                    if (checkbox.__lumaCheckboxWatcher) {
                      checkbox.__lumaCheckboxWatcher.disconnect();
                      checkbox.__lumaCheckboxWatcher = null;
                    }
                    if (checkbox.__lumaCheckboxPollInterval) {
                      clearInterval(checkbox.__lumaCheckboxPollInterval);
                      checkbox.__lumaCheckboxPollInterval = null;
                    }
                  }, 30000);
                };

                // Helper to reliably check a checkbox in React/custom UIs
                var reliablyCheckCheckbox = function(checkbox, description) {
                  if (!checkbox) return;
                  var desc = description || 'checkbox';
                  
                  if (checkbox.checked) {
                    console.log('[Luma Auto Register] ✓ ' + desc + ' already checked (helper)');
                    // Even if already checked, set up a watcher to keep it checked
                    setupCheckboxWatcher(checkbox, desc);
                    return;
                  }
                  
                  console.log('[Luma Auto Register] Attempting to check ' + desc + ' via helper...');
                  
                  // Set up a watcher to keep the checkbox checked if something tries to uncheck it
                  setupCheckboxWatcher(checkbox, desc);
                  
                  // Strategy 1: Find the visual checkbox element (often a div/span that looks like a checkbox)
                  // Look for siblings or children that might be the visual representation
                  var visualCheckbox = null;
                  var parent = checkbox.parentElement;
                  
                  // Look for common checkbox visual elements
                  if (parent) {
                    // Check for common checkbox wrapper classes
                    var siblings = Array.from(parent.children || []);
                    for (var s = 0; s < siblings.length; s++) {
                      var sibling = siblings[s];
                      if (sibling === checkbox) continue;
                      var className = (sibling.className || '').toLowerCase();
                      var tagName = (sibling.tagName || '').toLowerCase();
                      // Look for visual checkbox indicators - be more aggressive
                      if (className.indexOf('checkbox') > -1 || 
                          className.indexOf('check') > -1 ||
                          className.indexOf('input') > -1 ||
                          tagName === 'div' || tagName === 'span' || tagName === 'button') {
                        // Check if it's visible and might be the visual checkbox
                        if (sibling.offsetParent !== null) {
                          visualCheckbox = sibling;
                          break;
                        }
                      }
                    }
                    
                    // Also check parent for checkbox-like styling
                    var parentClass = (parent.className || '').toLowerCase();
                    if ((parentClass.indexOf('checkbox') > -1 || 
                         parentClass.indexOf('check') > -1 ||
                         parentClass.indexOf('input') > -1 ||
                         parentClass.indexOf('form') > -1) && 
                        parent.offsetParent !== null) {
                      visualCheckbox = parent;
                    }
                    
                    // Also check if parent's parent might be the clickable area
                    var grandParent = parent.parentElement;
                    if (grandParent && grandParent !== document.body) {
                      var grandParentClass = (grandParent.className || '').toLowerCase();
                      if ((grandParentClass.indexOf('checkbox') > -1 || 
                           grandParentClass.indexOf('check') > -1 ||
                           grandParentClass.indexOf('form') > -1) && 
                          grandParent.offsetParent !== null) {
                        visualCheckbox = grandParent;
                      }
                    }
                  }
                  
                  // Strategy 2: Find associated label
                  var labelEl = checkbox.closest('label') ||
                                document.querySelector('label[for="' + (checkbox.id || '') + '"]');
                  
                  // Strategy 3: Walk up the DOM looking for a clickable wrapper
                  var wrapperTarget = null;
                  if (!labelEl) {
                    var walkParent = checkbox.parentElement;
                    while (walkParent && walkParent !== document.body) {
                      var role = (walkParent.getAttribute('role') || '').toLowerCase();
                      var walkClass = (walkParent.className || '').toLowerCase();
                      if (role === 'checkbox' || role === 'switch' || role === 'button' ||
                          walkClass.indexOf('checkbox') > -1) {
                        wrapperTarget = walkParent;
                        break;
                      }
                      walkParent = walkParent.parentElement;
                    }
                  }
                  
                  // Try multiple click targets in order of preference
                  var clickTargets = [];
                  
                  // Priority 1: Visual checkbox element (if found)
                  if (visualCheckbox && visualCheckbox.offsetParent) {
                    clickTargets.push(visualCheckbox);
                  }
                  
                  // Priority 2: Label element
                  if (labelEl && labelEl.offsetParent) {
                    clickTargets.push(labelEl);
                  }
                  
                  // Priority 3: Wrapper with checkbox role/class
                  if (wrapperTarget && wrapperTarget.offsetParent) {
                    clickTargets.push(wrapperTarget);
                  }
                  
                  // Priority 4: Parent element (if it contains the checkbox)
                  if (parent && parent.offsetParent && parent !== document.body) {
                    clickTargets.push(parent);
                  }
                  
                  // Priority 5: The checkbox element itself
                  clickTargets.push(checkbox);
                  
                  // Try each target until one works
                  var checked = false;
                  for (var t = 0; t < clickTargets.length && !checked; t++) {
                    var target = clickTargets[t];
                    try {
                      // Create a more realistic mouse event
                      var mouseDown = new MouseEvent('mousedown', { 
                        bubbles: true, 
                        cancelable: true,
                        view: window,
                        buttons: 1
                      });
                      var mouseUp = new MouseEvent('mouseup', { 
                        bubbles: true, 
                        cancelable: true,
                        view: window,
                        buttons: 1
                      });
                      var clickEvent = new MouseEvent('click', { 
                        bubbles: true, 
                        cancelable: true,
                        view: window,
                        buttons: 1
                      });
                      
                      // Dispatch events in sequence - use React's event system
                      // First, try React's synthetic event by using the native click
                      target.click(); // This triggers React's synthetic events
                      
                      // Also dispatch native events for compatibility
                      target.dispatchEvent(mouseDown);
                      target.dispatchEvent(mouseUp);
                      target.dispatchEvent(clickEvent);
                      
                      // Force set the checked property immediately
                      checkbox.checked = true;
                      checkbox.setAttribute('checked', 'checked');
                      
                      // Dispatch change and input events to notify React
                      var changeEvt = new Event('change', { bubbles: true, cancelable: true });
                      checkbox.dispatchEvent(changeEvt);
                      
                      var inputEvt = new Event('input', { bubbles: true, cancelable: true });
                      checkbox.dispatchEvent(inputEvt);
                      
                      // Try to trigger React's onChange handler directly
                      try {
                        // Access React's internal event system
                        var reactFiber = checkbox._reactInternalFiber || checkbox._reactInternalInstance;
                        if (reactFiber) {
                          // Try to find the onChange handler
                          var props = reactFiber.memoizedProps || reactFiber.pendingProps;
                          if (props && props.onChange) {
                            var syntheticEvent = {
                              target: checkbox,
                              currentTarget: checkbox,
                              type: 'change',
                              bubbles: true,
                              cancelable: true
                            };
                            props.onChange(syntheticEvent);
                          }
                        }
                      } catch (e) {
                        // Ignore React internal access errors
                      }
                      
                      // Check if it worked - React should have processed by now
                      // The watcher will handle if it gets unchecked
                      if (checkbox.checked) {
                        checked = true;
                        console.log('[Luma Auto Register] ✓ ' + desc + ' checked via target ' + t + ' (' + (target.tagName || 'unknown') + ')');
                        break;
                      }
                    } catch (e) {
                      console.log('[Luma Auto Register] Error clicking target ' + t + ': ' + e.message);
                    }
                  }
                  
                  // Final fallback: Directly set checked and dispatch events
                  if (!checkbox.checked) {
                    // Set the property directly
                    try {
                      Object.defineProperty(checkbox, 'checked', {
                        value: true,
                        writable: true,
                        configurable: true
                      });
                    } catch (e) {
                      // Fallback to direct assignment
                    checkbox.checked = true;
                  }
                    
                    // Also set the attribute for compatibility
                    checkbox.setAttribute('checked', 'checked');
                    
                    // Dispatch all relevant events
                    var events = ['change', 'input', 'click'];
                    for (var e = 0; e < events.length; e++) {
                      try {
                        var evt = new Event(events[e], { bubbles: true, cancelable: true });
                        checkbox.dispatchEvent(evt);
                      } catch (err) {
                        // Ignore errors
                      }
                    }
                    
                    // Also try React's onChange if it exists
                    try {
                      if (checkbox._valueTracker) {
                        checkbox._valueTracker.setValue('');
                      }
                      var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                      if (descriptor && descriptor.set) {
                        descriptor.set.call(checkbox, checkbox.value || '');
                      }
                    } catch (err) {
                      // Ignore React-specific errors
                    }
                    
                    // Force React to recognize the change
                    try {
                      var reactEvent = new Event('input', { bubbles: true });
                      checkbox.dispatchEvent(reactEvent);
                    } catch (err) {
                      // Ignore errors
                    }
                  }
                  
                  // Verify it's checked with a small delay to allow React to process
                  setTimeout(function() {
                    var finalChecked = checkbox.checked || checkbox.hasAttribute('checked');
                    if (!finalChecked) {
                      // Retry once more if still not checked
                      console.log('[Luma Auto Register] ⚠️ Checkbox still not checked, retrying...');
                      try {
                        // Try clicking the label or parent one more time
                        var retryTarget = labelEl || parent || checkbox;
                        if (retryTarget) {
                          retryTarget.click();
                          // Force set again
                          checkbox.checked = true;
                          checkbox.setAttribute('checked', 'checked');
                  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                      } catch (e) {
                        console.log('[Luma Auto Register] Retry failed: ' + e.message);
                      }
                    }
                  }, 100);
                  
                  // Verify it's checked
                  var finalChecked = checkbox.checked || checkbox.hasAttribute('checked');
                  console.log('[Luma Auto Register] ✓ ' + desc + ' checked via helper (final state: ' + finalChecked + ')');
                  
                  return finalChecked;
                };
                
                // Look for form container (modal or document body)
                var formContainer = null;
                var modalSelectors = [
                  '[role="dialog"]',
                  '.modal',
                  '[class*="modal"]',
                  '[class*="Modal"]',
                  '[class*="dialog"]',
                  '[class*="Dialog"]',
                  '[class*="form"]',
                  '[class*="Form"]'
                ];
                
                // Check modals first for form inputs
                for (var ms = 0; ms < modalSelectors.length; ms++) {
                  var modals = document.querySelectorAll(modalSelectors[ms]);
                  for (var m = 0; m < modals.length; m++) {
                    var modal = modals[m];
                    // Check if modal is actually visible
                    if (modal.offsetParent !== null) {
                      // Check if modal has form inputs
                      var inputsInModal = modal.querySelectorAll('input, textarea, select');
                      if (inputsInModal.length > 0) {
                        formContainer = modal;
                        console.log('[Luma Auto Register] Found form in visible modal: ' + modalSelectors[ms] + ' with ' + inputsInModal.length + ' inputs');
                        break;
                      }
                    }
                  }
                  if (formContainer) break;
                }
                
                // If no modal found, use document body
                if (!formContainer) {
                  formContainer = document.body;
                }
                
                // Look for all form inputs in the form container (excluding auto-filled fields like name/email)
                // Also look for custom dropdown components (divs with combobox/listbox roles, buttons that might be dropdowns)
                var allInputs = formContainer.querySelectorAll('input, textarea, select');
                var customDropdowns = formContainer.querySelectorAll('[role="combobox"], [role="listbox"], [data-testid*="select"], [class*="Select"], [class*="select"], [class*="dropdown"], [class*="Dropdown"]');
                
                // Filter to only visible inputs
                var visibleInputs = [];
                for (var vi = 0; vi < allInputs.length; vi++) {
                  var inp = allInputs[vi];
                  if (inp.offsetParent !== null && 
                      inp.type !== 'hidden' && 
                      inp.type !== 'submit' && 
                      inp.type !== 'button') {
                    visibleInputs.push(inp);
                  }
                }
                
                console.log('[Luma Auto Register] Found ' + visibleInputs.length + ' visible form fields (out of ' + allInputs.length + ' total), ' + customDropdowns.length + ' custom dropdowns');
                
                // Use visible inputs for processing
                allInputs = visibleInputs;
                
                var fieldsToFill = [];
                var requiresManualCount = 0;
                var termsCheckbox = null;
                var requiredCheckboxes = []; // Collect all required checkboxes (not just terms)
                var requiredCheckboxes = []; // Collect all required checkboxes
                
                for (var i = 0; i < allInputs.length; i++) {
                  var input = allInputs[i];
                  
                  var name = (input.name || '').toLowerCase();
                  var placeholder = (input.placeholder || '').toLowerCase();
                  var type = input.type || input.tagName.toLowerCase();
                  var label = '';
                  var id = input.id || '';
                  
                  // Try to find associated label
                  var labelElement = null;
                  if (input.id) {
                    labelElement = document.querySelector('label[for="' + input.id + '"]');
                    if (labelElement) label = labelElement.textContent.toLowerCase();
                  }
                  
                  // Also check parent label
                  var parentLabel = input.closest('label');
                  if (parentLabel && !label) {
                    labelElement = parentLabel;
                    label = parentLabel.textContent.toLowerCase();
                  }
                  
                  // Check if field is REQUIRED - ONLY fields with asterisk (*)
                  // Check label text for asterisk
                  var hasAsterisk = false;
                  var labelElement = null;
                  
                  // Get label element if we haven't already
                  if (input.id) {
                    labelElement = document.querySelector('label[for="' + input.id + '"]');
                  }
                  if (!labelElement) {
                    labelElement = input.closest('label');
                  }
                  
                  if (label && label.indexOf('*') > -1) {
                    hasAsterisk = true;
                  }
                  
                  // Check the label element's innerHTML for asterisk (might be in a span or other element)
                  if (!hasAsterisk && labelElement) {
                    var labelHTML = labelElement.innerHTML || '';
                    var labelText = labelElement.textContent || labelElement.innerText || '';
                    if (labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1 || 
                        labelHTML.indexOf('&ast;') > -1 || labelText.indexOf('*') > -1) {
                      hasAsterisk = true;
                    }
                    // Also check all child elements for asterisk
                    var childElements = labelElement.querySelectorAll('*');
                    for (var c = 0; c < childElements.length; c++) {
                      var childText = childElements[c].textContent || childElements[c].innerText || '';
                      var childHTML = childElements[c].innerHTML || '';
                      if (childText.indexOf('*') > -1 || childHTML.indexOf('*') > -1 || 
                          childHTML.indexOf('&#42;') > -1) {
                        hasAsterisk = true;
                        break;
                      }
                    }
                  }
                  
                  // Check for asterisk in nearby text (previous sibling, parent text)
                  if (!hasAsterisk) {
                    var prevSibling = input.previousElementSibling;
                    if (prevSibling) {
                      var prevText = (prevSibling.textContent || prevSibling.innerText || '');
                      var prevHTML = prevSibling.innerHTML || '';
                      if (prevText.indexOf('*') > -1 || prevHTML.indexOf('*') > -1 || 
                          prevHTML.indexOf('&#42;') > -1) {
                        hasAsterisk = true;
                      }
                    }
                  }
                  
                  // Check parent container for asterisk
                  if (!hasAsterisk) {
                    var parent = input.parentElement;
                    if (parent) {
                      var parentText = (parent.textContent || parent.innerText || '');
                      var parentHTML = parent.innerHTML || '';
                      // Only check if parent text is short (likely a label)
                      if (parentText.length < 200 && (parentText.indexOf('*') > -1 || parentHTML.indexOf('*') > -1)) {
                        hasAsterisk = true;
                      }
                    }
                  }
                  
                  // Also check for required attribute or aria-required (some forms hide the asterisk
                  // or render it via CSS, so there's no actual "*" character in the DOM)
                  if (!hasAsterisk) {
                    if (input.required || input.hasAttribute('required') || 
                        input.getAttribute('aria-required') === 'true' ||
                        input.closest('[required]')) {
                      hasAsterisk = true;
                      console.log('[Luma Auto Register] Field marked as required via attribute (no visible asterisk): ' + (label || name || placeholder || type));
                    }
                  }
                  
                  // Check for "(required)" text or similar patterns in label
                  if (!hasAsterisk) {
                    var requiredTextPatterns = [
                      /\(required\)/i,
                      /\[required\]/i,
                      /\brequired\b/i,  // Word boundary to avoid matching "required" in other words
                      /\bmandatory\b/i,
                      /\bobligatory\b/i
                    ];
                    
                    var textToCheck = (label || '') + ' ' + (name || '') + ' ' + (placeholder || '');
                    if (labelElement) {
                      textToCheck += ' ' + (labelElement.textContent || '');
                    }
                    
                    for (var rtp = 0; rtp < requiredTextPatterns.length; rtp++) {
                      if (requiredTextPatterns[rtp].test(textToCheck)) {
                        hasAsterisk = true;
                        console.log('[Luma Auto Register] Field marked as required via text pattern: ' + (label || name || placeholder || type));
                        break;
                      }
                    }
                  }
                  
                  // Check for CSS classes that indicate required fields
                  if (!hasAsterisk) {
                    var requiredClasses = ['required', 'mandatory', 'obligatory', 'req', 'must-fill'];
                    var elementToCheck = input;
                    
                    // Check input and its parent elements
                    for (var rc = 0; rc < 3 && elementToCheck && !hasAsterisk; rc++) {
                      var classList = (elementToCheck.className || '').toLowerCase();
                      for (var rc2 = 0; rc2 < requiredClasses.length; rc2++) {
                        if (classList.indexOf(requiredClasses[rc2]) > -1) {
                          hasAsterisk = true;
                          console.log('[Luma Auto Register] Field marked as required via CSS class: ' + (label || name || placeholder || type));
                          break;
                        }
                      }
                      if (labelElement) {
                        var labelClassList = (labelElement.className || '').toLowerCase();
                        for (var rc3 = 0; rc3 < requiredClasses.length; rc3++) {
                          if (labelClassList.indexOf(requiredClasses[rc3]) > -1) {
                            hasAsterisk = true;
                            console.log('[Luma Auto Register] Field marked as required via label CSS class: ' + (label || name || placeholder || type));
                            break;
                          }
                        }
                      }
                      if (hasAsterisk) break;
                      elementToCheck = elementToCheck.parentElement;
                    }
                  }
                  
                  // ONLY fill fields with asterisks
                  if (!hasAsterisk) {
                    console.log('[Luma Auto Register] Skipping optional field (no asterisk): ' + (label || name || placeholder));
                    continue;
                  }
                  
                  console.log('[Luma Auto Register] Required field detected (has asterisk): ' + (label || name || placeholder));
                  
                  // SPECIAL: Detect ALL required checkboxes (check this BEFORE other logic)
                  if (type === 'checkbox') {
                    // Check if this checkbox is required (has asterisk)
                    var checkboxHasAsterisk = false;
                    if (label && label.indexOf('*') > -1) {
                      checkboxHasAsterisk = true;
                    }
                    
                    // Also check label element HTML for asterisk
                    if (!checkboxHasAsterisk && labelElement) {
                      var labelHTML = labelElement.innerHTML || '';
                      var labelTextFull = labelElement.textContent || labelElement.innerText || '';
                      if (labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1 || 
                          labelTextFull.indexOf('*') > -1) {
                        checkboxHasAsterisk = true;
                      }
                      // Check child elements
                      var childElements = labelElement.querySelectorAll('*');
                      for (var c = 0; c < childElements.length; c++) {
                        var childText = childElements[c].textContent || childElements[c].innerText || '';
                        var childHTML = childElements[c].innerHTML || '';
                        if (childText.indexOf('*') > -1 || childHTML.indexOf('*') > -1 || 
                            childHTML.indexOf('&#42;') > -1) {
                          checkboxHasAsterisk = true;
                          break;
                        }
                      }
                    }
                    
                    // Check parent container for asterisk
                    if (!checkboxHasAsterisk) {
                      var parent = input.parentElement;
                      if (parent) {
                        var parentText = (parent.textContent || parent.innerText || '');
                        var parentHTML = parent.innerHTML || '';
                        if (parentText.length < 500 && (parentText.indexOf('*') > -1 || parentHTML.indexOf('*') > -1)) {
                          checkboxHasAsterisk = true;
                        }
                      }
                    }
                    
                    // Check for required attribute
                    if (!checkboxHasAsterisk) {
                      if (input.required || input.hasAttribute('required') || 
                          input.getAttribute('aria-required') === 'true' ||
                          input.closest('[required]')) {
                        checkboxHasAsterisk = true;
                      }
                    }
                    
                    if (checkboxHasAsterisk) {
                      // Check if it's a terms checkbox (special handling)
                      // Make detection more specific - only match actual terms & conditions, not general consent
                      // Terms checkboxes typically say "agree to terms", "accept terms", "terms and conditions"
                      // Not just any checkbox with "consent" (which could be photography consent, etc.)
                      var labelLower = label.toLowerCase();
                      var nameLower = name.toLowerCase();
                      var isTermsCheckbox = (
                        // Must have "terms" AND ("agree" OR "accept" OR "conditions")
                        (labelLower.indexOf('terms') > -1 && (labelLower.indexOf('agree') > -1 || labelLower.indexOf('accept') > -1 || labelLower.indexOf('conditions') > -1)) ||
                        // Or "agree" AND ("terms" OR "conditions")
                        (labelLower.indexOf('agree') > -1 && (labelLower.indexOf('terms') > -1 || labelLower.indexOf('conditions') > -1)) ||
                        // Or "accept" AND ("terms" OR "conditions" OR "policy")
                        (labelLower.indexOf('accept') > -1 && (labelLower.indexOf('terms') > -1 || labelLower.indexOf('conditions') > -1 || labelLower.indexOf('policy') > -1)) ||
                        // Or name/id contains "terms" or "agree"
                        nameLower.indexOf('terms') > -1 || nameLower.indexOf('agree') > -1 ||
                        id.indexOf('terms') > -1 || id.indexOf('agree') > -1
                      );
                      
                      if (isTermsCheckbox) {
                        if (!termsCheckbox) {
                          termsCheckbox = input;
                          console.log('[Luma Auto Register] Found terms checkbox: ' + (label || name || id));
                        }
                      } else {
                        // It's a required checkbox but not terms - add to list (always check these)
                        requiredCheckboxes.push({
                          input: input,
                          label: label || name || id || 'checkbox',
                          description: label || name || id || 'required checkbox'
                        });
                        console.log('[Luma Auto Register] Found required checkbox: ' + (label || name || id));
                      }
                    }
                  }
                  
                  // Helper function to check if text contains any of the synonyms (defined early for use in phone/email checks)
                  var containsAny = function(text, synonyms) {
                    if (!text) return false;
                    var textLower = text.toLowerCase();
                    for (var s = 0; s < synonyms.length; s++) {
                      if (textLower.indexOf(synonyms[s]) > -1) return true;
                    }
                    return false;
                  };
                  
                  var fieldDescription = label || placeholder || name;
                  
                  // Check for telegram field FIRST (before phone, since "telegram" contains "tel")
                  var telegramSynonyms = ['telegram', 'telegram handle', 'telegram username', 'telegram id'];
                  var isTelegramField = containsAny(name, telegramSynonyms) || 
                                       containsAny(label, telegramSynonyms) || 
                                       containsAny(placeholder, telegramSynonyms) ||
                                       containsAny(id, telegramSynonyms);
                  
                  if (isTelegramField) {
                    var telegramValue = settings.telegram || '';
                    var currentValue = (input.value || '').trim();
                    
                    if (!telegramValue || telegramValue.trim() === '') {
                      requiresManualCount++;
                      console.log('[Luma Auto Register] ⚠️ Cannot auto-fill telegram field "' + (fieldDescription || 'telegram') + '" - telegram handle not provided in settings.');
                      continue;
                    }
                    
                    fieldsToFill.push({
                      input: input,
                      value: telegramValue.trim(),
                      description: fieldDescription || 'telegram',
                      isTelegram: true
                    });
                    console.log('[Luma Auto Register] Will auto-fill telegram: ' + (fieldDescription || 'telegram') + ' → "' + telegramValue.trim() + '"');
                    continue;
                  }
                  
                  // Check for phone field EARLY (before checking if already filled)
                  // Phone fields often have placeholder values that look like real values
                  // Exclude "telegram" from phone detection - use more specific phone terms
                  var phoneSynonyms = ['phone', 'telephone', 'mobile', 'cell', 'cell phone', 'mobile phone', 'contact number', 'phone number'];
                  // Only match "tel" if it's not part of "telegram"
                  var hasTel = (name && name.toLowerCase().indexOf('tel') > -1) ||
                               (label && label.toLowerCase().indexOf('tel') > -1) ||
                               (placeholder && placeholder.toLowerCase().indexOf('tel') > -1);
                  var hasTelegram = (name && name.toLowerCase().indexOf('telegram') > -1) ||
                                    (label && label.toLowerCase().indexOf('telegram') > -1) ||
                                    (placeholder && placeholder.toLowerCase().indexOf('telegram') > -1);
                  
                  var isPhoneField = (containsAny(name, phoneSynonyms) || 
                                     containsAny(label, phoneSynonyms) || 
                                     containsAny(placeholder, phoneSynonyms) || 
                                     type === 'tel' ||
                                     containsAny(id, phoneSynonyms) ||
                                     (hasTel && !hasTelegram)) && !isTelegramField;
                  
                  if (isPhoneField) {
                    var phoneValue = settings.phone || '';
                    var currentValue = (input.value || '').trim();
                    
                    // Log what we found
                    console.log('[Luma Auto Register] Phone field detected. Current value: "' + currentValue + '", Placeholder: "' + (placeholder || 'none') + '", Settings phone: "' + (phoneValue || 'empty') + '"');
                    
                    if (!phoneValue || phoneValue.trim() === '') {
                      requiresManualCount++;
                      console.log('[Luma Auto Register] ⚠️ Cannot auto-fill phone field "' + (label || name || placeholder || 'phone') + '" - phone number not provided in settings. Please add your phone number in the extension settings.');
                      continue;
                    }
                    
                    // Check if current value is just a placeholder or empty
                    var isPlaceholderValue = false;
                    
                    if (!currentValue) {
                      // Empty field - definitely fill it
                      isPlaceholderValue = true;
                    } else {
                      // Check if it's a placeholder value
                      // Common placeholder patterns: starts with +1 and matches placeholder, or is very short
                      var matchesPlaceholder = placeholder && (
                        currentValue === placeholder ||
                        placeholder.indexOf(currentValue) > -1 ||
                        currentValue.indexOf(placeholder) > -1
                      );
                      
                      // Also check if it's a generic placeholder format (like +1 (XXX) XXX-XXXX pattern)
                      // Many forms use "+1 506 234 5678" as a placeholder example
                      var isGenericPlaceholder = (currentValue.indexOf('+1') === 0 && currentValue.length <= 15) ||
                                                 currentValue.match(/^\+1\s*\(\d{3}\)\s*\d{3}-\d{4}$/) ||
                                                 currentValue.match(/^\+1\s*\d{3}\s*\d{3}\s*\d{4}$/) ||
                                                 currentValue === '+1 506 234 5678' || // Common Luma placeholder
                                                 currentValue === '506 234 5678' ||
                                                 (currentValue.indexOf('506 234 5678') > -1); // Contains common placeholder
                      
                      isPlaceholderValue = matchesPlaceholder || isGenericPlaceholder;
                    }
                    
                    // Always fill phone field if it's empty or has a placeholder value
                    if (!currentValue || isPlaceholderValue) {
                      fieldsToFill.push({
                        input: input,
                        value: phoneValue,
                        description: fieldDescription,
                        isPhone: true
                      });
                      console.log('[Luma Auto Register] Will auto-fill phone: ' + fieldDescription + ' → "' + phoneValue + '"');
                      continue;
                    } else {
                      // Field has a real value - check if it matches the user's phone
                      // If it doesn't match, we still overwrite to keep things consistent
                      console.log('[Luma Auto Register] Phone field already has value (not a placeholder): ' + currentValue);
                      if (currentValue !== phoneValue) {
                        console.log('[Luma Auto Register] Phone value differs from settings, will overwrite...');
                        fieldsToFill.push({
                          input: input,
                          value: phoneValue,
                          description: fieldDescription,
                          isPhone: true
                        });
                        console.log('[Luma Auto Register] Will auto-fill phone: ' + fieldDescription + ' → "' + phoneValue + '"');
                      }
                      continue;
                    }
                  }
                  
                  // Skip if already filled with a non-whitespace value or disabled
                  var existingValue = (input.value || '').trim();
                  if (existingValue.length > 0 || input.disabled) continue;
                  
                  // Handle email fields - only skip if already filled, otherwise fill from settings
                  // Note: containsAny helper is defined later in the field matching section
                  var emailSynonyms = ['email', 'e-mail', 'e_mail', 'mail', 'email address', 'e-mail address'];
                  var isEmailField = false;
                  for (var es = 0; es < emailSynonyms.length; es++) {
                    if ((name && name.toLowerCase().indexOf(emailSynonyms[es]) > -1) ||
                        (placeholder && placeholder.toLowerCase().indexOf(emailSynonyms[es]) > -1) ||
                        (label && label.toLowerCase().indexOf(emailSynonyms[es]) > -1)) {
                      isEmailField = true;
                      break;
                    }
                  }
                  if (isEmailField) {
                    // Check if email is already filled
                    if (existingValue.length > 0) {
                      console.log('[Luma Auto Register] Email field already filled, skipping');
                      continue;
                    }
                    // Fill email from settings if available
                    if (settings.email && settings.email.trim()) {
                      fieldsToFill.push({
                        input: input,
                        value: settings.email.trim(),
                        description: fieldDescription || 'email'
                      });
                      console.log('[Luma Auto Register] Will auto-fill email: ' + (fieldDescription || 'email') + ' → "' + settings.email.trim() + '"');
                    } else {
                      console.log('[Luma Auto Register] ⚠️ Cannot auto-fill email field - email not provided in settings');
                      requiresManualCount++;
                    }
                    continue; // Skip to next field after handling email
                  }
                  
                  // Skip terms checkbox from regular field processing
                  if (input === termsCheckbox) continue;
                  
                  // IMPORTANT: Check if this is a custom dropdown BEFORE trying to fill it as text
                  // Custom dropdowns are often <input type="text"> that open menus when clicked
                  var isCustomDropdown = false;
                  var placeholderLower = placeholder.toLowerCase();
                  var labelLower = label.toLowerCase();
                  
                  // Check if it looks like a dropdown (has "Select" or "Choose" in placeholder/label)
                  if (placeholderLower.indexOf('select') > -1 || placeholderLower.indexOf('choose') > -1 ||
                      labelLower.indexOf('select') > -1 || labelLower.indexOf('choose') > -1 ||
                      labelLower.indexOf('involvement') > -1 || labelLower.indexOf('interested') > -1) {
                    isCustomDropdown = true;
                    console.log('[Luma Auto Register] Detected custom dropdown (skipping text fill): ' + (label || placeholder || name));
                    // Skip this from regular text field processing - it will be handled as a custom dropdown later
                    continue;
                  }
                  
                  // Determine what value to use based on field type and label
                  var valueToFill = null;
                  
                  // Note: containsAny function is already defined earlier in the code
                  
                  // Full Name field
                  if ((label.indexOf('full name') > -1 || placeholder.indexOf('full name') > -1 ||
                       name.indexOf('fullname') > -1) && 
                      (label.indexOf('first') === -1 && label.indexOf('last') === -1)) {
                    if (settings.firstName && settings.lastName) {
                      valueToFill = settings.firstName + ' ' + settings.lastName;
                    } else if (settings.firstName) {
                      valueToFill = settings.firstName;
                    }
                  }
                  // First Name field
                  else if (label.indexOf('first name') > -1 || placeholder.indexOf('first name') > -1 ||
                           name.indexOf('first_name') > -1 || name.indexOf('firstname') > -1 ||
                           id.toLowerCase().indexOf('first_name') > -1) {
                    if (settings.firstName) {
                      valueToFill = settings.firstName;
                    }
                  }
                  // Last Name field
                  else if (label.indexOf('last name') > -1 || placeholder.indexOf('last name') > -1 ||
                           name.indexOf('last_name') > -1 || name.indexOf('lastname') > -1 ||
                           id.toLowerCase().indexOf('last_name') > -1) {
                    if (settings.lastName) {
                      valueToFill = settings.lastName;
                    }
                  }
                  // Generic Name field (just "name" without "first" or "last")
                  else if ((label.indexOf('name') > -1 || placeholder.indexOf('name') > -1 || name.indexOf('name') > -1) &&
                           label.indexOf('first') === -1 && label.indexOf('last') === -1 &&
                           label.indexOf('full') === -1 && placeholder.indexOf('full') === -1 &&
                           name.indexOf('first') === -1 && name.indexOf('last') === -1) {
                    // Use full name if both first and last are available, otherwise use what's available
                    if (settings.firstName && settings.lastName) {
                      valueToFill = settings.firstName + ' ' + settings.lastName;
                    } else if (settings.firstName) {
                      valueToFill = settings.firstName;
                    } else if (settings.lastName) {
                      valueToFill = settings.lastName;
                    }
                  }
                  // Social media fields
                  else if (name.indexOf('twitter') > -1 || label.indexOf('twitter') > -1 || 
                      label.indexOf('x.com') > -1 || label.indexOf('x (twitter)') > -1 ||
                      placeholder.indexOf('twitter') > -1) {
                    valueToFill = settings.twitter;
                  } else if (name.indexOf('telegram') > -1 || label.indexOf('telegram') > -1 ||
                             placeholder.indexOf('telegram') > -1) {
                    valueToFill = settings.telegram;
                  } else if (name.indexOf('instagram') > -1 || label.indexOf('instagram') > -1 ||
                             placeholder.indexOf('instagram') > -1) {
                    valueToFill = settings.instagram;
                  } else if (name.indexOf('linkedin') > -1 || label.indexOf('linkedin') > -1 ||
                             placeholder.indexOf('linkedin') > -1) {
                    valueToFill = settings.linkedin;
                  } else if (name.indexOf('youtube') > -1 || label.indexOf('youtube') > -1 ||
                             placeholder.indexOf('youtube') > -1) {
                    valueToFill = settings.youtube;
                  } 
                  // Professional fields
                  // Check for "company website" FIRST (before generic "company" check)
                  else if ((name.indexOf('company') > -1 && (name.indexOf('website') > -1 || name.indexOf('url') > -1)) ||
                           (label.indexOf('company') > -1 && (label.indexOf('website') > -1 || label.indexOf('url') > -1)) ||
                           (placeholder.indexOf('company') > -1 && (placeholder.indexOf('website') > -1 || placeholder.indexOf('url') > -1))) {
                    // Company website field - use companyWebsite setting, fallback to website
                    valueToFill = settings.companyWebsite || settings.website || '';
                  } else if (containsAny(name, ['company', 'employer', 'organization', 'organisation', 'employer name', 'workplace', 'business', 'firm']) ||
                           containsAny(label, ['company', 'employer', 'organization', 'organisation', 'employer name', 'workplace', 'business', 'firm']) ||
                           containsAny(placeholder, ['company', 'employer', 'organization', 'organisation', 'employer name', 'workplace', 'business', 'firm'])) {
                    valueToFill = settings.company || 'Independent';
                  } else if ((name.indexOf('title') > -1 || label.indexOf('job title') > -1 || 
                             label.indexOf('role') > -1 || placeholder.indexOf('title') > -1 ||
                             label.indexOf('position') > -1) && label.indexOf('website') === -1) {
                    valueToFill = settings.title || 'Professional';
                  } else if (name.indexOf('website') > -1 || label.indexOf('website') > -1 || 
                             type === 'url' || placeholder.indexOf('website') > -1) {
                    // Generic website field (not company website) - use website setting
                    valueToFill = settings.website;
                  }
                  // Company size / Industry
                  else if (label.indexOf('company size') > -1 || label.indexOf('team size') > -1 ||
                           placeholder.indexOf('company size') > -1) {
                    valueToFill = '1-10';
                  } else if (label.indexOf('industry') > -1 || placeholder.indexOf('industry') > -1 ||
                             name.indexOf('industry') > -1) {
                    valueToFill = settings.industryCategory || 'Technology';
                  }
                  // Location & Demographics
                  else if (label.indexOf('country') > -1 || name.indexOf('country') > -1 ||
                           placeholder.indexOf('country') > -1) {
                    valueToFill = settings.country || '';
                  } else if ((label.indexOf('city') > -1 && label.indexOf('state') > -1) ||
                             (label.indexOf('city') > -1 && label.indexOf('&') > -1) ||
                             (name.indexOf('city') > -1 && name.indexOf('state') > -1) ||
                             placeholder.indexOf('city') > -1 && placeholder.indexOf('state') > -1) {
                    // City & State field - combine if both available, otherwise use city or fallback
                    var cityValue = settings.city || '';
                    var stateValue = settings.state || '';
                    if (cityValue && stateValue) {
                      valueToFill = cityValue + ', ' + stateValue;
                    } else if (cityValue) {
                      valueToFill = cityValue;
                    } else if (stateValue) {
                      valueToFill = stateValue;
                    } else {
                      // Fallback for city & state fields
                      valueToFill = 'To be provided';
                    }
                  } else if (label.indexOf('city') > -1 || name.indexOf('city') > -1 ||
                             placeholder.indexOf('city') > -1) {
                    valueToFill = settings.city || '';
                  } else if (label.indexOf('state') > -1 || name.indexOf('state') > -1 ||
                             placeholder.indexOf('state') > -1) {
                    valueToFill = settings.state || '';
                  } else if (label.indexOf('time zone') > -1 || label.indexOf('timezone') > -1 ||
                             name.indexOf('timezone') > -1 || name.indexOf('time_zone') > -1) {
                    valueToFill = settings.timezone || '';
                  } else if (label.indexOf('pronoun') > -1 || name.indexOf('pronoun') > -1 ||
                             placeholder.indexOf('pronoun') > -1) {
                    valueToFill = settings.pronouns || '';
                  }
                  // Professional Details
                  else if (label.indexOf('experience level') > -1 || label.indexOf('skill level') > -1 ||
                           name.indexOf('experience') > -1 || placeholder.indexOf('experience level') > -1) {
                    valueToFill = settings.experienceLevel || '';
                  } else if (label.indexOf('role category') > -1 || label.indexOf('current role') > -1 ||
                             name.indexOf('role') > -1 || placeholder.indexOf('role') > -1) {
                    valueToFill = settings.roleCategory || '';
                  } else if (label.indexOf('years of experience') > -1 || label.indexOf('years experience') > -1 ||
                             name.indexOf('years') > -1 || placeholder.indexOf('years') > -1) {
                    valueToFill = settings.yearsExperience || '';
                  }
                  // Event-Specific
                  else if (label.indexOf('how did you hear') > -1 || label.indexOf('how did you learn') > -1 ||
                           name.indexOf('hear') > -1 || placeholder.indexOf('hear') > -1 ||
                           label.indexOf('referral source') > -1) {
                    valueToFill = settings.howDidYouHear || 'Social Media';
                  } else if (label.indexOf('dietary') > -1 || label.indexOf('diet') > -1 ||
                             name.indexOf('dietary') > -1 || placeholder.indexOf('dietary') > -1) {
                    valueToFill = settings.dietaryRestrictions || 'None';
                  } else if (label.indexOf('t-shirt') > -1 || label.indexOf('tshirt') > -1 ||
                             label.indexOf('shirt size') > -1 || name.indexOf('shirt') > -1) {
                    valueToFill = settings.tshirtSize || '';
                  } else if (label.indexOf('accessibility') > -1 || label.indexOf('accommodation') > -1 ||
                             name.indexOf('accessibility') > -1) {
                    valueToFill = settings.accessibilityNeeds || '';
                  }
                  // Crypto/Web3
                  else if (label.indexOf('crypto experience') > -1 || label.indexOf('blockchain experience') > -1 ||
                           name.indexOf('crypto') > -1 || placeholder.indexOf('crypto') > -1) {
                    valueToFill = settings.cryptoExperience || '';
                  } else if (label.indexOf('primary interest') > -1 || label.indexOf('main interest') > -1 ||
                             (label.indexOf('interest') > -1 && label.indexOf('primary') > -1) ||
                             name.indexOf('interest') > -1) {
                    valueToFill = settings.primaryInterest || '';
                  } else if (label.indexOf('involvement level') > -1 || label.indexOf('involvement') > -1 ||
                             name.indexOf('involvement') > -1) {
                    valueToFill = settings.involvementLevel || '';
                  }
                  // Bio / About / Background
                  else if (label.indexOf('about you') > -1 || label.indexOf('bio') > -1 || 
                           placeholder.indexOf('about') > -1 || placeholder.indexOf('bio') > -1 ||
                           label.indexOf('yourself') > -1 || label.indexOf('background') > -1 ||
                           label.indexOf('tell us') > -1) {
                    valueToFill = settings.bio || 'Professional interested in blockchain and technology';
                  }
                  // Why attending / Interests / Purpose
                  else if (label.indexOf('why') > -1 || label.indexOf('interest') > -1 || 
                           label.indexOf('reason') > -1 || placeholder.indexOf('why') > -1 ||
                           label.indexOf('attending') > -1 || label.indexOf('purpose') > -1 ||
                           label.indexOf('goal') > -1) {
                    valueToFill = settings.interests || 'Networking and professional development';
                  }
                  // Generic text fields with no specific match - use generic answers
                  // Handle text inputs, textareas, and inputs without a type (which default to text)
                  else if (type === 'text' || type === 'textarea' || 
                           (input.tagName === 'INPUT' && (!input.type || input.type === '')) ||
                           (input.tagName === 'TEXTAREA')) {
                    // Only fill if it's not something sensitive
                    if (label.indexOf('phone') === -1 && label.indexOf('referral') === -1 &&
                        label.indexOf('code') === -1 && label.indexOf('id') === -1) {
                      // Use single generic answer, or default
                      if (!valueToFill) {
                        valueToFill = settings.genericAnswer1 || 'To be provided';
                      }
                    }
                  }
                  
                  // Handle dropdown/select elements - just pick first valid option
                  if ((type === 'select-one' || input.tagName === 'SELECT') && isRequired) {
                    console.log('[Luma Auto Register] Detected dropdown field: ' + fieldDescription);
                    
                    var options = Array.from(input.options || []);
                    if (options.length === 0) {
                      console.log('[Luma Auto Register] No options found in dropdown');
                      requiresManualCount++;
                      continue;
                    }
                    
                    // Filter out placeholder options
                    var placeholderPatterns = /^(select|choose|--|please select|select one|pick one|choose one|none|^$)/i;
                    var realOptions = options.filter(function(opt) {
                      var optText = (opt.text || '').trim();
                      var optValue = (opt.value || '').trim();
                      return optValue && 
                             !placeholderPatterns.test(optText) && 
                             !placeholderPatterns.test(optValue) &&
                             optText.length > 0;
                    });
                    
                    if (realOptions.length === 0) {
                      console.log('[Luma Auto Register] No valid options found in dropdown');
                      requiresManualCount++;
                      continue;
                    }
                    
                    // Just use the first valid option
                    var selectedOption = realOptions[0];
                    var selectedValue = realOptions[0].value;
                    
                    console.log('[Luma Auto Register] Found ' + realOptions.length + ' valid options, selecting first: "' + selectedOption.text + '"');
                    
                    fieldsToFill.push({
                      input: input,
                      value: selectedValue,
                      description: fieldDescription,
                      isSelect: true
                    });
                    console.log('[Luma Auto Register] Will auto-fill dropdown: ' + fieldDescription + ' → "' + selectedOption.text + '"');
                    
                    // Skip to next field (we've handled this dropdown)
                    continue;
                  }
                  
                  if (valueToFill && valueToFill !== '') {
                    fieldsToFill.push({
                      input: input,
                      value: valueToFill,
                      description: fieldDescription
                    });
                    console.log('[Luma Auto Register] Will auto-fill: ' + fieldDescription);
                  } else if (type !== 'hidden' && type !== 'submit' && type !== 'button') {
                    // Only count truly unfillable fields (phone, referral codes, etc)
                    if (label.indexOf('phone') > -1 || label.indexOf('referral') > -1 ||
                        label.indexOf('code') > -1 || name.indexOf('code') > -1) {
                      requiresManualCount++;
                      console.log('[Luma Auto Register] Cannot auto-fill (sensitive): ' + fieldDescription);
                    } else {
                      // Unknown field type - use single generic answer for required fields
                      var genericValue = settings.genericAnswer1 || 'To be provided';
                      
                      // Fill required fields with generic answer
                      fieldsToFill.push({
                        input: input,
                        value: genericValue,
                        description: fieldDescription
                      });
                      console.log('[Luma Auto Register] Will auto-fill with generic answer: ' + fieldDescription + ' → "' + genericValue + '"');
                    }
                  }
                }
                
                // Collect custom dropdowns to process (we'll handle them after regular fields)
                // Look for Luma's custom dropdowns - they use input fields that open menus
                var customDropdownsToProcess = [];
                
                // Find all input fields that might be custom dropdowns
                // Check ALL text inputs in the form/modal, not just ones with "Select" in placeholder
                // Also check for inputs with placeholder "Select one or more" or "Select multiple"
                var allFormInputs = document.querySelectorAll(
                  'input[type="text"], ' +
                  'input:not([type]), ' +
                  'input[type=""], ' +
                  'input[placeholder*="select"], ' +
                  'input[placeholder*="Select"], ' +
                  'input[placeholder*="choose"], ' +
                  'input[placeholder*="Choose"]'
                );
                
                // Also search for inputs by looking for the label text "Which of the below describes you"
                // and then finding the associated input
                var multiSelectLabel = document.evaluate(
                  "//text()[contains(., 'Which of the below describes you') or contains(., 'which of the below describes you') or contains(., 'tick all that apply') or contains(., 'Tick all that apply')]",
                  document,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null
                ).singleNodeValue;
                
                if (multiSelectLabel) {
                  console.log('[Luma Auto Register] Found multi-select label text: "' + (multiSelectLabel.textContent || '').trim() + '"');
                  // Find the input associated with this label
                  var labelElement = multiSelectLabel.parentElement;
                  while (labelElement && labelElement.tagName !== 'LABEL' && labelElement.tagName !== 'DIV' && labelElement.tagName !== 'FORM') {
                    labelElement = labelElement.parentElement;
                  }
                  
                  if (labelElement) {
                    // Look for input in the same container or nearby
                    var container = labelElement.closest('div, form, section, fieldset');
                    if (container) {
                      var nearbyInput = container.querySelector('input[type="text"], input:not([type]), input[placeholder*="select"], input[placeholder*="Select"]');
                      if (nearbyInput && !Array.from(allFormInputs).includes(nearbyInput)) {
                        console.log('[Luma Auto Register] Found multi-select input via label search: placeholder="' + (nearbyInput.placeholder || '') + '"');
                        allFormInputs = Array.from(allFormInputs);
                        allFormInputs.push(nearbyInput);
                        allFormInputs = Array.from(new Set(allFormInputs)); // Remove duplicates
                      }
                    }
                  }
                }
                
                console.log('[Luma Auto Register] Checking ' + allFormInputs.length + ' text inputs for potential dropdowns');
                
                for (var d = 0; d < allFormInputs.length; d++) {
                  var input = allFormInputs[d];
                  
                  // Skip if not visible or disabled
                  if (!input.offsetParent || input.disabled) {
                    console.log('[Luma Auto Register]   Input ' + d + ': Skipped (not visible or disabled)');
                    continue;
                  }
                  
                  // Log all inputs for debugging
                  var inputPlaceholderDebug = (input.placeholder || '').trim();
                  var inputNameDebug = (input.name || '').trim();
                  var inputIdDebug = (input.id || '').trim();
                  console.log('[Luma Auto Register]   Input ' + d + ': placeholder="' + inputPlaceholderDebug + '", name="' + inputNameDebug + '", id="' + inputIdDebug + '"');
                  
                  // IMPORTANT: Skip checkboxes - they are handled separately, not as dropdowns
                  var inputType = (input.type || '').toLowerCase();
                  if (inputType === 'checkbox') {
                    continue; // Checkboxes are handled in the main loop, not as dropdowns
                  }
                  
                  // Skip if already has a meaningful value (not just placeholder)
                  // BUT: Don't skip if placeholder is "Select one or more" or "Select multiple" (multi-select might show selected values)
                  var currentValue = (input.value || '').trim();
                  var inputPlaceholder = (input.placeholder || '').trim();
                  var isMultiSelectPlaceholder = inputPlaceholder.toLowerCase().indexOf('select one or more') > -1 ||
                                                 inputPlaceholder.toLowerCase().indexOf('select multiple') > -1;
                  
                  if (currentValue && currentValue.length > 0 && 
                      currentValue !== inputPlaceholder && 
                      !inputPlaceholder.toLowerCase().includes(currentValue.toLowerCase()) &&
                      !isMultiSelectPlaceholder) {
                    console.log('[Luma Auto Register]   Input ' + d + ': Skipped (already has value: "' + currentValue + '")');
                    continue; // Has a real value, skip it
                  }
                  
                  // Skip if it's a phone, email, linkedin, or other field we handle as regular text fields
                  var inputName = (input.name || '').toLowerCase();
                  var inputPlaceholder = (input.placeholder || '').toLowerCase();
                  var inputLabel = '';
                  
                  // Get label for this input - try multiple methods
                  var labelEl = null;
                  
                  // Method 1: Check for label[for] attribute
                  if (input.id) {
                    labelEl = document.querySelector('label[for="' + input.id + '"]');
                  }
                  
                  // Method 2: Check if input is inside a label
                  if (!labelEl) {
                    labelEl = input.closest('label');
                  }
                  
                  // Method 3: Check previous sibling
                  if (!labelEl) {
                    var prevSib = input.previousElementSibling;
                    if (prevSib && (prevSib.tagName === 'LABEL' || prevSib.tagName === 'P' || prevSib.tagName === 'DIV' || prevSib.tagName === 'SPAN')) {
                      labelEl = prevSib;
                    }
                  }
                  
                  // Method 4: Look for label text in parent container (search backwards from input)
                  if (!labelEl) {
                    var parentContainer = input.closest('div, form, section, fieldset');
                    if (parentContainer) {
                      // Walk backwards through siblings to find label text
                      var current = input.previousElementSibling;
                      while (current) {
                        var currentText = (current.textContent || '').trim();
                        if (currentText.length > 5 && currentText.length < 300 && 
                            (current.tagName === 'LABEL' || current.tagName === 'P' || current.tagName === 'DIV' || 
                             current.tagName === 'SPAN' || current.tagName === 'H3' || current.tagName === 'H4')) {
                          labelEl = current;
                          break;
                        }
                        current = current.previousElementSibling;
                      }
                    }
                  }
                  
                  if (labelEl) {
                    inputLabel = (labelEl.textContent || labelEl.innerText || '').toLowerCase().trim();
                  }
                  
                  // If still no label, try searching parent container more broadly
                  if (!inputLabel || inputLabel.length < 5) {
                    var parentContainer = input.closest('div, form, section, fieldset');
                    if (parentContainer) {
                      // Look for any text element that might be a label (check all children before the input)
                      var allChildren = Array.from(parentContainer.children);
                      var inputIndex = allChildren.indexOf(input);
                      if (inputIndex > 0) {
                        // Check elements before the input
                        for (var i = inputIndex - 1; i >= 0 && i >= inputIndex - 5; i--) {
                          var candidate = allChildren[i];
                          var candidateText = (candidate.textContent || '').trim();
                          if (candidateText.length > 5 && candidateText.length < 300) {
                            inputLabel = candidateText.toLowerCase();
                            console.log('[Luma Auto Register]   Input ' + d + ': Found label from parent container: "' + inputLabel.substring(0, 100) + '"');
                            labelEl = candidate;
                            break;
                          }
                        }
                      }
                    }
                  }
                  
                  // Log the final label found
                  if (inputLabel && inputLabel.length > 5) {
                    console.log('[Luma Auto Register]   Input ' + d + ': Final label="' + inputLabel + '"');
                  }
                  
                  if (inputName.indexOf('phone') > -1 || inputName.indexOf('email') > -1 || 
                      inputPlaceholder.indexOf('phone') > -1 || inputPlaceholder.indexOf('email') > -1 ||
                      inputName.indexOf('linkedin') > -1 || inputLabel.indexOf('phone') > -1 ||
                      inputLabel.indexOf('email') > -1 || inputLabel.indexOf('linkedin') > -1) {
                    continue; // These are handled as regular text fields
                  }
                  
                  // IMPORTANT: Skip if label contains checkbox-related text (like "agree", "terms", etc.)
                  // This prevents checkboxes from being treated as dropdowns
                  if (inputLabel.indexOf('agree') > -1 || inputLabel.indexOf('terms') > -1 ||
                      inputLabel.indexOf('consent') > -1 || inputLabel.indexOf('accept') > -1 ||
                      inputLabel.indexOf('registering') > -1 || inputLabel.indexOf('by registering') > -1) {
                    continue; // This is likely a checkbox label, not a dropdown
                  }
                  
                  // Skip if it's a checkbox (not a dropdown)
                  if (input.type === 'checkbox') {
                    continue; // This is a checkbox, not a dropdown
                  }
                  
                  // Must have "Select" or "Choose" in placeholder or label to be a dropdown
                  // OR have multi-select indicators like "tick all that apply"
                  var labelLower = inputLabel.toLowerCase();
                  var placeholderLower = inputPlaceholder.toLowerCase();
                  
                  // Check for multi-select indicators first (these should be detected even without "select" in placeholder)
                  var isMultiSelectIndicator = labelLower.indexOf('tick all') > -1 ||
                                               labelLower.indexOf('select all') > -1 ||
                                               labelLower.indexOf('check all') > -1 ||
                                               labelLower.indexOf('all that apply') > -1 ||
                                               (labelLower.indexOf('which of') > -1 && (labelLower.indexOf('describes') > -1 || labelLower.indexOf('tick') > -1 || labelLower.indexOf('apply') > -1));
                  
                  // PRIORITY: Check for "select one or more" or "select multiple" - these are ALWAYS multi-select dropdowns
                  // Check in placeholder, value, and nearby text content
                  var placeholderLower = inputPlaceholder.toLowerCase();
                  var inputValue = (input.value || '').toLowerCase();
                  var parentText = '';
                  var parent = input.parentElement;
                  if (parent) {
                    parentText = (parent.textContent || '').toLowerCase();
                  }
                  
                  var isMultiSelectByText = placeholderLower.indexOf('select one or more') > -1 ||
                                           placeholderLower.indexOf('select multiple') > -1 ||
                                           placeholderLower.indexOf('tick all') > -1 ||
                                           inputValue.indexOf('select one or more') > -1 ||
                                           parentText.indexOf('select one or more') > -1;
                  
                  if (isMultiSelectByText) {
                    console.log('[Luma Auto Register]   Input ' + d + ': Detected multi-select dropdown by "Select one or more" text');
                    console.log('[Luma Auto Register]     Placeholder: "' + inputPlaceholder + '"');
                    console.log('[Luma Auto Register]     Value: "' + (input.value || '') + '"');
                    // This is definitely a multi-select dropdown, mark it as such
                    var isRequired = false;
                    
                    // Check if required (has asterisk in label)
                    if (labelEl) {
                      var labelText = (labelEl.textContent || labelEl.innerText || '').toLowerCase();
                      var labelHTML = (labelEl.innerHTML || '');
                      if (labelText.indexOf('*') > -1 || labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1) {
                        isRequired = true;
                        console.log('[Luma Auto Register]     Required: Yes (asterisk in label)');
                      }
                    }
                    
                    // Also check for red border (validation error indicator)
                    var style = window.getComputedStyle(input);
                    var borderColor = style.borderColor || '';
                    if (borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                        borderColor.indexOf('rgb(220, 38, 38)') > -1 ||
                        borderColor.indexOf('#ef4444') > -1) {
                      isRequired = true;
                      console.log('[Luma Auto Register]     Required: Yes (red border detected)');
                    }
                    
                    // Check parent container for labels with asterisks (for conditional dropdowns)
                    if (!isRequired) {
                      var container = input.closest('div, form, section, fieldset');
                      if (container) {
                        var allLabels = container.querySelectorAll('label, p, div, span, h3, h4');
                        for (var lbl = 0; lbl < allLabels.length; lbl++) {
                          var labelElCheck = allLabels[lbl];
                          var labelTextCheck = (labelElCheck.textContent || '').toLowerCase();
                          var labelHTMLCheck = (labelElCheck.innerHTML || '');
                          if (labelTextCheck.length > 10 && labelTextCheck.length < 200 && 
                              (labelTextCheck.indexOf('if you') > -1 || labelTextCheck.indexOf('check all') > -1 ||
                               labelTextCheck.indexOf('categories') > -1 || labelTextCheck.indexOf('apply to') > -1) &&
                              (labelTextCheck.indexOf('*') > -1 || labelHTMLCheck.indexOf('*') > -1 || labelHTMLCheck.indexOf('&#42;') > -1)) {
                            isRequired = true;
                            console.log('[Luma Auto Register]     Required: Yes (asterisk in conditional label: "' + labelTextCheck.substring(0, 80) + '")');
                            // Update inputLabel with the found label
                            if (!inputLabel || inputLabel.length < 5) {
                              inputLabel = labelTextCheck;
                              labelEl = labelElCheck;
                            }
                            break;
                          }
                        }
                      }
                    }
                    
                    // Always process multi-select dropdowns with "Select one or more" if they're required
                    // OR if they have a red border (validation error)
                    if (isRequired) {
                      var finalLabel = inputLabel || 'multi-select dropdown';
                      console.log('[Luma Auto Register] ✓ Adding multi-select dropdown to process: "' + finalLabel + '"');
                      customDropdownsToProcess.push({
                        element: input,
                        label: finalLabel,
                        isMultiSelect: true
                      });
                      continue; // Skip to next input, this one is handled
                    } else {
                      console.log('[Luma Auto Register]     Required: No (skipping optional multi-select)');
                    }
                  }
                  
                  // Check for other dropdown indicators (skip if already handled as multi-select above)
                  // Also check for "Select an option" which is a common single-select dropdown placeholder
                  var looksLikeDropdown = 
                                         inputPlaceholder.indexOf('select') > -1 || 
                                         inputPlaceholder.indexOf('choose') > -1 ||
                                         inputPlaceholder.toLowerCase().indexOf('select an option') > -1 ||
                                         labelLower.indexOf('select') > -1 ||
                                         labelLower.indexOf('choose') > -1 ||
                                         labelLower.indexOf('involvement') > -1 ||
                                         labelLower.indexOf('interested') > -1 ||
                                         isMultiSelectIndicator; // Multi-select indicators count as dropdowns
                  
                  if (!looksLikeDropdown) {
                    // Log for debugging
                    if (inputLabel && inputLabel.length > 5) {
                      console.log('[Luma Auto Register]   Input ' + d + ': Skipping (not a dropdown): label="' + inputLabel + '", placeholder="' + inputPlaceholder + '"');
                    } else {
                      console.log('[Luma Auto Register]   Input ' + d + ': Skipping (not a dropdown, no label found): placeholder="' + inputPlaceholder + '"');
                    }
                    continue; // Not a dropdown, skip it
                  }
                  
                  // Log detected dropdown
                  if (isMultiSelectIndicator) {
                    console.log('[Luma Auto Register] Detected potential multi-select dropdown from label: "' + inputLabel + '"');
                  }
                  
                  // Check if required - use comprehensive asterisk detection (same as main loop)
                  // We only fill out required fields, not optional ones
                  var isRequired = false;
                  
                  // Check for aria-required or required attribute first
                  if (input.getAttribute('aria-required') === 'true' || input.required || input.hasAttribute('required') || input.closest('[required]')) {
                    isRequired = true;
                  }
                  
                  // Check label text for asterisk
                  if (!isRequired && inputLabel.indexOf('*') > -1) {
                    isRequired = true;
                  }
                  
                  // Get label element for comprehensive check
                  var labelElementForDropdown = input.closest('label') || 
                                               document.querySelector('label[for="' + (input.id || '') + '"]') ||
                                               input.previousElementSibling;
                  
                  // Check the label element's innerHTML for asterisk (might be in a span or other element)
                  if (!isRequired && labelElementForDropdown) {
                    var labelHTML = labelElementForDropdown.innerHTML || '';
                    var labelText = labelElementForDropdown.textContent || labelElementForDropdown.innerText || '';
                    if (labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1 || 
                        labelHTML.indexOf('&ast;') > -1 || labelText.indexOf('*') > -1) {
                      isRequired = true;
                    }
                    // Also check all child elements for asterisk
                    var childElements = labelElementForDropdown.querySelectorAll('*');
                    for (var c = 0; c < childElements.length; c++) {
                      var childText = childElements[c].textContent || childElements[c].innerText || '';
                      var childHTML = childElements[c].innerHTML || '';
                      if (childText.indexOf('*') > -1 || childHTML.indexOf('*') > -1 || 
                          childHTML.indexOf('&#42;') > -1) {
                        isRequired = true;
                        break;
                      }
                    }
                  }
                  
                  // Check for asterisk in nearby text (previous sibling, parent text)
                  if (!isRequired) {
                    var prevSibling = input.previousElementSibling;
                    if (prevSibling) {
                      var prevText = (prevSibling.textContent || prevSibling.innerText || '');
                      var prevHTML = prevSibling.innerHTML || '';
                      if (prevText.indexOf('*') > -1 || prevHTML.indexOf('*') > -1 || 
                          prevHTML.indexOf('&#42;') > -1) {
                        isRequired = true;
                      }
                    }
                  }
                  
                  // Check parent container for asterisk
                  if (!isRequired) {
                    var parent = input.parentElement;
                    if (parent) {
                      var parentText = (parent.textContent || parent.innerText || '');
                      var parentHTML = parent.innerHTML || '';
                      // Only check if parent text is short (likely a label)
                      if (parentText.length < 200 && (parentText.indexOf('*') > -1 || parentHTML.indexOf('*') > -1)) {
                        isRequired = true;
                      }
                    }
                  }
                  
                  // Log requirement status
                  if (isRequired) {
                    console.log('[Luma Auto Register]   Input ' + d + ': REQUIRED (has asterisk or aria-required)');
                  } else {
                    console.log('[Luma Auto Register]   Input ' + d + ': NOT REQUIRED (no asterisk found)');
                  }
                  
                  // Detect multi-select dropdowns - check label, placeholder, and aria attributes
                  var isMultiSelect = false;
                  
                  // Multi-select indicators:
                  // - "tick all that apply", "select all that apply", "check all"
                  // - "select one or more", "select multiple"
                  // - "which of" + "describes you" or "tick all"
                  // - aria-multiselectable="true"
                  if (labelLower.indexOf('tick all') > -1 || 
                      labelLower.indexOf('select all') > -1 ||
                      labelLower.indexOf('check all') > -1 ||
                      labelLower.indexOf('all that apply') > -1 ||
                      (labelLower.indexOf('which of') > -1 && (labelLower.indexOf('describes') > -1 || labelLower.indexOf('tick') > -1)) ||
                      placeholderLower.indexOf('select one or more') > -1 ||
                      placeholderLower.indexOf('select multiple') > -1 ||
                      placeholderLower.indexOf('tick all') > -1 ||
                      input.getAttribute('aria-multiselectable') === 'true' ||
                      input.getAttribute('multiple') !== null) {
                    isMultiSelect = true;
                    console.log('[Luma Auto Register] Detected multi-select dropdown: ' + inputLabel);
                  }
                  
                  if (isRequired) {
                    console.log('[Luma Auto Register] Found custom dropdown: ' + inputLabel + ' (placeholder: "' + inputPlaceholder + '")' + (isMultiSelect ? ' [MULTI-SELECT]' : ''));
                    customDropdownsToProcess.push({
                      element: input,
                      label: inputLabel,
                      isMultiSelect: isMultiSelect
                    });
                  }
                }
                
                // Also check the original customDropdowns array for other types
                // These might be divs/buttons that act as dropdowns, not actual input elements
                console.log('[Luma Auto Register] Checking ' + customDropdowns.length + ' custom dropdown elements (divs/buttons)');
                
                // FIRST: Search for dropdowns containing "Select one or more" text (even if not in an input)
                var allElementsForDropdown = document.querySelectorAll('*');
                for (var ms = 0; ms < allElementsForDropdown.length; ms++) {
                  var elem = allElementsForDropdown[ms];
                  var elemText = (elem.textContent || '').toLowerCase();
                  var elemHTML = (elem.innerHTML || '').toLowerCase();
                  
                  // Look for "Select one or more" text in the element
                  var hasSelectOneOrMore = elemText.indexOf('select one or more') > -1 ||
                                          elemHTML.indexOf('select one or more') > -1;
                  
                  if (hasSelectOneOrMore && 
                      elem.offsetParent !== null && // Visible
                      elemText.length < 500) { // Not too long (not the whole page)
                    
                    // IMPORTANT: Filter out non-form elements (like logos, headers, etc.)
                    // Only process elements that are actually form-related
                    var isFormElement = false;
                    var tagName = elem.tagName.toLowerCase();
                    var className = (elem.className || '').toLowerCase();
                    
                    // Check if it's a form element type
                    if (tagName === 'input' || tagName === 'select' || tagName === 'textarea' || 
                        tagName === 'label' || tagName === 'button' ||
                        elem.getAttribute('role') === 'combobox' || elem.getAttribute('role') === 'listbox') {
                      isFormElement = true;
                    }
                    
                    // Check if it contains or is near an input field
                    if (!isFormElement) {
                      var hasInput = elem.querySelector('input, select, textarea') !== null;
                      var isNearInput = elem.previousElementSibling && 
                                       (elem.previousElementSibling.tagName === 'INPUT' || 
                                        elem.previousElementSibling.tagName === 'SELECT');
                      var isInForm = elem.closest('form, [role="form"], [class*="form"]') !== null;
                      var hasFormClass = className.indexOf('form') > -1 || 
                                         className.indexOf('field') > -1 ||
                                         className.indexOf('input') > -1 ||
                                         className.indexOf('dropdown') > -1 ||
                                         className.indexOf('select') > -1;
                      
                      isFormElement = hasInput || isNearInput || isInForm || hasFormClass;
                    }
                    
                    // Skip if not a form element (likely a logo, header, or other page element)
                    if (!isFormElement) {
                      // Check if it's clearly not a form element (logo, header, nav, etc.)
                      var isNonFormElement = className.indexOf('logo') > -1 ||
                                            className.indexOf('header') > -1 ||
                                            className.indexOf('nav') > -1 ||
                                            className.indexOf('menu-trigger-wrapper') > -1 && className.indexOf('logo') > -1;
                      
                      if (isNonFormElement) {
                        continue; // Skip logos and headers
                      }
                    }
                    
                    // Check if this element or nearby elements contain an asterisk (required)
                    var hasAsteriskInText = elemText.indexOf('*') > -1 ||
                                           elemHTML.indexOf('*') > -1 ||
                                           elemHTML.indexOf('&#42;') > -1 ||
                                           elemHTML.indexOf('&ast;') > -1;
                    
                    // Also check parent and siblings for asterisk
                    if (!hasAsteriskInText) {
                      var parent = elem.parentElement;
                      if (parent) {
                        var parentText = (parent.textContent || '').toLowerCase();
                        var parentHTML = (parent.innerHTML || '').toLowerCase();
                        if (parentText.length < 300 && (parentText.indexOf('*') > -1 || parentHTML.indexOf('*') > -1 || parentHTML.indexOf('&#42;') > -1)) {
                          hasAsteriskInText = true;
                        }
                      }
                    }
                    
                    // Check previous sibling for asterisk
                    if (!hasAsteriskInText) {
                      var prevSib = elem.previousElementSibling;
                      if (prevSib) {
                        var prevText = (prevSib.textContent || '').toLowerCase();
                        var prevHTML = (prevSib.innerHTML || '').toLowerCase();
                        if (prevText.length < 300 && (prevText.indexOf('*') > -1 || prevHTML.indexOf('*') > -1 || prevHTML.indexOf('&#42;') > -1)) {
                          hasAsteriskInText = true;
                        }
                      }
                    }
                    
                    // Also search parent container more thoroughly for labels with asterisks
                    if (!hasAsteriskInText) {
                      var container = elem.closest('div, form, section, fieldset');
                      if (container) {
                        // Look for any label-like elements in the container that have asterisks
                        var allLabels = container.querySelectorAll('label, p, div, span, h3, h4');
                        for (var lbl = 0; lbl < allLabels.length; lbl++) {
                          var labelEl = allLabels[lbl];
                          var labelText = (labelEl.textContent || '').toLowerCase();
                          var labelHTML = (labelEl.innerHTML || '').toLowerCase();
                          // Check if it's a label (short text, contains question words or conditional phrases, has asterisk)
                          if (labelText.length > 10 && labelText.length < 200 && 
                              (labelText.indexOf('what') > -1 || labelText.indexOf('which') > -1 || 
                               labelText.indexOf('how') > -1 || labelText.indexOf('stage') > -1 ||
                               labelText.indexOf('company') > -1 || labelText.indexOf('fund') > -1 ||
                               labelText.indexOf('if you') > -1 || labelText.indexOf('check all') > -1 ||
                               labelText.indexOf('categories') > -1 || labelText.indexOf('apply to') > -1) &&
                              (labelText.indexOf('*') > -1 || labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1)) {
                            // Check if this label is near the dropdown (before it in DOM order)
                            var labelIndex = Array.from(container.children).indexOf(labelEl);
                            var dropdownIndex = Array.from(container.children).indexOf(elem);
                            if (labelIndex >= 0 && dropdownIndex >= 0 && labelIndex < dropdownIndex && (dropdownIndex - labelIndex) < 10) {
                              hasAsteriskInText = true;
                              console.log('[Luma Auto Register] Found required label with asterisk in container: "' + labelText.substring(0, 100) + '"');
                              break;
                            }
                          }
                        }
                      }
                    }
                    
                    if (hasAsteriskInText) {
                      // Try to find an input inside this element or nearby
                      var innerInput = elem.querySelector('input[type="text"], input:not([type]), input[placeholder*="select"]');
                      var targetElement = innerInput || elem;
                      
                      // If no input found, look for clickable elements (button, div with role)
                      if (!innerInput && (elem.tagName === 'BUTTON' || elem.getAttribute('role') === 'combobox' || elem.getAttribute('role') === 'listbox')) {
                        targetElement = elem;
                      }
                      
                      // CRITICAL: If we still don't have a valid input/button element, skip this
                      // This filters out logo wrappers and other non-form elements
                      if (!innerInput && 
                          elem.tagName !== 'INPUT' && 
                          elem.tagName !== 'BUTTON' && 
                          elem.getAttribute('role') !== 'combobox' && 
                          elem.getAttribute('role') !== 'listbox') {
                        // Check if we can find an input nearby (next sibling, parent, etc.)
                        var nearbyInput = elem.nextElementSibling;
                        if (nearbyInput && nearbyInput.tagName === 'INPUT') {
                          targetElement = nearbyInput;
                        } else {
                          var parent = elem.parentElement;
                          if (parent) {
                            nearbyInput = parent.querySelector('input[type="text"], input:not([type])');
                            if (nearbyInput) {
                              targetElement = nearbyInput;
                            } else {
                              // No input found - this is likely not a dropdown, skip it
                              console.log('[Luma Auto Register] Skipping element with "Select one or more" - no associated input found (likely not a form element)');
                              continue;
                            }
                          } else {
                            // No parent and no input - skip
                            console.log('[Luma Auto Register] Skipping element with "Select one or more" - no associated input found');
                            continue;
                          }
                        }
                      }
                      
                      console.log('[Luma Auto Register] ✓ Found dropdown with "Select one or more" by text search:');
                      console.log('  Tag:', elem.tagName);
                      console.log('  Class:', elem.className);
                      console.log('  Text:', (elem.textContent || '').trim().substring(0, 150));
                      console.log('  Target Element:', targetElement.tagName, targetElement.className);
                      
                      // Extract label text - look for the actual label element, not parent container text
                      var labelText = '';
                      
                      // Method 1: Try to find a proper label element associated with the input
                      if (targetElement && targetElement.tagName === 'INPUT') {
                        // Look for label element using for attribute
                        if (targetElement.id) {
                          var labelForInput = document.querySelector('label[for="' + targetElement.id + '"]');
                          if (labelForInput) {
                            labelText = (labelForInput.textContent || '').trim();
                          }
                        }
                        
                        // If no label found, look for label that contains the input
                        if (!labelText) {
                          var parentLabel = targetElement.closest('label');
                          if (parentLabel) {
                            labelText = (parentLabel.textContent || '').trim();
                          }
                        }
                        
                        // If still no label, search backwards through siblings and parents for a label
                        if (!labelText) {
                          // Check previous siblings
                          var sibling = targetElement.previousElementSibling;
                          var siblingCount = 0;
                          while (sibling && siblingCount < 5) {
                            var siblingText = (sibling.textContent || '').trim();
                            // Look for text that looks like a question (contains "what", "which", "how", etc. and has asterisk)
                            if (siblingText.length > 10 && siblingText.length < 200 && 
                                (siblingText.indexOf('*') > -1 || siblingText.indexOf('required') > -1) &&
                                (siblingText.toLowerCase().indexOf('what') > -1 || 
                                 siblingText.toLowerCase().indexOf('which') > -1 ||
                                 siblingText.toLowerCase().indexOf('how') > -1 ||
                                 siblingText.toLowerCase().indexOf('who') > -1)) {
                              labelText = siblingText;
                              break;
                            }
                            sibling = sibling.previousElementSibling;
                            siblingCount++;
                          }
                        }
                        
                        // If still no label, look in parent containers for label-like elements
                        // But be more careful - only find labels that are specifically for THIS dropdown
                        if (!labelText) {
                          // First, try to find the immediate parent field container
                          var fieldContainer = targetElement.closest('[class*="field"], [class*="form-group"], [class*="input-wrapper"], [class*="select-wrapper"]');
                          if (fieldContainer) {
                            // Look for label within this specific field container
                            var fieldLabel = fieldContainer.querySelector('label, p, div, span, h3, h4');
                            if (fieldLabel) {
                              var fieldLabelText = (fieldLabel.textContent || '').trim().toLowerCase();
                              var fieldLabelHTML = (fieldLabel.innerHTML || '').toLowerCase();
                              // Check if it's a valid question label
                              if (fieldLabelText.length > 10 && fieldLabelText.length < 200 &&
                                  (fieldLabelText.indexOf('*') > -1 || fieldLabelHTML.indexOf('*') > -1 || fieldLabelHTML.indexOf('&#42;') > -1) &&
                                  (fieldLabelText.indexOf('what') > -1 || 
                                   fieldLabelText.indexOf('which') > -1 ||
                                   fieldLabelText.indexOf('how') > -1 ||
                                   fieldLabelText.indexOf('who') > -1 ||
                                   fieldLabelText.indexOf('where') > -1) &&
                                  // Skip generic field names
                                  fieldLabelText !== 'name *' &&
                                  fieldLabelText !== 'email *' &&
                                  fieldLabelText.indexOf('name *') === -1 &&
                                  fieldLabelText.indexOf('email *') === -1) {
                                labelText = (fieldLabel.textContent || '').trim();
                              }
                            }
                          }
                          
                          // If still no label, search in broader container but with stricter criteria
                          if (!labelText) {
                            var container = targetElement.closest('div, form, section, fieldset');
                            if (container) {
                              var inputRect = targetElement.getBoundingClientRect();
                              var bestCandidate = null;
                              var bestDistance = Infinity;
                              
                              // Look for label, p, or div elements that contain question words and asterisks
                              var labelCandidates = container.querySelectorAll('label, p, div, span, h3, h4');
                              for (var lc = 0; lc < labelCandidates.length; lc++) {
                                var candidate = labelCandidates[lc];
                                var candidateText = (candidate.textContent || '').trim().toLowerCase();
                                var candidateHTML = (candidate.innerHTML || '').toLowerCase();
                                
                                // Skip generic field names
                                if (candidateText === 'name *' || 
                                    candidateText === 'email *' ||
                                    candidateText.indexOf('name *') > -1 && candidateText.indexOf('email *') > -1) {
                                  continue;
                                }
                                
                                // Check if this candidate is above the input (not below)
                                var candidateRect = candidate.getBoundingClientRect();
                                var isAboveInput = candidateRect.bottom <= inputRect.top + 50; // Allow 50px overlap
                                var verticalDistance = Math.abs(candidateRect.bottom - inputRect.top);
                                
                                // Must be a question-like label with asterisk, above the input, and reasonably close
                                if (isAboveInput &&
                                    verticalDistance < 150 && // Within 150px vertically
                                    candidateText.length > 10 && candidateText.length < 200 &&
                                    (candidateText.indexOf('*') > -1 || candidateHTML.indexOf('*') > -1 || candidateHTML.indexOf('&#42;') > -1) &&
                                    (candidateText.indexOf('what') > -1 || 
                                     candidateText.indexOf('which') > -1 ||
                                     candidateText.indexOf('how') > -1 ||
                                     candidateText.indexOf('who') > -1 ||
                                     candidateText.indexOf('where') > -1)) {
                                  // Prefer the closest label above the input
                                  if (verticalDistance < bestDistance) {
                                    bestDistance = verticalDistance;
                                    bestCandidate = candidate;
                                  }
                                }
                              }
                              
                              if (bestCandidate) {
                                labelText = (bestCandidate.textContent || '').trim();
                              }
                            }
                          }
                        }
                      }
                      
                      // Method 2: If no label found, try to extract from element text (but be more careful)
                      if (!labelText) {
                        // First, try to find label in immediate parent structure
                        var parent = elem.parentElement;
                        if (parent) {
                          // Look for label-like elements in the parent (label, p, div with question text)
                          var parentLabels = parent.querySelectorAll('label, p, div, span, h3, h4');
                          for (var pl = 0; pl < parentLabels.length; pl++) {
                            var parentLabel = parentLabels[pl];
                            var parentLabelText = (parentLabel.textContent || '').trim().toLowerCase();
                            var parentLabelHTML = (parentLabel.innerHTML || '').toLowerCase();
                            
                            // Skip if it's a generic field name
                            if (parentLabelText === 'name *' || parentLabelText === 'email *') {
                              continue;
                            }
                            
                            // Check if it's a question-like label with asterisk
                            if (parentLabelText.length > 10 && parentLabelText.length < 200 &&
                                (parentLabelText.indexOf('*') > -1 || parentLabelHTML.indexOf('*') > -1 || parentLabelHTML.indexOf('&#42;') > -1) &&
                                (parentLabelText.indexOf('what') > -1 || 
                                 parentLabelText.indexOf('which') > -1 ||
                                 parentLabelText.indexOf('how') > -1 ||
                                 parentLabelText.indexOf('who') > -1 ||
                                 parentLabelText.indexOf('where') > -1)) {
                              // Check if this label comes before the dropdown in DOM order
                              var labelIndex = Array.from(parent.children).indexOf(parentLabel);
                              var dropdownIndex = Array.from(parent.children).indexOf(elem);
                              if (labelIndex >= 0 && dropdownIndex >= 0 && labelIndex < dropdownIndex) {
                                labelText = (parentLabel.textContent || '').trim();
                                break;
                              }
                            }
                          }
                        }
                        
                        // If still no label, try to extract from element text
                        if (!labelText) {
                          var fullText = (elem.textContent || '').trim();
                          
                          // Try to find text before "Select one or more" in the element itself
                          var match = fullText.match(/(.+?)\s*select one or more/i);
                          if (match && match[1]) {
                            labelText = match[1].trim();
                          } else {
                            // Try parent, but only if parent text is reasonable length
                            if (parent) {
                              var parentText = (parent.textContent || '').trim();
                              // Only use parent if it's a reasonable length (not the whole form)
                              if (parentText.length > 10 && parentText.length < 300 && parentText.indexOf('select one or more') > -1) {
                                match = parentText.match(/(.+?)\s*select one or more/i);
                                if (match && match[1]) {
                                  labelText = match[1].trim();
                                }
                              }
                            }
                          }
                        }
                      }
                      
                      // Clean up the label (remove "Select one or more" and "This field is required")
                      labelText = labelText.replace(/select one or more.*$/i, '').replace(/this field is required.*$/i, '').trim();
                      
                      // If label is too long, try to extract just the question part
                      if (labelText.length > 160) {
                        // Look for question words to find the start of the actual question
                        var questionPatterns = [
                          /(what\s+[^?]+\?)/i,
                          /(which\s+[^?]+\?)/i,
                          /(how\s+[^?]+\?)/i,
                          /(who\s+[^?]+\?)/i,
                          /(where\s+[^?]+\?)/i,
                          /(when\s+[^?]+\?)/i
                        ];
                        
                        for (var qp = 0; qp < questionPatterns.length; qp++) {
                          var questionMatch = labelText.match(questionPatterns[qp]);
                          if (questionMatch && questionMatch[1]) {
                            labelText = questionMatch[1].trim();
                            break;
                          }
                        }
                        
                        // If still too long, try to find the last question-like phrase
                        var phrases = [
                          'which one are you',
                          'which of the below describes you',
                          'which of the below',
                          'which best describes',
                          'what best describes',
                          'how would you describe',
                          'what industry',
                          'what company',
                          'what is your'
                        ];
                        var labelTextLower = labelText.toLowerCase();
                        var startIndex = -1;
                        for (var p = 0; p < phrases.length; p++) {
                          var idx = labelTextLower.lastIndexOf(phrases[p]);
                          if (idx >= 0) {
                            startIndex = idx;
                            break;
                          }
                        }
                        if (startIndex >= 0) {
                          labelText = labelText.substring(startIndex).trim();
                        } else {
                          // If we can't find a reasonable question fragment, try to use just the last 100 chars
                          if (labelText.length > 100) {
                            labelText = labelText.substring(labelText.length - 100).trim();
                          }
                        }
                      }
                      
                      var labelTextLower = labelText.toLowerCase();
                      
                      // If we somehow end up with an empty label (only "Select one or more"),
                      // skip this wrapper - we'll rely on more specific elements.
                      if (!labelTextLower || labelTextLower.length < 5) {
                        console.log('[Luma Auto Register] Skipping unlabeled "Select one or more" dropdown wrapper');
                        continue;
                      }
                      
                      // If label is still too long or contains multiple field names, it's probably wrong
                      if (labelTextLower.length > 200 || 
                          (labelTextLower.indexOf('name') > -1 && labelTextLower.indexOf('email') > -1 && labelTextLower.indexOf('industry') > -1)) {
                        console.log('[Luma Auto Register] Skipping overly long or multi-field "Select one or more" label: ' + labelTextLower.substring(0, 120));
                        continue;
                      }
                      
                      // Check if already added - check both element and input ID/name
                      var alreadyAdded = false;
                      var targetElementId = targetElement.id || '';
                      var targetElementName = targetElement.name || '';
                      
                      for (var i = 0; i < customDropdownsToProcess.length; i++) {
                        var existingElement = customDropdownsToProcess[i].element;
                        if (existingElement === targetElement) {
                          alreadyAdded = true;
                          break;
                        }
                        // Also check by ID or name to avoid duplicates
                        if (targetElementId && existingElement.id === targetElementId) {
                          alreadyAdded = true;
                          console.log('[Luma Auto Register] Dropdown already in list (by ID): ' + targetElementId);
                          break;
                        }
                        if (targetElementName && existingElement.name === targetElementName) {
                          alreadyAdded = true;
                          console.log('[Luma Auto Register] Dropdown already in list (by name): ' + targetElementName);
                          break;
                        }
                      }
                      
                      // Also verify the label is valid (not just "name *" or other field names)
                      // labelTextLower already declared above, just use it
                      var isInvalidLabel = labelTextLower === 'name *' || 
                                         labelTextLower === 'email *' ||
                                         labelTextLower === 'phone *' ||
                                         labelTextLower === 'company name *' ||
                                         labelTextLower === 'job title *' ||
                                         labelTextLower === 'linkedin profile *' ||
                                         (labelTextLower.indexOf('name *') > -1 && labelTextLower.indexOf('email *') > -1) ||
                                         // Also skip if label doesn't contain question words (likely a simple field name)
                                         (labelTextLower.length < 20 && 
                                          labelTextLower.indexOf('what') === -1 && 
                                          labelTextLower.indexOf('which') === -1 &&
                                          labelTextLower.indexOf('how') === -1 &&
                                          labelTextLower.indexOf('who') === -1 &&
                                          labelTextLower.indexOf('where') === -1 &&
                                          labelTextLower.indexOf('when') === -1);
                      
                      if (isInvalidLabel) {
                        console.log('[Luma Auto Register] Skipping dropdown with invalid label: "' + labelTextLower + '"');
                        continue;
                      }
                      
                      if (!alreadyAdded && !isInvalidLabel) {
                        console.log('[Luma Auto Register] ✓ Adding dropdown with "Select one or more" to process list: "' + labelTextLower + '"');
                        customDropdownsToProcess.push({
                          element: targetElement,
                          label: labelTextLower,
                          isMultiSelect: true // Mark as multi-select, but we'll handle Yes/No cases
                        });
                      } else if (alreadyAdded) {
                        console.log('[Luma Auto Register] Dropdown already in list, skipping duplicate');
                      }
                    }
                  }
                }
                
                // SECOND: Search for multi-select dropdown by looking for the specific text "Which of the below describes you" or "tick all that apply"
                var allElementsForMultiSelect = document.querySelectorAll('*');
                for (var ms = 0; ms < allElementsForMultiSelect.length; ms++) {
                  var elem = allElementsForMultiSelect[ms];
                  var elemText = (elem.textContent || '').toLowerCase();
                  
                  // Look for the multi-select dropdown by its label text
                  if ((elemText.indexOf('which of the below describes you') > -1 || 
                       elemText.indexOf('tick all that apply') > -1) &&
                      elemText.length < 300 && // Not too long (not the whole page)
                      elem.offsetParent !== null) { // Visible
                    
                    // Check if this element or its text contains an asterisk (required)
                    var hasAsteriskInText = elemText.indexOf('*') > -1 ||
                                           (elem.innerHTML || '').indexOf('*') > -1 ||
                                           (elem.innerHTML || '').indexOf('&#42;') > -1;
                    
                    if (hasAsteriskInText) {
                      console.log('[Luma Auto Register] ✓ Found multi-select dropdown by text search:');
                      console.log('  Tag:', elem.tagName);
                      console.log('  Class:', elem.className);
                      console.log('  Text:', (elem.textContent || '').trim().substring(0, 100));
                      
                      // Try to find an input inside this element
                      var innerInput = elem.querySelector('input[type="text"], input:not([type])');
                      var targetElement = innerInput || elem;
                      
                      // Extract label text
                      var labelText = (elem.textContent || '').trim();
                      // Clean up the label (remove "Select one or more" and "This field is required")
                      labelText = labelText.replace(/Select one or more.*$/i, '').replace(/This field is required.*$/i, '').trim();
                      var labelTextLower = labelText.toLowerCase();
                      
                      // Check if already added
                      var alreadyAdded = false;
                      for (var i = 0; i < customDropdownsToProcess.length; i++) {
                        if (customDropdownsToProcess[i].element === targetElement) {
                          alreadyAdded = true;
                          break;
                        }
                      }
                      
                      if (!alreadyAdded) {
                        console.log('[Luma Auto Register] ✓ Adding multi-select dropdown to process list');
                        customDropdownsToProcess.push({
                          element: targetElement,
                          label: labelTextLower,
                          isMultiSelect: true
                        });
                      }
                      break; // Found it, no need to continue
                    }
                  }
                }
                
                for (var d = 0; d < customDropdowns.length; d++) {
                  var dropdown = customDropdowns[d];
                  
                  console.log('[Luma Auto Register]   CustomDropdown ' + d + ': tagName=' + dropdown.tagName + ', role=' + (dropdown.getAttribute('role') || 'none') + ', className=' + (dropdown.className || '').substring(0, 50));
                  
                  // Skip if not visible or disabled
                  if (!dropdown.offsetParent || dropdown.disabled) {
                    console.log('[Luma Auto Register]   CustomDropdown ' + d + ': Skipped (not visible or disabled)');
                    continue;
                  }
                  
                  // Skip if it's a checkbox (not a dropdown)
                  if (dropdown.type === 'checkbox') {
                    continue;
                  }
                  
                  // Skip if already in our list
                  var alreadyAdded = false;
                  for (var i = 0; i < customDropdownsToProcess.length; i++) {
                    if (customDropdownsToProcess[i].element === dropdown) {
                      alreadyAdded = true;
                      break;
                    }
                  }
                  if (alreadyAdded) continue;
                  
                  // For custom dropdowns (divs/buttons), try to find the associated input field
                  // Many custom dropdowns have an input field nearby
                  var associatedInput = null;
                  if (dropdown.tagName !== 'INPUT') {
                    // Look for an input field near this dropdown
                    var parent = dropdown.parentElement;
                    if (parent) {
                      associatedInput = parent.querySelector('input[type="text"], input:not([type])');
                    }
                    // If not found, check siblings
                    if (!associatedInput) {
                      var nextSibling = dropdown.nextElementSibling;
                      if (nextSibling && nextSibling.tagName === 'INPUT') {
                        associatedInput = nextSibling;
                      }
                    }
                    // If still not found, check if this dropdown itself contains an input
                    if (!associatedInput) {
                      associatedInput = dropdown.querySelector('input[type="text"], input:not([type])');
                    }
                    
                    // If we found an associated input, use that instead (it's already being processed)
                    if (associatedInput) {
                      var alreadyProcessed = false;
                      for (var i = 0; i < customDropdownsToProcess.length; i++) {
                        if (customDropdownsToProcess[i].element === associatedInput) {
                          alreadyProcessed = true;
                          break;
                        }
                      }
                      if (alreadyProcessed) {
                        continue; // The input is already being processed
                      }
                      // Use the input instead of the dropdown div
                      dropdown = associatedInput;
                    }
                  }
                  
                  // Find associated label - try multiple strategies
                  var dropdownLabel = '';
                  var labelEl = dropdown.closest('label') || 
                               dropdown.previousElementSibling ||
                               document.querySelector('label[for="' + (dropdown.id || '') + '"]');
                  
                  if (labelEl) {
                    dropdownLabel = (labelEl.textContent || '').toLowerCase();
                    console.log('[Luma Auto Register]   CustomDropdown ' + d + ': Found label from labelEl: "' + dropdownLabel + '"');
                  }
                  
                  // If no label found, look in parent container
                  if (!dropdownLabel || dropdownLabel.length < 5) {
                    var parentContainer = dropdown.closest('div, form, section, fieldset');
                    if (parentContainer) {
                      // Look for label-like text before the dropdown
                      var allChildren = Array.from(parentContainer.children);
                      var dropdownIndex = allChildren.indexOf(dropdown);
                      if (dropdownIndex > 0) {
                        // Check previous siblings for label text
                        for (var li = dropdownIndex - 1; li >= 0 && li >= dropdownIndex - 5; li--) {
                          var prevElem = allChildren[li];
                          var prevText = (prevElem.textContent || '').trim().toLowerCase();
                          // Look for text that contains question marks or asterisks (likely a label)
                          if (prevText && prevText.length > 10 && prevText.length < 200 &&
                              (prevText.indexOf('?') > -1 || prevText.indexOf('*') > -1 ||
                               prevText.indexOf('which') > -1 || prevText.indexOf('tick') > -1 ||
                               prevText.indexOf('select') > -1)) {
                            dropdownLabel = prevText;
                            labelEl = prevElem;
                            console.log('[Luma Auto Register]   CustomDropdown ' + d + ': Found label from parent container: "' + dropdownLabel + '"');
                            break;
                          }
                        }
                      }
                    }
                  }
                  
                  if (!dropdownLabel || dropdownLabel.length < 5) {
                    console.log('[Luma Auto Register]   CustomDropdown ' + d + ': No label found');
                  }
                  
                  // IMPORTANT: Skip if label contains checkbox-related text (like "agree", "terms", etc.)
                  // This prevents checkboxes from being treated as dropdowns
                  if (dropdownLabel.indexOf('agree') > -1 || dropdownLabel.indexOf('terms') > -1 ||
                      dropdownLabel.indexOf('consent') > -1 || dropdownLabel.indexOf('accept') > -1 ||
                      dropdownLabel.indexOf('registering') > -1 || dropdownLabel.indexOf('by registering') > -1) {
                    continue; // This is likely a checkbox label, not a dropdown
                  }
                  
                  // Check if required - fields with asterisk OR multi-select indicators
                  var hasAsterisk = false;
                  
                  // Check label text for asterisk
                  if (dropdownLabel && dropdownLabel.indexOf('*') > -1) {
                    hasAsterisk = true;
                  }
                  
                  // Check label element HTML for asterisk
                  if (!hasAsterisk && labelEl) {
                    var labelHTML = labelEl.innerHTML || '';
                    if (labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1) {
                      hasAsterisk = true;
                    }
                  }
                  
                  // Check nearby elements for asterisk
                  if (!hasAsterisk) {
                    var prevSibling = dropdown.previousElementSibling;
                    if (prevSibling) {
                      var prevText = (prevSibling.textContent || prevSibling.innerText || '').toLowerCase();
                      if (prevText.indexOf('*') > -1) {
                        hasAsterisk = true;
                      }
                    }
                  }
                  
                  // Detect multi-select for this dropdown
                  var isMultiSelectDropdown = false;
                  var dropdownPlaceholder = '';
                  if (dropdown.tagName === 'INPUT') {
                    dropdownPlaceholder = (dropdown.placeholder || '').toLowerCase();
                  }
                  
                  if (dropdownLabel) {
                    if (dropdownLabel.indexOf('tick all') > -1 || 
                        dropdownLabel.indexOf('select all') > -1 ||
                        dropdownLabel.indexOf('check all') > -1 ||
                        dropdownLabel.indexOf('all that apply') > -1 ||
                        (dropdownLabel.indexOf('which of') > -1 && (dropdownLabel.indexOf('describes') > -1 || dropdownLabel.indexOf('tick') > -1 || dropdownLabel.indexOf('apply') > -1))) {
                      isMultiSelectDropdown = true;
                    }
                  }
                  
                  // Also check placeholder for multi-select indicators
                  if (dropdownPlaceholder.indexOf('select one or more') > -1 ||
                      dropdownPlaceholder.indexOf('select multiple') > -1 ||
                      dropdownPlaceholder.indexOf('tick all') > -1) {
                    isMultiSelectDropdown = true;
                  }
                  
                  console.log('[Luma Auto Register]   CustomDropdown ' + d + ': hasAsterisk=' + hasAsterisk + ', isMultiSelect=' + isMultiSelectDropdown + ', placeholder="' + dropdownPlaceholder + '"');
                  
                  if (hasAsterisk) {
                    console.log('[Luma Auto Register] ✓ Found custom dropdown from customDropdowns array: label="' + dropdownLabel + '", multiSelect=' + isMultiSelectDropdown);
                    customDropdownsToProcess.push({
                      element: dropdown,
                      label: dropdownLabel,
                      isMultiSelect: isMultiSelectDropdown
                    });
                  } else {
                    console.log('[Luma Auto Register]   CustomDropdown ' + d + ': Skipped (not required - no asterisk found)');
                  }
                }
                
                console.log('[Luma Auto Register] Found ' + customDropdownsToProcess.length + ' required custom dropdowns to process');
                
                console.log('[Luma Auto Register] Summary: ' + fieldsToFill.length + ' fields to fill, ' + requiresManualCount + ' need manual input');
                
                // If we have fields that require manual input and user wants to skip
                if (requiresManualCount > 0 && settings.skipManualFields) {
                  console.log('[Luma Auto Register] ⚠️ Skipping - ' + requiresManualCount + ' fields require manual input');
                  resolve({ 
                    success: false, 
                    message: 'Skipped: Requires ' + requiresManualCount + ' manual fields',
                    requiresManual: true
                  });
                  return;
                }
                
                // Special case: required phone field but no phone saved in settings.
                // In this scenario we can never fully auto-complete the form, so
                // immediately mark it as needing manual input instead of timing out.
                if (requiresManualCount > 0 && (!settings.phone || !settings.phone.trim())) {
                  console.log('[Luma Auto Register] ⚠️ Required phone field cannot be auto-filled because no phone number is set in extension settings.');
                  resolve({
                    success: false,
                    message: 'Required phone number missing in settings – manual registration required',
                    requiresManual: true
                  });
                  return;
                }
                
                // Fill all fields we can
                // CRITICAL: Fill fields sequentially with delays to avoid overwhelming React
                console.log('[Luma Auto Register] === FILLING FIELDS ===');
                
                (function fillFieldSequentially(index) {
                  if (index >= fieldsToFill.length) {
                    // All fields filled
                    return;
                  }
                  
                  var field = fieldsToFill[index];
                  
                  // Handle select/dropdown elements
                  if (field.isSelect || field.input.tagName === 'SELECT') {
                    // Set the value for select element
                    field.input.value = field.value;
                    
                    // Verify the option was actually selected
                    if (field.input.value !== field.value) {
                      console.log('[Luma Auto Register] ⚠️ Warning: Could not set select value. Expected: "' + field.value + '", Got: "' + field.input.value + '"');
                    }
                    
                    // Trigger events for React forms
                    field.input.dispatchEvent(new Event('change', { bubbles: true }));
                    field.input.dispatchEvent(new Event('input', { bubbles: true }));
                    field.input.dispatchEvent(new Event('blur', { bubbles: true }));
                    
                    console.log('[Luma Auto Register] ✓ Filled dropdown: ' + field.description + ' → "' + field.value + '"');
                  } else if (field.isPhone) {
                    // Special handling for phone fields - use React-controlled component approach
                    // Phone fields are often React controlled, so we need to use the same approach as text fields
                    var phoneValueStr = String(field.value || '');
                    var inputEl = field.input;
                    
                    // Method 1: Try to access React's internal value setter (same as text fields)
                    var valueSet = false;
                    try {
                      // Get React fiber/internal instance
                      var reactKey = Object.keys(inputEl).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'));
                      if (reactKey) {
                        var reactInstance = inputEl[reactKey];
                        if (reactInstance) {
                          // Try to get the props and onChange handler
                          var props = reactInstance.memoizedProps || reactInstance.pendingProps || reactInstance.memoizedState?.element?.props || {};
                          var onChange = props.onChange;
                          
                          if (onChange && typeof onChange === 'function') {
                            // Create a proper synthetic event for React
                            var syntheticEvent = {
                              target: inputEl,
                              currentTarget: inputEl,
                              bubbles: true,
                              cancelable: true,
                              defaultPrevented: false,
                              eventPhase: 2,
                              isTrusted: false,
                              nativeEvent: new Event('input'),
                              preventDefault: function() {},
                              stopPropagation: function() {},
                              timeStamp: Date.now(),
                              type: 'input'
                            };
                            
                            // Set value on target using defineProperty to make it work with React
                            Object.defineProperty(syntheticEvent.target, 'value', {
                              value: phoneValueStr,
                              writable: true,
                              configurable: true,
                              enumerable: true
                            });
                            
                            // Call React's onChange handler
                            onChange(syntheticEvent);
                            valueSet = true;
                            console.log('[Luma Auto Register] Set phone value via React onChange handler');
                          }
                        }
                      }
                    } catch (reactError) {
                      // React internal access failed, will use standard approach
                    }
                    
                    // Method 2: Use native value setter (bypasses React's restrictions)
                    if (!valueSet) {
                      try {
                        // Focus the input first
                        inputEl.focus();
                        
                        // Use native value setter to bypass React's restrictions
                        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                        if (nativeInputValueSetter) {
                          nativeInputValueSetter.call(inputEl, phoneValueStr);
                        } else {
                          inputEl.value = phoneValueStr;
                        }
                        
                        // Trigger input event with proper target value
                        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                        Object.defineProperty(inputEvent, 'target', {
                          value: inputEl,
                          enumerable: true,
                          writable: false
                        });
                        inputEl.dispatchEvent(inputEvent);
                        
                        // Trigger change event
                        var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                        Object.defineProperty(changeEvent, 'target', {
                          value: inputEl,
                          enumerable: true,
                          writable: false
                        });
                        inputEl.dispatchEvent(changeEvent);
                        
                        valueSet = true;
                      } catch (nativeError) {
                        console.log('[Luma Auto Register] ⚠️ Error setting phone value via native setter: ' + nativeError.message);
                      }
                    }
                    
                    // Method 3: Fallback - character-by-character typing (original method, but with React events)
                    if (!valueSet || inputEl.value !== phoneValueStr) {
                      try {
                        inputEl.focus();
                        inputEl.value = '';
                        
                        (function typePhoneChar(idx, inputEl, valueStr, description) {
                          if (idx >= valueStr.length) {
                            // Finished typing - trigger validation events with React-compatible approach
                            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                            if (nativeInputValueSetter) {
                              nativeInputValueSetter.call(inputEl, valueStr);
                            }
                            
                            var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                            Object.defineProperty(inputEvent, 'target', { value: inputEl, enumerable: true, writable: false });
                            inputEl.dispatchEvent(inputEvent);
                            
                            var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                            Object.defineProperty(changeEvent, 'target', { value: inputEl, enumerable: true, writable: false });
                            inputEl.dispatchEvent(changeEvent);
                            
                            inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
                            console.log('[Luma Auto Register] ✓ Filled phone field: ' + description + ' → "' + valueStr + '"');
                            return;
                          }
                          
                          inputEl.value += valueStr.charAt(idx);
                          var charInputEvent = new Event('input', { bubbles: true, cancelable: true });
                          Object.defineProperty(charInputEvent, 'target', { value: inputEl, enumerable: true, writable: false });
                          inputEl.dispatchEvent(charInputEvent);
                          
                          // Small delay between "keystrokes" so React/validation libraries can track changes
                          setTimeout(function() {
                            typePhoneChar(idx + 1, inputEl, valueStr, description);
                          }, 25);
                        })(0, inputEl, phoneValueStr, field.description);
                      } catch (typeError) {
                        // Last resort: direct assignment
                        inputEl.value = phoneValueStr;
                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                      }
                    } else {
                      // Value was set via React or native setter, verify it
                      var finalPhoneValue = inputEl.value;
                      if (finalPhoneValue !== phoneValueStr) {
                        console.log('[Luma Auto Register] ⚠️ Warning: Phone value mismatch. Expected: "' + phoneValueStr + '", Got: "' + finalPhoneValue + '"');
                        // Try setting again
                        inputEl.value = phoneValueStr;
                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                      } else {
                        console.log('[Luma Auto Register] ✓ Filled phone field: ' + field.description + ' → "' + phoneValueStr + '" (verified)');
                      }
                    }
                  } else {
                    // Handle text/textarea inputs
                    // CRITICAL: For React controlled components, we need to properly set values
                    // React manages input values through its own state, so direct assignment may not work
                    
                    var inputEl = field.input;
                    var valueToSet = field.value;
                    
                    // Method 1: Try to access React's internal value setter
                    var valueSet = false;
                    try {
                      // Get React fiber/internal instance
                      var reactKey = Object.keys(inputEl).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'));
                      if (reactKey) {
                        var reactInstance = inputEl[reactKey];
                        if (reactInstance) {
                          // Try to get the props and onChange handler
                          var props = reactInstance.memoizedProps || reactInstance.pendingProps || reactInstance.memoizedState?.element?.props || {};
                          var onChange = props.onChange;
                          
                          if (onChange && typeof onChange === 'function') {
                            // Create a proper synthetic event for React
                            var syntheticEvent = {
                              target: inputEl,
                              currentTarget: inputEl,
                              bubbles: true,
                              cancelable: true,
                              defaultPrevented: false,
                              eventPhase: 2,
                              isTrusted: false,
                              nativeEvent: new Event('input'),
                              preventDefault: function() {},
                              stopPropagation: function() {},
                              timeStamp: Date.now(),
                              type: 'input'
                            };
                            
                            // Set value on target using defineProperty to make it work with React
                            Object.defineProperty(syntheticEvent.target, 'value', {
                              value: valueToSet,
                              writable: true,
                              configurable: true,
                              enumerable: true
                            });
                            
                            // Call React's onChange handler
                            onChange(syntheticEvent);
                            valueSet = true;
                            console.log('[Luma Auto Register] Set value via React onChange handler');
                          }
                        }
                      }
                    } catch (reactError) {
                      // React internal access failed, will use standard approach
                    }
                    
                    // Method 2: Use native value setter (bypasses React's restrictions)
                    if (!valueSet) {
                      try {
                        // Focus the input first
                        inputEl.focus();
                        
                        // Use native value setter to bypass React's restrictions
                        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                        if (nativeInputValueSetter) {
                          nativeInputValueSetter.call(inputEl, valueToSet);
                        } else {
                          inputEl.value = valueToSet;
                        }
                        
                        // Trigger input event with proper target value
                        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                        // Make sure the event target has the value
                        Object.defineProperty(inputEvent, 'target', {
                          value: inputEl,
                          enumerable: true,
                          writable: false
                        });
                        inputEl.dispatchEvent(inputEvent);
                        
                        // Trigger change event
                        var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                        Object.defineProperty(changeEvent, 'target', {
                          value: inputEl,
                          enumerable: true,
                          writable: false
                        });
                        inputEl.dispatchEvent(changeEvent);
                        
                        valueSet = true;
                      } catch (nativeError) {
                        console.log('[Luma Auto Register] ⚠️ Error setting value via native setter: ' + nativeError.message);
                      }
                    }
                    
                    // Method 3: Fallback - direct assignment with events
                    if (!valueSet || inputEl.value !== valueToSet) {
                      inputEl.value = valueToSet;
                      inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                      inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    }
                    
                    // Additional events to ensure React processes the change
                    inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
                    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
                    
                    // Verify the value was set
                    var finalValue = inputEl.value;
                    if (finalValue !== valueToSet) {
                      console.log('[Luma Auto Register] ⚠️ Warning: Value mismatch. Expected: "' + valueToSet + '", Got: "' + finalValue + '"');
                      // Last resort: try setting again
                      inputEl.value = valueToSet;
                      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                      console.log('[Luma Auto Register] ✓ Filled: ' + field.description + ' → "' + valueToSet + '" (verified)');
                    }
                  }
                  
                  // Fill next field after a small delay (100ms) to avoid overwhelming React
                  // This gives React time to process each field value
                  setTimeout(function() {
                    fillFieldSequentially(index + 1);
                  }, 100);
                })(0);
                
                console.log('[Luma Auto Register] Waiting for React to validate fields...');
                
                // CRITICAL: Add delay after filling fields to let React process the values
                // React needs time to update its internal state before form submission
                // Increased delay for React controlled components which need more time
                var fieldsFilledDelay = 2000; // 2 seconds delay to let React process field values (increased from 1s)
                
                // Process custom dropdowns sequentially
                // IMPORTANT: Submit button search will be triggered AFTER dropdowns finish
                if (customDropdownsToProcess.length > 0) {
                  console.log('[Luma Auto Register] === PROCESSING CUSTOM DROPDOWNS ===');
                  console.log('[Luma Auto Register] Will search for submit button after all dropdowns are processed');
                  
                  // Track which logical questions we've already handled so we don't
                  // reopen the same multi-select multiple times (common with deeply
                  // nested "Select one or more" wrappers on Luma pages).
                  var processedDropdownLabels = {};
                  
                  // Process each dropdown with a delay between them
                  function processCustomDropdown(index) {
                    if (index >= customDropdownsToProcess.length) {
                      console.log('[Luma Auto Register] Finished processing custom dropdowns');
                      
                      // Re-scan for conditional dropdowns that might have appeared after selections
                      // Some dropdowns only appear after certain options are selected (e.g., "If you are an investor...")
                      // IMPORTANT: This must complete BEFORE searching for submit button to avoid interfering with form submission
                      setTimeout(function() {
                        // Check if form has already been submitted (prevent re-scanning after submit)
                        if (typeof window !== 'undefined' && window.__lumaFormSubmitted) {
                          console.log('[Luma Auto Register] Form already submitted, skipping re-scanning to avoid interference');
                          return;
                        }
                        
                        console.log('[Luma Auto Register] === RE-SCANNING FOR CONDITIONAL DROPDOWNS ===');
                        
                        // Look for any new "Select one or more" dropdowns that weren't detected before
                        // Use a more targeted query instead of querySelectorAll('*') to avoid expensive DOM traversal
                        var formContainer = document.querySelector('[role="dialog"], .modal, [class*="modal"], form');
                        var searchScope = formContainer || document.body;
                        var candidateElements = searchScope.querySelectorAll('input[type="text"], input:not([type]), div, label, button');
                        var newConditionalDropdowns = [];
                        
                        for (var cond = 0; cond < candidateElements.length; cond++) {
                          var elem = candidateElements[cond];
                          // Skip if not visible
                          if (!elem.offsetParent) continue;
                          
                          var elemText = (elem.textContent || '').toLowerCase();
                          var elemHTML = (elem.innerHTML || '').toLowerCase();
                          
                          // Check for "Select one or more" text
                          var hasSelectOneOrMore = elemText.indexOf('select one or more') > -1 ||
                                                  elemHTML.indexOf('select one or more') > -1 ||
                                                  (elem.tagName === 'INPUT' && (elem.placeholder || '').toLowerCase().indexOf('select one or more') > -1);
                          
                          if (hasSelectOneOrMore && elemText.length < 500) { // Not too long
                            
                            // Check if this dropdown is already in the processed list
                            var alreadyProcessed = false;
                            for (var proc = 0; proc < customDropdownsToProcess.length; proc++) {
                              if (customDropdownsToProcess[proc].element === elem || 
                                  (customDropdownsToProcess[proc].element && customDropdownsToProcess[proc].element.contains && customDropdownsToProcess[proc].element.contains(elem)) ||
                                  (elem.contains && elem.contains(customDropdownsToProcess[proc].element))) {
                                alreadyProcessed = true;
                                break;
                              }
                            }
                            
                            if (!alreadyProcessed) {
                              // Check if it's required (has asterisk or red border)
                              var hasAsterisk = elemText.indexOf('*') > -1 || elemHTML.indexOf('*') > -1 || elemHTML.indexOf('&#42;') > -1;
                              var hasRedBorder = false;
                              
                              // Check for red border (validation error indicator)
                              var input = elem.tagName === 'INPUT' ? elem : elem.querySelector('input');
                              if (input) {
                                var style = window.getComputedStyle(input);
                                var borderColor = style.borderColor || '';
                                if (borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                    borderColor.indexOf('rgb(220, 38, 38)') > -1 ||
                                    borderColor.indexOf('#ef4444') > -1) {
                                  hasRedBorder = true;
                                }
                              }
                              
                              // Also check parent container for labels with asterisks
                              if (!hasAsterisk) {
                                var container = elem.closest('div, form, section, fieldset');
                                if (container) {
                                  var allLabels = container.querySelectorAll('label, p, div, span, h3, h4');
                                  for (var lbl = 0; lbl < allLabels.length; lbl++) {
                                    var labelEl = allLabels[lbl];
                                    var labelText = (labelEl.textContent || '').toLowerCase();
                                    var labelHTML = (labelEl.innerHTML || '').toLowerCase();
                                    if (labelText.length > 10 && labelText.length < 200 && 
                                        (labelText.indexOf('if you') > -1 || labelText.indexOf('check all') > -1 ||
                                         labelText.indexOf('categories') > -1 || labelText.indexOf('apply to') > -1) &&
                                        (labelText.indexOf('*') > -1 || labelHTML.indexOf('*') > -1 || labelHTML.indexOf('&#42;') > -1)) {
                                      hasAsterisk = true;
                                      break;
                                    }
                                  }
                                }
                              }
                              
                              if (hasAsterisk || hasRedBorder) {
                                var innerInput = elem.tagName === 'INPUT' ? elem : elem.querySelector('input[type="text"], input:not([type]), input[placeholder*="select"]');
                                var targetElement = innerInput || elem;
                                
                                // Extract label text
                                var labelText = '';
                                var container = elem.closest('div, form, section, fieldset');
                                if (container) {
                                  var allLabels = container.querySelectorAll('label, p, div, span, h3, h4');
                                  for (var lbl = 0; lbl < allLabels.length; lbl++) {
                                    var labelEl = allLabels[lbl];
                                    var labelTextCheck = (labelEl.textContent || '').toLowerCase();
                                    if (labelTextCheck.indexOf('if you') > -1 || labelTextCheck.indexOf('check all') > -1 ||
                                        labelTextCheck.indexOf('categories') > -1) {
                                      labelText = (labelEl.textContent || '').trim();
                                      break;
                                    }
                                  }
                                }
                                
                                if (!labelText) {
                                  labelText = (elem.textContent || '').trim().replace(/select one or more.*$/i, '').replace(/this field is required.*$/i, '').trim();
                                }
                                
                                console.log('[Luma Auto Register] ✓ Found conditional dropdown: "' + labelText.substring(0, 100) + '"');
                                newConditionalDropdowns.push({
                                  element: targetElement,
                                  label: labelText.toLowerCase(),
                                  isMultiSelect: true
                                });
                              }
                            }
                          }
                        }
                        
                        // Process any new conditional dropdowns found
                        if (newConditionalDropdowns.length > 0) {
                          console.log('[Luma Auto Register] Found ' + newConditionalDropdowns.length + ' conditional dropdown(s) to process');
                          // Add them to the processing queue
                          for (var newDrop = 0; newDrop < newConditionalDropdowns.length; newDrop++) {
                            customDropdownsToProcess.push(newConditionalDropdowns[newDrop]);
                          }
                          // Process them
                          processCustomDropdown(customDropdownsToProcess.length - newConditionalDropdowns.length);
                        } else {
                          console.log('[Luma Auto Register] No new conditional dropdowns found');
                          // Re-scanning complete, now trigger submit button search
                          // This ensures re-scanning doesn't interfere with form submission
                          if (typeof window !== 'undefined') {
                            window.__lumaReScanningComplete = true;
                          }
                        }
                      }, 1500); // Wait 1.5 seconds for conditional dropdowns to appear
                      
                      // NOW check the terms checkbox (after all fields and dropdowns are filled)
                      // This prevents interference with dropdown interactions
                      // Always check if it's required (has asterisk), or if autoAcceptTerms is enabled
                      if (termsCheckbox) {
                        // Check if it's required (has asterisk in label)
                        var isRequired = false;
                        var termsLabel = '';
                        var termsLabelEl = termsCheckbox.closest('label') || 
                                         document.querySelector('label[for="' + (termsCheckbox.id || '') + '"]') ||
                                         termsCheckbox.previousElementSibling;
                        if (termsLabelEl) {
                          termsLabel = (termsLabelEl.textContent || termsLabelEl.innerText || '').toLowerCase();
                          if (termsLabel.indexOf('*') > -1 || (termsLabelEl.innerHTML || '').indexOf('*') > -1) {
                            isRequired = true;
                          }
                        }
                        
                        // Check if we should check it (required OR autoAcceptTerms enabled)
                        if (isRequired || settings.autoAcceptTerms) {
                          console.log('[Luma Auto Register] === ACCEPTING TERMS (after all fields filled) ===');
                          if (isRequired) {
                            console.log('[Luma Auto Register] Terms checkbox is required (has asterisk), checking it');
                          } else {
                            console.log('[Luma Auto Register] Auto-accept terms is enabled, checking it');
                          }
                        
                        // Add a passive observer to track when checkbox changes (for debugging)
                        // This will help us see if something is unchecking it
                        var debugObserver = new MutationObserver(function(mutations) {
                          mutations.forEach(function(mutation) {
                            if (mutation.attributeName === 'checked' || mutation.type === 'attributes') {
                              var currentChecked = termsCheckbox.checked;
                              console.log('[Luma Auto Register] 🔍 DEBUG: Terms checkbox state changed to: ' + currentChecked + ' (attribute: ' + mutation.attributeName + ')');
                              
                              // Log stack trace to see what's changing it
                              if (!currentChecked) {
                                console.log('[Luma Auto Register] 🔍 DEBUG: Checkbox was unchecked! Stack trace:');
                                console.trace();
                              }
                            }
                          });
                        });
                        
                        // Observe the checkbox
                        debugObserver.observe(termsCheckbox, {
                          attributes: true,
                          attributeFilter: ['checked'],
                          attributeOldValue: true
                        });
                        
                        // Store observer for cleanup
                        if (typeof window !== 'undefined') {
                          window.__lumaCheckboxDebugObserver = debugObserver;
                        }
                        
                        // Check the checkbox once - no observers or periodic checks needed
                        if (!termsCheckbox.checked) {
                          console.log('[Luma Auto Register] Checking terms checkbox via helper (after all fields filled)');
                          reliablyCheckCheckbox(termsCheckbox, 'terms checkbox');
                        } else {
                          console.log('[Luma Auto Register] ✓ Terms checkbox already checked (current state: ' + termsCheckbox.checked + ')');
                        }
                        
                        // Verify it stays checked after a brief delay
                        setTimeout(function() {
                          var stillChecked = termsCheckbox.checked;
                          console.log('[Luma Auto Register] 🔍 DEBUG: Checkbox state after 500ms: ' + stillChecked);
                          if (!stillChecked) {
                            console.log('[Luma Auto Register] ⚠️ WARNING: Checkbox was unchecked! Something is interfering with it.');
                          }
                        }, 500);
                        } else {
                          console.log('[Luma Auto Register] Terms checkbox found but not required and autoAcceptTerms is disabled - skipping');
                        }
                      }
                      
                      // All dropdowns processed, now wait for terms modal and then find submit button
                      setTimeout(function() {
                        // Check terms checkbox before looking for submit button
                        if (termsCheckbox) {
                          var isRequired = false;
                          var termsLabelEl = termsCheckbox.closest('label') || 
                                           document.querySelector('label[for="' + (termsCheckbox.id || '') + '"]') ||
                                           termsCheckbox.previousElementSibling;
                          if (termsLabelEl) {
                            var termsLabel = (termsLabelEl.textContent || termsLabelEl.innerText || '').toLowerCase();
                            if (termsLabel.indexOf('*') > -1 || (termsLabelEl.innerHTML || '').indexOf('*') > -1) {
                              isRequired = true;
                            }
                          }
                          
                          if (isRequired || settings.autoAcceptTerms) {
                            console.log('[Luma Auto Register] === ACCEPTING TERMS (no dropdowns to process) ===');
                            if (!termsCheckbox.checked) {
                              console.log('[Luma Auto Register] Checking terms checkbox via helper (no dropdowns path)');
                              reliablyCheckCheckbox(termsCheckbox, 'terms checkbox');
                            } else {
                              console.log('[Luma Auto Register] ✓ Terms checkbox already checked');
                            }
                          }
                        }
                        
                        checkForTermsModalAndWait(function() {
                          // Final safety check: ensure required phone fields are still filled.
                          try {
                            var finalPhone = (settings.phone || '').trim();
                            if (finalPhone) {
                              var phoneInputs = document.querySelectorAll('input[type="tel"], input[name*="phone"], input[id*="phone"], input[placeholder*="phone"]');
                              for (var pi = 0; pi < phoneInputs.length; pi++) {
                                var pEl = phoneInputs[pi];
                                if (!pEl.offsetParent || pEl.disabled) continue;
                                var current = (pEl.value || '').trim();
                                var placeholder = (pEl.getAttribute('placeholder') || '').trim();
                                
                                // Consider it empty if it has no value, only placeholder, or only a country code.
                                var isEffectivelyEmpty = !current ||
                                  current === placeholder ||
                                  (current.indexOf('+') === 0 && current.replace(/\D/g, '').length <= 2);
                                
                                if (isEffectivelyEmpty || current !== finalPhone) {
                                  console.log('[Luma Auto Register] Ensuring phone field is filled before submit. Current="' + current + '" placeholder="' + placeholder + '"');
                                  pEl.value = finalPhone;
                                  pEl.dispatchEvent(new Event('input', { bubbles: true }));
                                  pEl.dispatchEvent(new Event('change', { bubbles: true }));
                                  pEl.dispatchEvent(new Event('blur', { bubbles: true }));
                                }
                              }
                            }
                          } catch (phoneCheckError) {
                            console.log('[Luma Auto Register] Could not run final phone check: ' + phoneCheckError.message);
                          }
                          
                          console.log('[Luma Auto Register] === LOOKING FOR SUBMIT BUTTON ===');
                          
                          // First try to find buttons in modals/dialogs (they're usually the submit buttons we want)
                          var modalButtons = document.querySelectorAll('[role="dialog"] button, .modal button, [class*="modal"] button');
                          var allButtons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
                          
                          console.log('[Luma Auto Register] Found ' + modalButtons.length + ' modal buttons, ' + allButtons.length + ' total buttons');
                          
                          var submitBtn = null;
                          var submitKeywords = ['request to join', 'submit', 'register', 'confirm', 'rsvp', 'join', 'continue', 'next', 'send'];
                          
                          // Function to check if button matches our criteria
                          function checkButton(btn, index, source) {
                            var text = btn.textContent.toLowerCase().trim();
                            var ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                            var title = (btn.getAttribute('title') || '').toLowerCase();
                            var type = btn.type || '';
                            var disabled = btn.disabled ? ' [DISABLED]' : '';
                            var visible = btn.offsetParent !== null ? ' [VISIBLE]' : ' [HIDDEN]';
                            
                            // Combine all text sources
                            var allText = text + ' ' + ariaLabel + ' ' + title;
                            
                            console.log('[Luma Auto Register] ' + source + ' Button ' + index + ': "' + text + '"' + 
                                        ' aria="' + ariaLabel + '" title="' + title + '"' + disabled + visible + ' (type: ' + type + ')');
                            
                            // Check if button text/label contains any submit keywords
                            for (var k = 0; k < submitKeywords.length; k++) {
                              if (allText.indexOf(submitKeywords[k]) > -1 || type === 'submit') {
                                // Check if visible and not disabled
                                if (btn.offsetParent !== null && !btn.disabled) {
                                  // Prefer buttons with actual text over empty buttons
                                  if (text.length > 0 || ariaLabel.length > 0 || type === 'submit') {
                                    console.log('[Luma Auto Register] ✓✓✓ MATCHED KEYWORD: "' + submitKeywords[k] + '" or type=submit');
                                    return btn;
                                  }
                                } else if (btn.disabled) {
                                  console.log('[Luma Auto Register] ⚠️ Matched but disabled: "' + (text || ariaLabel || type) + '"');
                                } else {
                                  console.log('[Luma Auto Register] ⚠️ Matched but hidden: "' + (text || ariaLabel || type) + '"');
                                }
                              }
                            }
                            return null;
                          }
                          
                          // First check modal buttons (highest priority)
                          console.log('[Luma Auto Register] Checking modal buttons first...');
                          var bestButton = null;
                          var bestButtonScore = 0; // Prefer buttons with text over empty ones
                          
                          for (var i = 0; i < modalButtons.length; i++) {
                            var found = checkButton(modalButtons[i], i, 'MODAL');
                            if (found) {
                              // Score the button - prefer ones with text
                              var text = found.textContent.trim();
                              var ariaLabel = found.getAttribute('aria-label') || '';
                              var score = text.length + ariaLabel.length;
                              if (found.type === 'submit') score += 10; // Bonus for submit type
                              
                              if (score > bestButtonScore) {
                                bestButton = found;
                                bestButtonScore = score;
                                console.log('[Luma Auto Register] New best button with score: ' + score);
                              }
                            }
                          }
                          
                          submitBtn = bestButton;
                          
                          // If not found in modal, check all buttons
                          if (!submitBtn) {
                            console.log('[Luma Auto Register] No modal button found, checking all buttons...');
                            for (var i = 0; i < allButtons.length; i++) {
                              var found = checkButton(allButtons[i], i, 'ALL');
                              if (found) {
                                submitBtn = found;
                                break;
                              }
                            }
                          }
                          
                          if (!submitBtn) {
                            console.log('[Luma Auto Register] ✗✗✗ NO SUBMIT BUTTON FOUND');
                            console.log('[Luma Auto Register] This might be a one-click registration, checking status...');
                            
                            // Check if auto-registered
                            setTimeout(function() {
                              var bodyText = document.body.textContent;
                              var bodyTextLower = bodyText.toLowerCase();
                              var success = bodyTextLower.indexOf("you're going") > -1 ||
                                            bodyTextLower.indexOf("you're registered") > -1 ||
                                            bodyTextLower.indexOf("you're in") > -1 ||
                                            bodyTextLower.indexOf("pending approval") > -1 ||
                                            bodyTextLower.indexOf("registration confirmed") > -1 ||
                                            bodyTextLower.indexOf("you're on the waitlist") > -1 ||
                                            bodyTextLower.indexOf("on the waitlist") > -1 ||
                                            bodyTextLower.indexOf("we will let you know when the host approves") > -1 ||
                                            bodyTextLower.indexOf("thank you for joining") > -1 ||
                                            bodyTextLower.indexOf("thanks for joining") > -1;
                              
                              if (success) {
                                console.log('[Luma Auto Register] ✓ Auto-registered successfully!');
                                resolve({ 
                                  success: true,
                                  message: 'Registered successfully (one-click)'
                                });
                              } else {
                                console.log('[Luma Auto Register] ✗ No submit button and not auto-registered');
                                resolve({ 
                                  success: false, 
                                  message: 'Could not find submit button - please register manually' 
                                });
                              }
                            }, 2000);
                            return;
                          }
                          
                          // FOUND THE SUBMIT BUTTON!
                          console.log('[Luma Auto Register] ✓✓✓ FOUND SUBMIT BUTTON: "' + submitBtn.textContent.trim() + '"');
                          console.log('[Luma Auto Register] Button disabled status: ' + submitBtn.disabled);
                          
                          // Check if button is disabled - if so, wait a bit for it to enable
                          if (submitBtn.disabled) {
                            console.log('[Luma Auto Register] ⚠️ Button is disabled, waiting 1.5 seconds for validation...');
                            setTimeout(function() {
                              if (submitBtn.disabled) {
                                console.log('[Luma Auto Register] ✗ Button still disabled after waiting');
                                resolve({
                                  success: false,
                                  message: 'Submit button disabled - form validation may have failed'
                                });
                                return;
                              }
                              
                              // Check for terms modal before submitting (only if not already handled)
                              if (typeof window === 'undefined' || !window.__lumaTermsModalHandled) {
                                if (handleTermsModal(function() {
                                  // After terms modal is handled, try submitting again
                                  var submitBtn2 = document.querySelector('button[type="submit"], button:not([type])');
                                  var submitText2 = submitBtn2 ? submitBtn2.textContent.toLowerCase() : '';
                                  if (submitText2.indexOf('request to join') > -1 || 
                                      submitText2.indexOf('submit') > -1 ||
                                      submitText2.indexOf('register') > -1) {
                                    console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON (after terms) ===');
                                    
                                    // Try to find the form element and submit it directly
                                    var formElement2 = submitBtn2.closest('form');
                                    if (!formElement2) {
                                      var parent2 = submitBtn2.parentElement;
                                      while (parent2 && parent2.tagName !== 'FORM' && parent2 !== document.body) {
                                        parent2 = parent2.parentElement;
                                      }
                                      if (parent2 && parent2.tagName === 'FORM') {
                                        formElement2 = parent2;
                                      }
                                    }
                                    
                                    if (formElement2) {
                                      try {
                                        formElement2.requestSubmit(submitBtn2);
                                      } catch (e) {
                                        try {
                                          formElement2.submit();
                                        } catch (e2) {}
                                      }
                                    }
                                    
                                    submitBtn2.click();
                                    submitBtn2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                    submitBtn2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                    submitBtn2.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                                    
                                    if (submitBtn2.type === 'submit' && formElement2) {
                                      var submitEvent2 = new Event('submit', { bubbles: true, cancelable: true });
                                      formElement2.dispatchEvent(submitEvent2);
                                    }
                                  }
                                })) {
                                  return; // Terms modal was found and handled, don't proceed with normal submit
                                }
                              }
                              
                              // Button is now enabled, click it!
                              console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON ===');
                              console.log('[Luma Auto Register] Button text: "' + submitBtn.textContent + '"');
                              console.log('[Luma Auto Register] Button aria-label: "' + (submitBtn.getAttribute('aria-label') || 'none') + '"');
                              console.log('[Luma Auto Register] Button type: ' + (submitBtn.type || 'none'));
                              
                              // FINAL CHECK: Ensure terms checkbox is checked before submitting
                              if (termsCheckbox && !termsCheckbox.checked) {
                                console.log('[Luma Auto Register] ⚠️ Terms checkbox unchecked before final submit, checking now...');
                                reliablyCheckCheckbox(termsCheckbox, 'terms checkbox (final pre-submit)');
                                // Wait a moment for checkbox to be processed
                                setTimeout(function() {
                              // Mark form as submitted to prevent re-scanning from interfering
                              if (typeof window !== 'undefined') {
                                window.__lumaFormSubmitted = true;
                              }
                              
                              // Try multiple click methods
                              submitBtn.click();
                              submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                              submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                              
                              console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                                }, 200);
                                return;
                              }
                              
                              // Mark form as submitted to prevent re-scanning from interfering
                              if (typeof window !== 'undefined') {
                                window.__lumaFormSubmitted = true;
                              }
                              
                              // Try to find the form element and submit it directly
                              var formElement = submitBtn.closest('form');
                              if (!formElement) {
                                // Try to find form by searching up the DOM tree
                                var parent = submitBtn.parentElement;
                                while (parent && parent.tagName !== 'FORM' && parent !== document.body) {
                                  parent = parent.parentElement;
                                }
                                if (parent && parent.tagName === 'FORM') {
                                  formElement = parent;
                                }
                              }
                              
                              // Try multiple submission methods
                              if (formElement) {
                                console.log('[Luma Auto Register] Found form element, submitting directly...');
                                try {
                                  formElement.requestSubmit(submitBtn);
                                  } catch (e) {
                                  console.log('[Luma Auto Register] requestSubmit failed, trying submit()...');
                                  try {
                                    formElement.submit();
                                  } catch (e2) {
                                    console.log('[Luma Auto Register] submit() failed, falling back to button click...');
                                  }
                                }
                              }
                              
                              // Also try clicking the button (some forms need this)
                              submitBtn.click();
                              submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                              submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                              submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                              
                              // Try submit event on button
                              if (submitBtn.type === 'submit' && formElement) {
                                var submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                                formElement.dispatchEvent(submitEvent);
                              }
                              
                              console.log('[Luma Auto Register] ✓ Submit attempted (form submit + button click)!');
                              
                              // Check for terms modal that appears AFTER clicking submit (e.g., "Accept Terms" modal)
                              // Use multiple retries since the modal might appear with a delay
                              var checkPostSubmitModal = function(attempt) {
                                attempt = attempt || 1;
                                var maxAttempts = 5;
                                var delay = attempt === 1 ? 500 : 1000; // First check after 500ms, then every 1s
                                
                                setTimeout(function() {
                                  console.log('[Luma Auto Register] === CHECKING FOR POST-SUBMIT TERMS MODAL (attempt ' + attempt + '/' + maxAttempts + ') ===');
                                  
                                  // Reset the flag to allow checking again (since this is a new modal after submit)
                                  if (typeof window !== 'undefined') {
                                    window.__lumaTermsModalHandled = false;
                                  }
                                  
                                  if (handleTermsModal(function() {
                                    console.log('[Luma Auto Register] ✓ Post-submit terms modal handled successfully');
                                    // After handling the modal, wait a bit then check the result
                                          setTimeout(function() {
                                      // Continue with result checking
                                      checkRegistrationResult();
                                          }, 2000);
                                  })) {
                                    // Modal was found and is being handled, callback will check result
                                          return;
                                        }
                                  
                                  // If not found and we haven't reached max attempts, try again
                                  if (attempt < maxAttempts) {
                                    console.log('[Luma Auto Register] No post-submit terms modal found yet (attempt ' + attempt + '), retrying...');
                                    checkPostSubmitModal(attempt + 1);
                                    return;
                                  }
                                  
                                  // No modal found after all attempts, continue with normal flow
                                  console.log('[Luma Auto Register] No post-submit terms modal found after ' + maxAttempts + ' attempts, continuing...');
                                }, delay);
                              };
                              
                              // Start checking for post-submit modal
                              checkPostSubmitModal(1);
                              
                              // Define result checking function (called normally or after Cloudflare completes)
                              function checkRegistrationResultAfterCloudflare() {
                                console.log('[Luma Auto Register] === CHECKING REGISTRATION RESULT ===');
                                var bodyText = document.body.textContent;
                                
                                // Check for validation errors - prioritize red borders (most reliable)
                                var hasValidationErrors = false;
                                var fieldsWithErrors = []; // Store actual input elements, not just labels
                                
                                // First, find ALL inputs with red borders (most reliable indicator)
                                var allInputs = document.querySelectorAll('input, [role="combobox"], [role="listbox"], textarea');
                                for (var inp = 0; inp < allInputs.length; inp++) {
                                  var inpEl = allInputs[inp];
                                  if (!inpEl.offsetParent || inpEl.disabled) continue; // Skip hidden/disabled
                                  
                                  var style = window.getComputedStyle(inpEl);
                                  var borderColor = style.borderColor || '';
                                  var borderWidth = parseFloat(style.borderWidth) || 0;
                                  
                                  // Check for red border (common validation error indicator)
                                  var hasRedBorder = false;
                                  if (borderWidth > 0) {
                                    // Check various red color formats
                                    if (borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                        borderColor.indexOf('rgb(220, 38, 38)') > -1 ||
                                        borderColor.indexOf('rgb(185, 28, 28)') > -1 ||
                                        borderColor.indexOf('#ef4444') > -1 ||
                                        borderColor.indexOf('#dc2626') > -1 ||
                                        borderColor.indexOf('#b91c1c') > -1 ||
                                        borderColor.toLowerCase().indexOf('red') > -1) {
                                      hasRedBorder = true;
                                    }
                                  }
                                  
                                  // Also check for aria-invalid
                                  var ariaInvalid = inpEl.getAttribute('aria-invalid') === 'true';
                                  
                                  if (hasRedBorder || ariaInvalid) {
                                    // Get the label for this field
                                    var inpLabel = '';
                                    var inpLabelEl = inpEl.closest('label') || 
                                                    inpEl.previousElementSibling ||
                                                    document.querySelector('label[for="' + (inpEl.id || '') + '"]');
                                    
                                    // Also check parent container for label text
                                    var parentContainer = inpEl.closest('div, form, section');
                                    if (parentContainer && !inpLabel) {
                                      var allElements = parentContainer.querySelectorAll('*');
                                      for (var e = 0; e < allElements.length; e++) {
                                        if (allElements[e] === inpEl) {
                                          var prev = inpEl.previousElementSibling;
                                          while (prev && !inpLabel) {
                                            var prevText = (prev.textContent || '').trim();
                                            if (prevText.length > 5 && prevText.length < 200 && 
                                                (prev.tagName === 'LABEL' || prev.tagName === 'P' || prev.tagName === 'DIV' || prev.tagName === 'SPAN')) {
                                              inpLabel = prevText;
                                              break;
                                            }
                                            prev = prev.previousElementSibling;
                                          }
                                          break;
                                        }
                                      }
                                    }
                                    
                                    if (inpLabel) {
                                      fieldsWithErrors.push(inpLabel);
                                    }
                                    hasValidationErrors = true;
                                  }
                                }
                                
                                // Check for error messages in the DOM
                                var errorMessages = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="invalid"], [class*="Invalid"], [aria-invalid="true"]');
                                if (errorMessages.length > 0) {
                                  hasValidationErrors = true;
                                  for (var em = 0; em < errorMessages.length; em++) {
                                    var errorText = (errorMessages[em].textContent || '').trim();
                                    if (errorText.length > 0 && errorText.length < 200) {
                                      fieldsWithErrors.push(errorText);
                                    }
                                  }
                                }
                                
                                if (hasValidationErrors) {
                                  console.log('[Luma Auto Register] ⚠️ Validation errors detected! Missing fields: ' + fieldsWithErrors.join(', '));
                                  console.log('[Luma Auto Register] === RE-SCANNING FOR MISSING FIELDS ===');
                                  
                                  // Re-scan for missing fields and try to fill them
                                  var allInputs2 = document.querySelectorAll('input, textarea, select');
                                  var filledAny = false;
                                  
                                  for (var inp2 = 0; inp2 < allInputs2.length; inp2++) {
                                    var inpEl2 = allInputs2[inp2];
                                    if (!inpEl2.offsetParent || inpEl2.disabled) continue;
                                    
                                    var style2 = window.getComputedStyle(inpEl2);
                                    var borderColor2 = style2.borderColor || '';
                                    var borderWidth2 = parseFloat(style2.borderWidth) || 0;
                                    var hasRedBorder2 = false;
                                    if (borderWidth2 > 0) {
                                      if (borderColor2.indexOf('rgb(239, 68, 68)') > -1 || 
                                          borderColor2.indexOf('rgb(220, 38, 38)') > -1 ||
                                          borderColor2.indexOf('#ef4444') > -1 ||
                                          borderColor2.toLowerCase().indexOf('red') > -1) {
                                        hasRedBorder2 = true;
                                      }
                                    }
                                    var ariaInvalid2 = inpEl2.getAttribute('aria-invalid') === 'true';
                                    
                                    if (hasRedBorder2 || ariaInvalid2) {
                                      // Try to fill this field
                                      var type2 = (inpEl2.type || '').toLowerCase();
                                      var value2 = (inpEl2.value || '').trim();
                                      
                                      if (!value2 || value2.length === 0) {
                                        // Field is empty, try to fill it
                                        var label2 = '';
                                        var labelEl2 = inpEl2.closest('label') || 
                                                      inpEl2.previousElementSibling ||
                                                      document.querySelector('label[for="' + (inpEl2.id || '') + '"]');
                                        if (labelEl2) {
                                          label2 = (labelEl2.textContent || '').toLowerCase();
                                        }
                                        
                                        // Use generic answer for empty required fields
                                        if (type2 === 'text' || type2 === '' || inpEl2.tagName === 'TEXTAREA') {
                                          inpEl2.value = settings.genericAnswer1 || 'To be provided';
                                          inpEl2.dispatchEvent(new Event('input', { bubbles: true }));
                                          inpEl2.dispatchEvent(new Event('change', { bubbles: true }));
                                          console.log('[Luma Auto Register] ✓ Filled missing field: ' + (label2 || 'unknown'));
                                          filledAny = true;
                                        }
                                      }
                                    }
                                  }
                                  
                                  // Also check for unchecked required checkboxes (including terms)
                                  var allCheckboxes2 = document.querySelectorAll('input[type="checkbox"]');
                                  for (var cb2 = 0; cb2 < allCheckboxes2.length; cb2++) {
                                    var checkboxEl2 = allCheckboxes2[cb2];
                                    if (!checkboxEl2.offsetParent || checkboxEl2.disabled) continue;
                                    
                                    if (!checkboxEl2.checked) {
                                      // Check if it's required
                                      var cbLabel2 = '';
                                      var cbLabelEl2 = checkboxEl2.closest('label') || 
                                                      document.querySelector('label[for="' + (checkboxEl2.id || '') + '"]');
                                      if (cbLabelEl2) {
                                        cbLabel2 = (cbLabelEl2.textContent || '').toLowerCase();
                                      }
                                      
                                      // Check if it has asterisk or is required
                                      var cbIsRequired = checkboxEl2.required || 
                                                        checkboxEl2.hasAttribute('required') ||
                                                        checkboxEl2.getAttribute('aria-required') === 'true' ||
                                                        (cbLabel2 && cbLabel2.indexOf('*') > -1);
                                      
                                      // Check if it's terms checkbox
                                      var isTerms2 = (cbLabel2 && (
                                        (cbLabel2.indexOf('terms') > -1 && (cbLabel2.indexOf('agree') > -1 || cbLabel2.indexOf('accept') > -1)) ||
                                        (cbLabel2.indexOf('agree') > -1 && cbLabel2.indexOf('terms') > -1)
                                      ));
                                      
                                      if (cbIsRequired || isTerms2) {
                                        console.log('[Luma Auto Register] Found unchecked required checkbox, checking it: ' + (cbLabel2 || 'unknown'));
                                        reliablyCheckCheckbox(checkboxEl2, 'required checkbox');
                                        filledAny = true;
                                      }
                                    }
                                  }
                                  
                                  if (filledAny) {
                                    // Wait a bit, then try submitting again
                                    setTimeout(function() {
                                      // Final check: ensure terms checkbox is checked
                                      if (termsCheckbox && !termsCheckbox.checked) {
                                        console.log('[Luma Auto Register] ⚠️ Terms checkbox unchecked before final submit, checking again...');
                                        reliablyCheckCheckbox(termsCheckbox, 'terms checkbox (final check)');
                                      }
                                      
                                      var submitBtn3 = document.querySelector('button[type="submit"], button:not([type])');
                                      var submitText3 = submitBtn3 ? submitBtn3.textContent.toLowerCase() : '';
                                      if (submitText3.indexOf('request to join') > -1 || 
                                          submitText3.indexOf('submit') > -1 ||
                                          submitText3.indexOf('register') > -1) {
                                        console.log('[Luma Auto Register] Re-submitting after filling missing fields...');
                                        submitBtn3.click();
                                        submitBtn3.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                        submitBtn3.dispatchEvent(new Event('submit', { bubbles: true }));
                                      }
                                    }, 1000);
                                  }
                                }
                                
                                // Note: Result checking will happen in the submit button click handler below
                              } // End of checkRegistrationResultAfterCloudflare function
                            }, 1500); // Wait 1.5 seconds for button to enable
                            return;
                          }
                          
                          // Check for terms modal before submitting (only if not already handled)
                          var termsModalAlreadyHandled = (typeof window !== 'undefined' && window.__lumaTermsModalHandled);
                          console.log('[Luma Auto Register] Terms modal handled flag: ' + termsModalAlreadyHandled);
                          
                          // Store the submitBtn in a closure so any callback can use it
                          var submitBtnToClick = submitBtn;
                          
                          // Check for terms modal before submitting (only if not already handled)
                          if (!termsModalAlreadyHandled) {
                            console.log('[Luma Auto Register] Terms modal not yet handled, checking...');
                            if (handleTermsModal(function() {
                              // After terms modal is handled, click the button we already found
                              console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON (after terms) ===');
                              console.log('[Luma Auto Register] Using previously found button: "' + (submitBtnToClick ? submitBtnToClick.textContent.trim() : 'NOT FOUND') + '"');
                              
                              // Wait a moment for modal to fully close
                              setTimeout(function() {
                                // Final check: ensure terms checkbox is checked before submitting
                                if (termsCheckbox && !termsCheckbox.checked) {
                                  console.log('[Luma Auto Register] ⚠️ Terms checkbox unchecked before submit, checking again...');
                                  reliablyCheckCheckbox(termsCheckbox, 'terms checkbox (pre-submit)');
                                  // Wait a bit for the checkbox to be processed and verify it stays checked
                                  setTimeout(function() {
                                    // Final verification - check again right before clicking
                                    if (!termsCheckbox.checked) {
                                      console.log('[Luma Auto Register] ⚠️ Terms checkbox still unchecked, forcing check one more time...');
                                      reliablyCheckCheckbox(termsCheckbox, 'terms checkbox (final force)');
                                    }
                                    
                                if (submitBtnToClick && submitBtnToClick.offsetParent !== null && !submitBtnToClick.disabled) {
                                  console.log('[Luma Auto Register] Clicking submit button (after terms modal closed)...');
                                      // One more check right before clicking
                                      if (!termsCheckbox.checked) {
                                        termsCheckbox.checked = true;
                                        termsCheckbox.setAttribute('checked', 'checked');
                                        var labelEl = termsCheckbox.closest('label') || document.querySelector('label[for="' + (termsCheckbox.id || '') + '"]');
                                        if (labelEl) labelEl.click();
                                        termsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                      }
                                      // Try to find the form element and submit it directly
                                      var formElement3 = submitBtnToClick.closest('form');
                                      if (!formElement3) {
                                        var parent3 = submitBtnToClick.parentElement;
                                        while (parent3 && parent3.tagName !== 'FORM' && parent3 !== document.body) {
                                          parent3 = parent3.parentElement;
                                        }
                                        if (parent3 && parent3.tagName === 'FORM') {
                                          formElement3 = parent3;
                                        }
                                      }
                                      
                                      if (formElement3) {
                                        try {
                                          formElement3.requestSubmit(submitBtnToClick);
                                        } catch (e) {
                                          try {
                                            formElement3.submit();
                                          } catch (e2) {}
                                        }
                                      }
                                      
                                  submitBtnToClick.click();
                                      submitBtnToClick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                      submitBtnToClick.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                      submitBtnToClick.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                                      
                                      if (submitBtnToClick.type === 'submit' && formElement3) {
                                        var submitEvent3 = new Event('submit', { bubbles: true, cancelable: true });
                                        formElement3.dispatchEvent(submitEvent3);
                                      }
                                      
                                      console.log('[Luma Auto Register] ✓ Submit button clicked (after terms modal)!');
                                    }
                                  }, 300);
                                  return;
                                }
                                
                                // Final verification before clicking
                                if (!termsCheckbox.checked) {
                                  console.log('[Luma Auto Register] ⚠️ Terms checkbox unchecked, checking one final time...');
                                  reliablyCheckCheckbox(termsCheckbox, 'terms checkbox (final check)');
                                }
                                
                                if (submitBtnToClick && submitBtnToClick.offsetParent !== null && !submitBtnToClick.disabled) {
                                  console.log('[Luma Auto Register] Clicking submit button (after terms modal closed)...');
                                  // One more check right before clicking
                                  if (!termsCheckbox.checked) {
                                    termsCheckbox.checked = true;
                                    termsCheckbox.setAttribute('checked', 'checked');
                                    var labelEl = termsCheckbox.closest('label') || document.querySelector('label[for="' + (termsCheckbox.id || '') + '"]');
                                    if (labelEl) labelEl.click();
                                    termsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                  
                                  // Try to find the form element and submit it directly
                                  var formElement = submitBtnToClick.closest('form');
                                  if (!formElement) {
                                    var parent = submitBtnToClick.parentElement;
                                    while (parent && parent.tagName !== 'FORM' && parent !== document.body) {
                                      parent = parent.parentElement;
                                    }
                                    if (parent && parent.tagName === 'FORM') {
                                      formElement = parent;
                                    }
                                  }
                                  
                                  // Try multiple submission methods
                                  if (formElement) {
                                    console.log('[Luma Auto Register] Found form element, submitting directly...');
                                    try {
                                      formElement.requestSubmit(submitBtnToClick);
                                    } catch (e) {
                                      try {
                                        formElement.submit();
                                      } catch (e2) {
                                        console.log('[Luma Auto Register] Form submit() failed, falling back to button click...');
                                      }
                                    }
                                  }
                                  
                                  submitBtnToClick.click();
                                  submitBtnToClick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                  submitBtnToClick.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                  submitBtnToClick.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                                  
                                  if (submitBtnToClick.type === 'submit' && formElement) {
                                    var submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                                    formElement.dispatchEvent(submitEvent);
                                  }
                                  
                                  console.log('[Luma Auto Register] ✓ Submit button clicked (after terms modal)!');
                                } else {
                                  // Fallback: try to find button again
                                  console.log('[Luma Auto Register] ⚠️ Previously found button not available, searching again...');
                                  var submitBtn2 = document.querySelector('button[type="submit"], button:not([type])');
                                  var submitText2 = submitBtn2 ? submitBtn2.textContent.toLowerCase() : '';
                                  if (submitText2.indexOf('request to join') > -1 || 
                                      submitText2.indexOf('submit') > -1 ||
                                      submitText2.indexOf('register') > -1) {
                                    console.log('[Luma Auto Register] Found button again, clicking...');
                                    
                                    var formElement4 = submitBtn2.closest('form');
                                    if (!formElement4) {
                                      var parent4 = submitBtn2.parentElement;
                                      while (parent4 && parent4.tagName !== 'FORM' && parent4 !== document.body) {
                                        parent4 = parent4.parentElement;
                                      }
                                      if (parent4 && parent4.tagName === 'FORM') {
                                        formElement4 = parent4;
                                      }
                                    }
                                    
                                    if (formElement4) {
                                      try {
                                        formElement4.requestSubmit(submitBtn2);
                                      } catch (e) {
                                        try {
                                          formElement4.submit();
                                        } catch (e2) {}
                                      }
                                    }
                                    
                                    submitBtn2.click();
                                    submitBtn2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                    submitBtn2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                    submitBtn2.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                                    
                                    if (submitBtn2.type === 'submit' && formElement4) {
                                      var submitEvent4 = new Event('submit', { bubbles: true, cancelable: true });
                                      formElement4.dispatchEvent(submitEvent4);
                                    }
                                  }
                                }
                              }, 500); // Wait 500ms for modal to close
                            })) {
                              console.log('[Luma Auto Register] Terms modal was found and is being handled, will click after...');
                              return; // Terms modal was found and handled, callback will handle the click
                            }
                          }
                          
                          // Button is enabled and terms modal already handled (or not needed), click immediately!
                          console.log('[Luma Auto Register] Proceeding to click submit button immediately (termsModalAlreadyHandled: ' + termsModalAlreadyHandled + ')...');
                          
                          // IMPORTANT: Check terms checkbox one final time right before submitting
                          // Stop all monitoring first to prevent infinite loops
                          if (typeof window !== 'undefined') {
                            if (window.__lumaCheckboxInterval) {
                              clearInterval(window.__lumaCheckboxInterval);
                              window.__lumaCheckboxInterval = null;
                              console.log('[Luma Auto Register] Stopped periodic checkbox check');
                            }
                            if (window.__lumaCheckboxObserver) {
                              window.__lumaCheckboxObserver.disconnect();
                              window.__lumaCheckboxObserver = null;
                              console.log('[Luma Auto Register] Stopped checkbox observer');
                            }
                            if (window.__lumaCheckboxDebugObserver) {
                              window.__lumaCheckboxDebugObserver.disconnect();
                              window.__lumaCheckboxDebugObserver = null;
                              console.log('[Luma Auto Register] Stopped checkbox debug observer');
                            }
                          }
                          
                          // Final check and ensure it's checked before submitting
                          // Use multiple methods to ensure React recognizes the change
                          // Always check if it's required (has asterisk), or if autoAcceptTerms is enabled
                          if (termsCheckbox) {
                            // Check if it's required (has asterisk)
                            var isRequired = false;
                            var termsLabelEl = termsCheckbox.closest('label') || 
                                             document.querySelector('label[for="' + (termsCheckbox.id || '') + '"]') ||
                                             termsCheckbox.previousElementSibling;
                            if (termsLabelEl) {
                              var termsLabel = (termsLabelEl.textContent || termsLabelEl.innerText || '').toLowerCase();
                              if (termsLabel.indexOf('*') > -1 || (termsLabelEl.innerHTML || '').indexOf('*') > -1) {
                                isRequired = true;
                              }
                            }
                            
                            // Check if we should verify it (required OR autoAcceptTerms enabled)
                            if (isRequired || settings.autoAcceptTerms) {
                              console.log('[Luma Auto Register] === FINAL CHECKBOX VERIFICATION (before submit) ===');
                              if (isRequired) {
                                console.log('[Luma Auto Register] Terms checkbox is required (has asterisk), ensuring it\'s checked');
                              } else {
                                console.log('[Luma Auto Register] Auto-accept terms is enabled, ensuring it\'s checked');
                              }
                              console.log('[Luma Auto Register] Current checkbox state: ' + termsCheckbox.checked);
                            
                            // Method 1: Set the checked property
                            termsCheckbox.checked = true;
                            
                            // Method 2: Try to find and update React's internal state
                            // React controlled components store state in _valueTracker or __reactInternalInstance
                            var reactInstance = termsCheckbox._reactInternalInstance || 
                                                termsCheckbox.__reactInternalInstance ||
                                                (termsCheckbox.__reactFiber$ || termsCheckbox.__reactFiber);
                            
                            if (reactInstance) {
                              console.log('[Luma Auto Register] Found React instance, attempting to update React state');
                              try {
                                // Try to find the state updater
                                var fiber = reactInstance;
                                while (fiber && !fiber.memoizedState) {
                                  fiber = fiber.return;
                                }
                                if (fiber && fiber.memoizedState) {
                                  // Try to trigger React's onChange handler
                                  var onChange = termsCheckbox.onchange;
                                  if (onChange) {
                                    var syntheticEvent = {
                                      target: termsCheckbox,
                                      currentTarget: termsCheckbox,
                                      type: 'change',
                                      bubbles: true,
                                      cancelable: true,
                                      defaultPrevented: false
                                    };
                                    onChange(syntheticEvent);
                                  }
                                }
                              } catch (e) {
                                console.log('[Luma Auto Register] Could not update React state directly: ' + e.message);
                              }
                            }
                            
                            // Method 3: Dispatch events in the correct order for React
                            termsCheckbox.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                            termsCheckbox.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                            termsCheckbox.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
                            
                            // Method 4: Try setting value if it exists
                            if (termsCheckbox.value !== undefined) {
                              termsCheckbox.value = 'on';
                            }
                            
                            // Method 5: Try to find the label and click it (if checkbox is controlled, clicking label might work)
                            var label = document.querySelector('label[for="' + termsCheckbox.id + '"]') ||
                                        termsCheckbox.closest('label');
                            if (label && !label.contains(termsCheckbox)) {
                              // Label wraps the checkbox, clicking label should toggle it
                              // But we want it checked, so only click if it's not already checked
                              if (!termsCheckbox.checked) {
                                console.log('[Luma Auto Register] Clicking label to check checkbox');
                                label.click();
                              }
                            }
                            
                            // Wait and verify it's still checked, then submit
                            setTimeout(function() {
                              var finalState = termsCheckbox.checked;
                              console.log('[Luma Auto Register] Final checkbox state before submit: ' + finalState);
                              
                              if (!finalState) {
                                console.log('[Luma Auto Register] ⚠️⚠️⚠️ CRITICAL: Checkbox is UNCHECKED before submit! Attempting last-ditch effort...');
                                // Last resort: try clicking the checkbox directly (risky, might toggle)
                                // But we know it's unchecked, so clicking should check it
                                termsCheckbox.click();
                                setTimeout(function() {
                                  if (termsCheckbox.checked) {
                                    console.log('[Luma Auto Register] ✓ Checkbox checked via click, proceeding with submit');
                                  } else {
                                    console.log('[Luma Auto Register] ✗✗✗ Checkbox still unchecked after click - form may fail validation');
                                  }
                                  
                                  // Submit regardless - let the form validation handle it
                                  console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON ===');
                                  console.log('[Luma Auto Register] Button text: "' + submitBtn.textContent + '"');
                                  console.log('[Luma Auto Register] Button aria-label: "' + (submitBtn.getAttribute('aria-label') || 'none') + '"');
                                  console.log('[Luma Auto Register] Button type: ' + (submitBtn.type || 'none'));
                                  
                                  submitBtn.click();
                                  submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                  submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                                  
                                  console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                                }, 200);
                              } else {
                                console.log('[Luma Auto Register] ✓ Terms checkbox verified as checked, submitting...');
                              }
                            }, 500);
                          } else {
                            console.log('[Luma Auto Register] Terms checkbox found but not required and autoAcceptTerms is disabled - skipping final check');
                          }
                        }
                          
                          // Submit button click (runs regardless of checkbox state)
                          console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON ===');
                          console.log('[Luma Auto Register] Button text: "' + submitBtn.textContent + '"');
                          console.log('[Luma Auto Register] Button aria-label: "' + (submitBtn.getAttribute('aria-label') || 'none') + '"');
                          console.log('[Luma Auto Register] Button type: ' + (submitBtn.type || 'none'));
                          
                          // CRITICAL: Verify fields are still filled right before submitting
                          var allInputsBeforeSubmit = document.querySelectorAll('input[type="text"], input:not([type]), input[type="email"], textarea');
                          var needsRefill = false;
                          for (var bf = 0; bf < allInputsBeforeSubmit.length; bf++) {
                            var fieldBeforeSubmit = allInputsBeforeSubmit[bf];
                            if (!fieldBeforeSubmit.offsetParent || fieldBeforeSubmit.disabled) continue;
                            
                            var fieldValueBefore = (fieldBeforeSubmit.value || '').trim();
                            var fieldNameBefore = (fieldBeforeSubmit.name || '').toLowerCase();
                            var fieldPlaceholderBefore = (fieldBeforeSubmit.placeholder || '').toLowerCase();
                            
                            var labelElBefore = fieldBeforeSubmit.closest('label') || 
                                               fieldBeforeSubmit.previousElementSibling ||
                                               document.querySelector('label[for="' + (fieldBeforeSubmit.id || '') + '"]');
                            var labelTextBefore = '';
                            if (labelElBefore) {
                              labelTextBefore = (labelElBefore.textContent || '').toLowerCase();
                            }
                            
                            var isRequiredBefore = labelTextBefore.indexOf('*') > -1 || 
                                                  fieldBeforeSubmit.required ||
                                                  fieldBeforeSubmit.getAttribute('aria-required') === 'true';
                            
                            var isFieldWeFilledBefore = (fieldNameBefore.indexOf('name') > -1 && fieldNameBefore !== 'lastname' && fieldNameBefore !== 'firstname') ||
                                                       fieldNameBefore.indexOf('email') > -1 ||
                                                       fieldNameBefore.indexOf('phone') > -1 ||
                                                       fieldPlaceholderBefore.indexOf('name') > -1 ||
                                                       fieldPlaceholderBefore.indexOf('email') > -1 ||
                                                       fieldPlaceholderBefore.indexOf('phone') > -1 ||
                                                       labelTextBefore.indexOf('name') > -1 ||
                                                       labelTextBefore.indexOf('email') > -1 ||
                                                       labelTextBefore.indexOf('phone') > -1;
                            
                            if (isRequiredBefore && isFieldWeFilledBefore && !fieldValueBefore) {
                              console.log('[Luma Auto Register] ⚠️ Field cleared before submit: ' + (labelTextBefore || fieldNameBefore || fieldPlaceholderBefore) + ' - re-filling...');
                              needsRefill = true;
                              
                              if (fieldNameBefore.indexOf('email') > -1 || fieldPlaceholderBefore.indexOf('email') > -1 || labelTextBefore.indexOf('email') > -1) {
                                if (settings.email) {
                                  // Use React-compatible method
                                  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                                  if (nativeInputValueSetter) {
                                    nativeInputValueSetter.call(fieldBeforeSubmit, settings.email);
                                  } else {
                                    fieldBeforeSubmit.value = settings.email;
                                  }
                                  var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                                  Object.defineProperty(inputEvent, 'target', { value: fieldBeforeSubmit, enumerable: true, writable: false });
                                  fieldBeforeSubmit.dispatchEvent(inputEvent);
                                  fieldBeforeSubmit.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                              } else if (fieldNameBefore.indexOf('phone') > -1 || fieldPlaceholderBefore.indexOf('phone') > -1 || labelTextBefore.indexOf('phone') > -1) {
                                if (settings.phone) {
                                  // Use React-compatible method for phone
                                  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                                  if (nativeInputValueSetter) {
                                    nativeInputValueSetter.call(fieldBeforeSubmit, settings.phone);
                                  } else {
                                    fieldBeforeSubmit.value = settings.phone;
                                  }
                                  var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                                  Object.defineProperty(inputEvent, 'target', { value: fieldBeforeSubmit, enumerable: true, writable: false });
                                  fieldBeforeSubmit.dispatchEvent(inputEvent);
                                  fieldBeforeSubmit.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                              } else if (fieldNameBefore.indexOf('name') > -1 || fieldPlaceholderBefore.indexOf('name') > -1 || labelTextBefore.indexOf('name') > -1) {
                                var fullNameBefore = '';
                                if (settings.firstName && settings.lastName) {
                                  fullNameBefore = settings.firstName + ' ' + settings.lastName;
                                } else if (settings.firstName) {
                                  fullNameBefore = settings.firstName;
                                } else if (settings.lastName) {
                                  fullNameBefore = settings.lastName;
                                }
                                if (fullNameBefore) {
                                  // Use React-compatible method
                                  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                                  if (nativeInputValueSetter) {
                                    nativeInputValueSetter.call(fieldBeforeSubmit, fullNameBefore);
                                  } else {
                                    fieldBeforeSubmit.value = fullNameBefore;
                                  }
                                  var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                                  Object.defineProperty(inputEvent, 'target', { value: fieldBeforeSubmit, enumerable: true, writable: false });
                                  fieldBeforeSubmit.dispatchEvent(inputEvent);
                                  fieldBeforeSubmit.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                              }
                            }
                          }
                          
                          if (needsRefill) {
                            console.log('[Luma Auto Register] Fields were cleared, waiting 500ms after re-filling before submitting...');
                            setTimeout(function() {
                              // Mark form as submitted to prevent re-scanning from interfering
                              if (typeof window !== 'undefined') {
                                window.__lumaFormSubmitted = true;
                              }
                              
                              // Try multiple click methods to ensure it works
                              submitBtn.click();
                              submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                              submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                              
                              console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                            }, 500);
                            return;
                          }
                          
                          // Mark form as submitted to prevent re-scanning from interfering
                          if (typeof window !== 'undefined') {
                            window.__lumaFormSubmitted = true;
                          }
                          
                          // Try multiple click methods to ensure it works
                          submitBtn.click();
                          submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                          submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                          
                          console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                          
                          // Wait for submission to process and check result
                          // Use longer initial delay and multiple checks to handle slow form processing
                          setTimeout(function() {
                            // Function to start the success checking process (defined first so it can be called)
                            var startSuccessChecking = function() {
                                  console.log('[Luma Auto Register] === CHECKING REGISTRATION RESULT (initial check after 2s) ===');
                                  
                                  // Helper function to normalize text (handles curly quotes etc.)
                                  var normalizeText = function(str) {
                                    return (str || '')
                                      .toLowerCase()
                                      .replace(/[\u2018\u2019\u201B]/g, "'"); // map various apostrophes to '
                                  };
                                  
                                  // Helper function to check for success
                                  var checkForSuccess = function() {
                                    // Check both textContent and innerHTML (React might update innerHTML first)
                                    var bodyText = document.body.textContent || '';
                                    var bodyHTML = document.body.innerHTML || '';
                                    var bodyTextLower = normalizeText(bodyText);
                                    var bodyHTMLLower = normalizeText(bodyHTML);
                                    
                                    // CRITICAL: Check if form is still visible (indicates failure)
                                    var registrationForm = document.querySelector('form, [role="dialog"] form, .modal form, [class*="form"]');
                                    var submitButtonStillVisible = document.querySelector('button[type="submit"], button:not([type])');
                                    var submitButtonText = submitButtonStillVisible ? (submitButtonStillVisible.textContent || '').toLowerCase() : '';
                                    var isButtonDisabled = submitButtonStillVisible ? submitButtonStillVisible.disabled : false;
                                    var isButtonProcessing = isButtonDisabled || 
                                                           (submitButtonText.indexOf('loading') > -1 ||
                                                            submitButtonText.indexOf('submitting') > -1 ||
                                                            submitButtonText.indexOf('processing') > -1 ||
                                                            submitButtonText.indexOf('please wait') > -1);
                                    
                                    // Only consider button "still there" if it's enabled and clickable (not processing)
                                    var isSubmitButtonStillThere = submitButtonStillVisible && 
                                                                  submitButtonStillVisible.offsetParent !== null &&
                                                                  !isButtonProcessing &&
                                                                  (submitButtonText.indexOf('request to join') > -1 || 
                                                                   submitButtonText.indexOf('submit') > -1 ||
                                                                   submitButtonText.indexOf('register') > -1 ||
                                                                   submitButtonText.indexOf('join') > -1 ||
                                                                   submitButtonText.indexOf('rsvp') > -1);
                                    
                                    // Check for validation errors (indicates failure)
                                    var validationErrors = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="invalid"], [class*="Invalid"], [aria-invalid="true"]');
                                    var hasValidationErrors = false;
                                    var errorText = '';
                                    for (var ve = 0; ve < validationErrors.length; ve++) {
                                      var errorEl = validationErrors[ve];
                                      if (errorEl.offsetParent !== null) { // Only visible errors
                                        var errorTextContent = (errorEl.textContent || '').toLowerCase();
                                        if (errorTextContent.indexOf('required') > -1 || 
                                            errorTextContent.indexOf('field is required') > -1 ||
                                            errorTextContent.indexOf('this field is required') > -1 ||
                                            errorTextContent.indexOf('please fill') > -1 ||
                                            errorTextContent.indexOf('must be') > -1 ||
                                            (errorTextContent.length > 0 && errorTextContent.length < 100)) {
                                          hasValidationErrors = true;
                                          errorText += ' ' + errorTextContent;
                                        }
                                      }
                                    }
                                    
                                    // Check for red borders on inputs (validation errors)
                                    var allInputs = document.querySelectorAll('input, textarea, [role="combobox"], [role="listbox"]');
                                    var inputsWithErrors = 0;
                                    for (var ai = 0; ai < allInputs.length; ai++) {
                                      var input = allInputs[ai];
                                      if (!input.offsetParent || input.disabled) continue;
                                      var style = window.getComputedStyle(input);
                                      var borderColor = style.borderColor || '';
                                      if (borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                          borderColor.indexOf('rgb(220, 38, 38)') > -1 ||
                                          borderColor === '#ef4444' ||
                                          borderColor.toLowerCase().indexOf('red') > -1) {
                                        hasValidationErrors = true;
                                        inputsWithErrors++;
                                        console.log('[Luma Auto Register] Found input with red border (validation error)');
                                      }
                                      if (input.getAttribute('aria-invalid') === 'true') {
                                        hasValidationErrors = true;
                                        inputsWithErrors++;
                                      }
                                    }
                                    
                                    // Check for failure indicators (these should prevent success even if keywords found)
                                    var failureIndicators = bodyTextLower.indexOf('registration failed') > -1 ||
                                                          bodyTextLower.indexOf('unable to register') > -1 ||
                                                          bodyTextLower.indexOf('could not register') > -1 ||
                                                          bodyTextLower.indexOf('error occurred') > -1 ||
                                                          bodyTextLower.indexOf('something went wrong') > -1 ||
                                                          bodyTextLower.indexOf('please try again') > -1 ||
                                                          bodyTextLower.indexOf('try again later') > -1;
                                    
                                    // If button is processing, wait longer - don't mark as failed yet
                                    if (isButtonProcessing) {
                                      console.log('[Luma Auto Register] Submit button is processing (disabled/loading), waiting longer...');
                                      return { success: false, bodyText: bodyText, bodyHTML: bodyHTML, isProcessing: true, hasForm: true, hasErrors: false, failureIndicators: false };
                                    }
                                    
                                    // If form is still visible or validation errors exist, DEFINITELY failed
                                    if (isSubmitButtonStillThere || hasValidationErrors || failureIndicators) {
                                      console.log('[Luma Auto Register] Form still visible or validation errors present - registration DEFINITELY failed');
                                      console.log('[Luma Auto Register] Submit button still visible: ' + isSubmitButtonStillThere);
                                      console.log('[Luma Auto Register] Submit button disabled/processing: ' + isButtonProcessing);
                                      console.log('[Luma Auto Register] Validation errors: ' + hasValidationErrors + ' (inputs with errors: ' + inputsWithErrors + ')');
                                      console.log('[Luma Auto Register] Failure indicators: ' + failureIndicators);
                                      if (errorText) {
                                        console.log('[Luma Auto Register] Error text: ' + errorText.substring(0, 200));
                                      }
                                      // NEVER mark as success if form is still there or errors exist
                                      return { success: false, bodyText: bodyText, bodyHTML: bodyHTML, hasForm: true, hasErrors: hasValidationErrors, failureIndicators: failureIndicators };
                                    }
                                    
                                    // Check if modal/dialog is still open (indicates form might still be there)
                                    var modalStillOpen = document.querySelector('[role="dialog"][aria-hidden="false"], .modal:not([style*="display: none"]), [class*="modal"]:not([style*="display: none"])');
                                    if (modalStillOpen && modalStillOpen.offsetParent !== null) {
                                      // Check if modal contains form elements
                                      var modalHasForm = modalStillOpen.querySelector('form, input, textarea, button[type="submit"]');
                                      if (modalHasForm) {
                                        console.log('[Luma Auto Register] Modal still open with form elements - registration likely failed');
                                        return { success: false, bodyText: bodyText, bodyHTML: bodyHTML, hasForm: true, hasErrors: false };
                                      }
                                    }
                                    
                                    // Also check for specific elements that might contain success messages
                                    var successElements = document.querySelectorAll('h1, h2, h3, [class*="success"], [class*="confirm"], [class*="registered"], [class*="waitlist"]');
                                    var elementText = '';
                                    for (var el = 0; el < successElements.length; el++) {
                                      var elText = successElements[el].textContent || '';
                                      if (elText.length > 0 && elText.length < 150) {
                                        elementText += ' ' + elText;
                                      }
                                    }
                                    var elementTextLower = normalizeText(elementText);
                                    
                                    // Check for success keywords - STRICT MODE (require at least one)
                                    var successKeywords = [
                                      "you're going",
                                      "you're registered",
                                      "you're in",
                                      "you are registered",
                                      "already registered",
                                      "pending approval",
                                      "registration confirmed",
                                      "registration successful",
                                      "successfully registered",
                                      "you're on the waitlist",
                                      "youre on the waitlist",
                                      "on the waitlist",
                                      "we will let you know when the host approves",
                                      "thank you for joining",
                                      "thanks for joining",
                                      "you have already registered for this event",
                                      "you have already registered"
                                    ];
                                    
                                    var successKeywordCount = 0;
                                    var foundSuccessKeywords = [];
                                    for (var sk = 0; sk < successKeywords.length; sk++) {
                                      var keyword = successKeywords[sk];
                                      if (bodyTextLower.indexOf(keyword) > -1 || 
                                          bodyHTMLLower.indexOf(keyword) > -1 ||
                                          elementTextLower.indexOf(keyword) > -1) {
                                        successKeywordCount++;
                                        foundSuccessKeywords.push(keyword);
                                      }
                                    }
                                    
                                    // STRICT: Require at least one success keyword AND form must be gone
                                    var hasSuccessKeyword = successKeywordCount > 0;
                                    
                                    // Additional check: Look for success in specific high-confidence locations
                                    var highConfidenceSuccess = false;
                                    var successContainers = document.querySelectorAll('[class*="success"], [class*="confirm"], [class*="registered"], [class*="waitlist"], [class*="ticket"]');
                                    for (var sc = 0; sc < successContainers.length; sc++) {
                                      var containerText = normalizeText(successContainers[sc].textContent || '');
                                      for (var sk = 0; sk < successKeywords.length; sk++) {
                                        if (containerText.indexOf(successKeywords[sk]) > -1) {
                                          highConfidenceSuccess = true;
                                          break;
                                        }
                                      }
                                      if (highConfidenceSuccess) break;
                                    }
                                    
                                    // STRICT MODE: Only mark as success if:
                                    // 1. Form is NOT visible (already checked above)
                                    // 2. NO validation errors (already checked above)
                                    // 3. Has success keyword OR high confidence success indicator
                                    // 4. NO failure indicators (already checked above)
                                    var success = hasSuccessKeyword || highConfidenceSuccess;
                                    
                                    // Fallback: trust the network success flag ONLY if:
                                    // - Form is NOT visible
                                    // - NO validation errors
                                    // - NO failure indicators
                                    // - AND we have at least some indication of success (keyword or high confidence)
                                    try {
                                      if (!success && !isSubmitButtonStillThere && !hasValidationErrors && !failureIndicators && 
                                          typeof window !== 'undefined' && window.__lumaAutoRegisterNetworkSuccessFlag) {
                                        // Even with network flag, require at least one success indicator
                                        if (hasSuccessKeyword || highConfidenceSuccess) {
                                          console.log('[Luma Auto Register] Success inferred from network response + success indicators (standard form submit)');
                                          success = true;
                                        } else {
                                          console.log('[Luma Auto Register] Network flag present but no success indicators found - not marking as success');
                                        }
                                      }
                                    } catch (networkFlagError) {
                                      console.log('[Luma Auto Register] Error while checking network success flag: ' + networkFlagError.message);
                                    }
                                    
                                    if (success) {
                                      console.log('[Luma Auto Register] Success confirmed with ' + successKeywordCount + ' keyword(s): ' + foundSuccessKeywords.join(', '));
                                    }
                                    
                                    return { 
                                      success: success, 
                                      bodyText: bodyText, 
                                      bodyHTML: bodyHTML, 
                                      hasForm: isSubmitButtonStillThere, 
                                      hasErrors: hasValidationErrors, 
                                      failureIndicators: failureIndicators,
                                      keywordCount: successKeywordCount,
                                      keywords: foundSuccessKeywords,
                                      isProcessing: isButtonProcessing
                                    };
                                  };
                                  
                                  // Helper function to handle results
                                  function handleResult(result, checkNumber) {
                                  // STRICT: If form is still visible or has errors, registration DEFINITELY failed
                                    if (result.hasForm || result.hasErrors || result.failureIndicators) {
                                      console.log('[Luma Auto Register] ✗✗✗ REGISTRATION FAILED - Form still visible or validation errors present (check ' + checkNumber + ')');
                                    var errorMsg = 'Registration failed';
                                      if (result.hasErrors) {
                                      errorMsg += ' (validation errors detected)';
                                    }
                                      if (result.hasForm) {
                                      errorMsg += ' (submit button still visible)';
                                    }
                                      if (result.failureIndicators) {
                                      errorMsg += ' (failure indicators found)';
                                    }
                                    resolve({ 
                                      success: false,
                                      message: errorMsg
                                    });
                                    return;
                                  }
                                  
                                  // Only mark as success if we have clear success indicators
                                    if (result.success && result.keywordCount > 0) {
                                      console.log('[Luma Auto Register] ✓✓✓ REGISTRATION CONFIRMED! (check ' + checkNumber + ')');
                                      console.log('[Luma Auto Register] Success keywords found: ' + result.keywords.join(', '));
                                    resolve({ 
                                      success: true,
                                      message: 'Registered successfully'
                                    });
                                    return;
                                  }
                                  
                                    // Continue to next check if not processing and no clear result
                                    if (!result.isProcessing) {
                                      console.log('[Luma Auto Register] ⚠️ Could not confirm registration (check ' + checkNumber + ') - no clear success indicators');
                                      console.log('[Luma Auto Register] Success keyword count: ' + result.keywordCount);
                                      console.log('[Luma Auto Register] Page text sample: ' + result.bodyText.substring(0, 200));
                                    }
                                  }
                                  
                                  // First check after 2 seconds (changed from 4 to allow faster initial check)
                                  var result1 = checkForSuccess();
                                  
                                  // If button is still processing, wait longer before checking again
                                  if (result1.isProcessing) {
                                    console.log('[Luma Auto Register] Button still processing, waiting 3 more seconds...');
                                    setTimeout(function() {
                                      var result1b = checkForSuccess();
                                      if (result1b.isProcessing) {
                                        console.log('[Luma Auto Register] Button still processing, waiting 3 more seconds...');
                                        setTimeout(function() {
                                          var result1c = checkForSuccess();
                                          handleResult(result1c, 1);
                                        }, 3000);
                                      } else {
                                        handleResult(result1b, 1);
                                      }
                                    }, 3000);
                                      return;
                                    }
                                    
                                  handleResult(result1, 1);
                                  
                                  // Second check after 3 seconds (total 5 seconds)
                                  setTimeout(function() {
                                    var result2 = checkForSuccess();
                                    
                                    // If still processing, wait more
                                    if (result2.isProcessing) {
                                      console.log('[Luma Auto Register] Button still processing, waiting 3 more seconds...');
                                      setTimeout(function() {
                                        var result2b = checkForSuccess();
                                        handleResult(result2b, 2);
                                      }, 3000);
                                      return;
                                    }
                                    
                                    handleResult(result2, 2);
                                    
                                    // Third check after another 3 seconds (total 8 seconds)
                                    setTimeout(function() {
                                      var result3 = checkForSuccess();
                                      
                                      // If still processing, wait more
                                      if (result3.isProcessing) {
                                        console.log('[Luma Auto Register] Button still processing, waiting 3 more seconds...');
                                        setTimeout(function() {
                                          var result3b = checkForSuccess();
                                          handleResult(result3b, 3);
                                        }, 3000);
                                        return;
                                      }
                                      
                                      handleResult(result3, 3);
                                      
                                      // Final check after another 3 seconds (total 11 seconds)
                                      setTimeout(function() {
                                        var result4 = checkForSuccess();
                                        if (result4.isProcessing) {
                                          console.log('[Luma Auto Register] Button still processing after 11 seconds, marking as failed');
                                        resolve({ 
                                            success: false, 
                                            message: 'Registration timed out - button still processing'
                                        });
                                      } else {
                                          handleResult(result4, 4);
                                          // If we get here and no success, mark as failed
                                          if (!result4.success) {
                                            console.log('[Luma Auto Register] ✗✗✗ COULD NOT CONFIRM REGISTRATION (final check)');
                                            console.log('[Luma Auto Register] Success keyword count: ' + result4.keywordCount);
                                            console.log('[Luma Auto Register] Page text sample: ' + result4.bodyText.substring(0, 200));
                                        resolve({ 
                                          success: false, 
                                          message: 'Could not confirm registration - please check manually'
                                        });
                                      }
                                        }
                                      }, 3000);
                                    }, 3000); // Third check after 3 more seconds
                                  }, 3000); // Second check after 3 seconds
                            }; // End of startSuccessChecking function
                            
                            // First check if Cloudflare is present - if so, wait for it to complete before checking success
                            var bodyText = (document.body.textContent || '').toLowerCase();
                            var bodyHTML = (document.body.innerHTML || '').toLowerCase();
                            var hasCloudflare = bodyText.indexOf('verifying your browser') > -1 ||
                                               bodyText.indexOf("we're doing a quick check") > -1 ||
                                               bodyText.indexOf('verifying...') > -1 ||
                                               bodyText.indexOf('cloudflare') > -1 ||
                                               bodyHTML.indexOf('cf-browser-verification') > -1 ||
                                               bodyHTML.indexOf('challenge-platform') > -1 ||
                                               document.querySelector('[id*="cf-"], [class*="cf-"], [id*="challenge"], [class*="challenge"]') !== null;
                            
                            if (hasCloudflare) {
                              console.log('[Luma Auto Register] ⚠️ Cloudflare challenge detected - waiting for it to complete before checking success...');
                              
                              // Poll for Cloudflare completion
                              var checkCloudflareComplete = function(attempts, maxAttempts) {
                                attempts = attempts || 0;
                                maxAttempts = maxAttempts || 90; // Wait up to 45 seconds (90 attempts * 500ms)
                                
                                var bodyText2 = (document.body.textContent || '').toLowerCase();
                                var bodyHTML2 = (document.body.innerHTML || '').toLowerCase();
                                var stillHasCloudflare = bodyText2.indexOf('verifying your browser') > -1 ||
                                                         bodyText2.indexOf("we're doing a quick check") > -1 ||
                                                         bodyText2.indexOf('verifying...') > -1 ||
                                                         bodyHTML2.indexOf('cf-browser-verification') > -1 ||
                                                         bodyHTML2.indexOf('challenge-platform') > -1 ||
                                                         document.querySelector('[id*="cf-"], [class*="cf-"], [id*="challenge"], [class*="challenge"]') !== null;
                                
                                if (!stillHasCloudflare || attempts >= maxAttempts) {
                                  if (!stillHasCloudflare) {
                                    console.log('[Luma Auto Register] ✓ Cloudflare challenge completed (after ' + attempts + ' checks)!');
                                  } else {
                                    console.log('[Luma Auto Register] ⚠️ Cloudflare challenge still present after ' + maxAttempts + ' checks, proceeding with success check anyway...');
                                  }
                                  
                                  // Cloudflare completed (or timed out) - wait additional delay before checking success
                                  // This gives time for the success message to appear after Cloudflare completes
                                  console.log('[Luma Auto Register] Waiting 3 seconds after Cloudflare completion before checking success...');
                                  setTimeout(function() {
                                    startSuccessChecking();
                                  }, 3000);
                                } else {
                                  // Still waiting for Cloudflare
                                  setTimeout(function() {
                                    checkCloudflareComplete(attempts + 1, maxAttempts);
                                  }, 500);
                                }
                              };
                              
                              // Start checking for Cloudflare completion
                              checkCloudflareComplete(0, 90);
                            } else {
                              // No Cloudflare, proceed with normal success checking
                              startSuccessChecking();
                            }
                          }, 2000); // Initial 2 second delay before checking for Cloudflare/success
                          
                          // If no terms checkbox, proceed with submit immediately
                          console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON ===');
                          console.log('[Luma Auto Register] Button text: "' + submitBtn.textContent + '"');
                          console.log('[Luma Auto Register] Button aria-label: "' + (submitBtn.getAttribute('aria-label') || 'none') + '"');
                          console.log('[Luma Auto Register] Button type: ' + (submitBtn.type || 'none'));
                          
                          // Mark form as submitted to prevent re-scanning from interfering
                          if (typeof window !== 'undefined') {
                            window.__lumaFormSubmitted = true;
                          }
                          
                          // Try multiple click methods to ensure it works
                          submitBtn.click();
                          submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                          submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                          
                          console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                          
                          // Wait for submission to process
                          setTimeout(function() {
                            // Function to perform the actual success checking (defined first so it can be called)
                            function startSuccessCheckBlock2() {
                              console.log('[Luma Auto Register] === CHECKING REGISTRATION RESULT ===');
                              var bodyText = document.body.textContent || '';
                              
                              // Helper to normalize text (handle curly quotes, case, etc.)
                              var normalizeText = function(str) {
                              return (str || '')
                                .toLowerCase()
                                .replace(/[\u2018\u2019\u201B]/g, "'"); // map curly apostrophes to '
                            };
                            
                            // STRICT MODE: Check for validation errors first - these mean DEFINITE failure
                            var validationErrors = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="invalid"], [class*="Invalid"], [aria-invalid="true"]');
                            var hasValidationErrors = false;
                            var missingFields = [];
                            var errorText = '';
                            
                            // Check for red borders on inputs
                            var allInputs = document.querySelectorAll('input, [role="combobox"], [role="listbox"], textarea');
                            var inputsWithErrors = 0;
                            for (var inp = 0; inp < allInputs.length; inp++) {
                              var inpEl = allInputs[inp];
                              if (!inpEl.offsetParent || inpEl.disabled) continue;
                              
                              var style = window.getComputedStyle(inpEl);
                              var borderColor = style.borderColor || '';
                              var borderWidth = parseFloat(style.borderWidth) || 0;
                              
                              if (borderWidth > 0) {
                                if (borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                    borderColor.indexOf('rgb(220, 38, 38)') > -1 ||
                                    borderColor.indexOf('#ef4444') > -1 ||
                                    borderColor.toLowerCase().indexOf('red') > -1) {
                                  hasValidationErrors = true;
                                  inputsWithErrors++;
                                  var label = '';
                                  var labelEl = inpEl.closest('label') || 
                                              inpEl.previousElementSibling ||
                                              document.querySelector('label[for="' + (inpEl.id || '') + '"]');
                                  if (labelEl) {
                                    label = labelEl.textContent.trim();
                                  }
                                  if (label) {
                                    missingFields.push(label);
                                  }
                                }
                              }
                              
                              if (inpEl.getAttribute('aria-invalid') === 'true') {
                                hasValidationErrors = true;
                                inputsWithErrors++;
                              }
                            }
                            
                            // Check for visible error messages
                            for (var ve = 0; ve < validationErrors.length; ve++) {
                              var errorEl = validationErrors[ve];
                              if (errorEl.offsetParent !== null) {
                                var errorTextContent = (errorEl.textContent || '').toLowerCase();
                                if (errorTextContent.indexOf('required') > -1 || 
                                    errorTextContent.indexOf('field is required') > -1 ||
                                    errorTextContent.indexOf('this field is required') > -1 ||
                                    errorTextContent.length > 0 && errorTextContent.length < 100) {
                                  hasValidationErrors = true;
                                  errorText += ' ' + errorTextContent;
                                }
                              }
                            }
                            
                            // Check if submit button is still visible (form didn't submit)
                            var submitButtonStillVisible = document.querySelector('button[type="submit"]:not([disabled]), button:not([type]):not([disabled])');
                            var submitButtonText = submitButtonStillVisible ? (submitButtonStillVisible.textContent || '').toLowerCase() : '';
                            var isSubmitButtonStillThere = submitButtonStillVisible && 
                                                          submitButtonStillVisible.offsetParent !== null &&
                                                          (submitButtonText.indexOf('request to join') > -1 || 
                                                           submitButtonText.indexOf('submit') > -1 ||
                                                           submitButtonText.indexOf('register') > -1 ||
                                                           submitButtonText.indexOf('join') > -1 ||
                                                           submitButtonText.indexOf('rsvp') > -1);
                            
                            // Check for failure indicators
                            var bodyTextLower = normalizeText(bodyText);
                            var failureIndicators = bodyTextLower.indexOf('registration failed') > -1 ||
                                                  bodyTextLower.indexOf('unable to register') > -1 ||
                                                  bodyTextLower.indexOf('could not register') > -1 ||
                                                  bodyTextLower.indexOf('error occurred') > -1 ||
                                                  bodyTextLower.indexOf('something went wrong') > -1;
                            
                            // STRICT: If form is still visible or has errors, DEFINITELY failed
                            if (hasValidationErrors || isSubmitButtonStillThere || failureIndicators) {
                              console.log('[Luma Auto Register] ✗✗✗ REGISTRATION FAILED');
                              
                              // Create user-friendly error message
                              var userFriendlyMessage = '';
                              var technicalDetails = [];
                              
                              if (hasValidationErrors) {
                                var missingFieldsList = missingFields.length > 0 ? missingFields.join(', ') : 'unknown fields';
                                userFriendlyMessage = 'Registration failed: Some required fields could not be filled automatically. ';
                                userFriendlyMessage += 'Missing or invalid: ' + missingFieldsList + '. ';
                                userFriendlyMessage += 'Please check your settings or register manually.';
                                technicalDetails.push('Validation errors: ' + missingFieldsList + ' (inputs with errors: ' + inputsWithErrors + ')');
                                console.log('[Luma Auto Register] Validation errors detected! Missing fields: ' + missingFieldsList + ' (inputs with errors: ' + inputsWithErrors + ')');
                              }
                              
                              if (isSubmitButtonStillThere) {
                                if (!userFriendlyMessage) {
                                  userFriendlyMessage = 'Registration failed: The form could not be submitted. ';
                                  userFriendlyMessage += 'This might be because the form requires manual review or has additional steps.';
                                }
                                technicalDetails.push('Submit button still visible');
                                console.log('[Luma Auto Register] Submit button still visible');
                              }
                              
                              if (failureIndicators) {
                                if (!userFriendlyMessage) {
                                  userFriendlyMessage = 'Registration failed: The event registration encountered an error. ';
                                  userFriendlyMessage += 'This could be due to event capacity, network issues, or form validation problems.';
                                }
                                technicalDetails.push('Failure indicators found in page content');
                                console.log('[Luma Auto Register] Failure indicators found');
                              }
                              
                              // Remove overlay when registration fails
                              try {
                                var overlay = document.getElementById('__lumaAutoRegisterOverlay');
                                if (overlay && overlay.parentNode) {
                                  overlay.parentNode.removeChild(overlay);
                                }
                              } catch (e) {}
                              
                              resolve({ 
                                success: false,
                                message: userFriendlyMessage,
                                details: technicalDetails.join('; '),
                                hasValidationErrors: hasValidationErrors,
                                missingFields: missingFields
                              });
                              return;
                            }
                            
                            if (hasValidationErrors) {
                              console.log('[Luma Auto Register] ⚠️ Validation errors detected! Missing fields: ' + missingFields.join(', '));
                            }
                            
                            // Check for success keywords - STRICT MODE
                            var successKeywords = [
                              "you're going",
                              "you're registered",
                              "you're in",
                              "youre in",
                              "you are in",
                              "you are registered",
                              "already registered",
                              "pending approval",
                              "registration confirmed",
                              "registration successful",
                              "successfully registered",
                              "you're on the waitlist",
                              "youre on the waitlist",
                              "on the waitlist",
                              "we will let you know when the host approves",
                              "thank you for joining",
                              "thanks for joining"
                            ];
                            
                            var successKeywordCount = 0;
                            var foundSuccessKeywords = [];
                            for (var sk = 0; sk < successKeywords.length; sk++) {
                              if (bodyTextLower.indexOf(successKeywords[sk]) > -1) {
                                successKeywordCount++;
                                foundSuccessKeywords.push(successKeywords[sk]);
                              }
                            }
                            
                            var success = successKeywordCount > 0;
                            
                            // Fallback: trust network success flag ONLY if we have success keywords
                            if (!success && typeof window !== 'undefined' && window.__lumaAutoRegisterNetworkSuccessFlag) {
                              // Even with network flag, require at least one success keyword
                              if (successKeywordCount > 0) {
                                console.log('[Luma Auto Register] ✓ Success inferred from network response + success keywords (standard submit)');
                                success = true;
                              } else {
                                console.log('[Luma Auto Register] Network flag present but no success keywords found - not marking as success');
                              }
                            }
                            
                            if (success && successKeywordCount > 0) {
                              console.log('[Luma Auto Register] ✓✓✓ REGISTRATION CONFIRMED!');
                              console.log('[Luma Auto Register] Success keywords found: ' + foundSuccessKeywords.join(', '));
                              
                              // Remove overlay when registration succeeds
                              try {
                                var overlay = document.getElementById('__lumaAutoRegisterOverlay');
                                if (overlay && overlay.parentNode) {
                                  overlay.parentNode.removeChild(overlay);
                                }
                              } catch (e) {}
                              
                              resolve({ 
                                success: true,
                                message: 'Registered successfully'
                              });
                            } else {
                              console.log('[Luma Auto Register] ✗✗✗ COULD NOT CONFIRM REGISTRATION (first check)');
                              console.log('[Luma Auto Register] Success keyword count: ' + successKeywordCount);
                              console.log('[Luma Auto Register] Page text sample: ' + bodyText.substring(0, 200));
                              
                              // Try checking again after a longer delay (page might still be updating)
                              setTimeout(function() {
                                var bodyText2 = document.body.textContent || '';
                                var bodyTextLower2 = normalizeText(bodyText2);
                                
                                // Re-check for errors and form visibility
                                var hasValidationErrors2 = document.querySelectorAll('[class*="error"]:not([style*="display: none"]), [aria-invalid="true"]').length > 0;
                                var submitButtonStillVisible2 = document.querySelector('button[type="submit"]:not([disabled])');
                                var isSubmitButtonStillThere2 = submitButtonStillVisible2 && submitButtonStillVisible2.offsetParent !== null;
                                
                                if (hasValidationErrors2 || isSubmitButtonStillThere2) {
                                  console.log('[Luma Auto Register] ✗✗✗ REGISTRATION FAILED (second check)');
                                  resolve({ 
                                    success: false,
                                    message: 'Registration failed - validation errors or form still visible'
                                  });
                                  return;
                                }
                                
                                var successKeywordCount2 = 0;
                                var foundSuccessKeywords2 = [];
                                for (var sk = 0; sk < successKeywords.length; sk++) {
                                  if (bodyTextLower2.indexOf(successKeywords[sk]) > -1) {
                                    successKeywordCount2++;
                                    foundSuccessKeywords2.push(successKeywords[sk]);
                                  }
                                }
                                
                                var success2 = successKeywordCount2 > 0;
                                
                                // Fallback again to network success flag on the second check, but only with keywords
                                if (!success2 && typeof window !== 'undefined' && window.__lumaAutoRegisterNetworkSuccessFlag) {
                                  if (successKeywordCount2 > 0) {
                                    console.log('[Luma Auto Register] ✓ Success inferred from network response + success keywords (standard submit - second check)');
                                    success2 = true;
                                  }
                                }
                                
                                if (success2 && successKeywordCount2 > 0) {
                                  console.log('[Luma Auto Register] ✓✓✓ REGISTRATION CONFIRMED! (second check)');
                                  console.log('[Luma Auto Register] Success keywords found: ' + foundSuccessKeywords2.join(', '));
                                  
                                  // Remove overlay when registration succeeds
                                  try {
                                    var overlay = document.getElementById('__lumaAutoRegisterOverlay');
                                    if (overlay && overlay.parentNode) {
                                      overlay.parentNode.removeChild(overlay);
                                    }
                                  } catch (e) {}
                                  
                                  resolve({ 
                                    success: true,
                                    message: 'Registered successfully'
                                  });
                                } else {
                                  console.log('[Luma Auto Register] ✗✗✗ COULD NOT CONFIRM REGISTRATION (second check)');
                                  console.log('[Luma Auto Register] Success keyword count: ' + successKeywordCount2);
                                  console.log('[Luma Auto Register] Page text sample: ' + bodyText2.substring(0, 200));
                                  
                                  // Remove overlay when registration cannot be confirmed
                                  try {
                                    var overlay = document.getElementById('__lumaAutoRegisterOverlay');
                                    if (overlay && overlay.parentNode) {
                                      overlay.parentNode.removeChild(overlay);
                                    }
                                  } catch (e) {}
                                  
                                  resolve({ 
                                    success: false, 
                                    message: 'Could not confirm registration - please check manually'
                                  });
                                }
                              }, 3000); // Additional 3 second check
                            }
                            } // End of startSuccessCheckBlock2 function
                            
                            // First check if Cloudflare is present - if so, wait for it to complete before checking success
                            var bodyTextCheck = (document.body.textContent || '').toLowerCase();
                            var bodyHTMLCheck = (document.body.innerHTML || '').toLowerCase();
                            var hasCloudflareCheck = bodyTextCheck.indexOf('verifying your browser') > -1 ||
                                                   bodyTextCheck.indexOf("we're doing a quick check") > -1 ||
                                                   bodyTextCheck.indexOf('verifying...') > -1 ||
                                                   bodyTextCheck.indexOf('cloudflare') > -1 ||
                                                   bodyHTMLCheck.indexOf('cf-browser-verification') > -1 ||
                                                   bodyHTMLCheck.indexOf('challenge-platform') > -1 ||
                                                   document.querySelector('[id*="cf-"], [class*="cf-"], [id*="challenge"], [class*="challenge"]') !== null;
                            
                            if (hasCloudflareCheck) {
                              console.log('[Luma Auto Register] ⚠️ Cloudflare challenge detected - waiting for it to complete before checking success...');
                              
                              // Poll for Cloudflare completion
                              var checkCloudflareComplete2 = function(attempts, maxAttempts) {
                                attempts = attempts || 0;
                                maxAttempts = maxAttempts || 90; // Wait up to 45 seconds (90 attempts * 500ms)
                                
                                var bodyText2 = (document.body.textContent || '').toLowerCase();
                                var bodyHTML2 = (document.body.innerHTML || '').toLowerCase();
                                var stillHasCloudflare = bodyText2.indexOf('verifying your browser') > -1 ||
                                                         bodyText2.indexOf("we're doing a quick check") > -1 ||
                                                         bodyText2.indexOf('verifying...') > -1 ||
                                                         bodyHTML2.indexOf('cf-browser-verification') > -1 ||
                                                         bodyHTML2.indexOf('challenge-platform') > -1 ||
                                                         document.querySelector('[id*="cf-"], [class*="cf-"], [id*="challenge"], [class*="challenge"]') !== null;
                                
                                if (!stillHasCloudflare || attempts >= maxAttempts) {
                                  if (!stillHasCloudflare) {
                                    console.log('[Luma Auto Register] ✓ Cloudflare challenge completed (after ' + attempts + ' checks)!');
                                  } else {
                                    console.log('[Luma Auto Register] ⚠️ Cloudflare challenge still present after ' + maxAttempts + ' checks, proceeding with success check anyway...');
                                  }
                                  
                                  // Cloudflare completed (or timed out) - wait additional delay before checking success
                                  // This gives time for the success message to appear after Cloudflare completes
                                  console.log('[Luma Auto Register] Waiting 3 seconds after Cloudflare completion before checking success...');
                                  setTimeout(function() {
                                    startSuccessCheckBlock2();
                                  }, 3000);
                                } else {
                                  // Still waiting for Cloudflare
                                  setTimeout(function() {
                                    checkCloudflareComplete2(attempts + 1, maxAttempts);
                                  }, 500);
                                }
                              };
                              
                              // Start checking for Cloudflare completion
                              checkCloudflareComplete2(0, 90);
                            } else {
                              // No Cloudflare, proceed with normal success checking
                              startSuccessCheckBlock2();
                            }
                          }, 4000); // Wait 4 seconds for submission to complete
                          
                          // Form submitted, exit processCustomDropdown early - don't process more dropdowns
                          return;
                    
                    var dropdownInfo = customDropdownsToProcess[index];
                    var dropdown = dropdownInfo.element;
                    var isMultiSelect = dropdownInfo.isMultiSelect || false;
                    var labelKey = (dropdownInfo.label || '').toLowerCase();
                    
                    // Skip duplicate logical questions (same label) to avoid repeatedly
                    // opening the same "Which one are you?" dropdown several times.
                    if (labelKey && processedDropdownLabels[labelKey]) {
                      console.log('[Luma Auto Register] Skipping duplicate custom dropdown for label: ' + labelKey);
                      processCustomDropdown(index + 1);
                      return;
                    }
                    if (labelKey) {
                      processedDropdownLabels[labelKey] = true;
                    }
                    
                    console.log('[Luma Auto Register] Processing custom dropdown ' + (index + 1) + '/' + customDropdownsToProcess.length + ': ' + dropdownInfo.label + (isMultiSelect ? ' (multi-select)' : ''));
                    
                    try {
                      // Click to open dropdown - try clicking the input or its parent container
                      var clickTarget = dropdown;
                      
                      // For Luma dropdowns, might need to click parent container
                      var parentClickable = dropdown.closest('[role="combobox"], [class*="select"], [class*="Select"], [class*="dropdown"]');
                      if (parentClickable) {
                        clickTarget = parentClickable;
                      }
                      
                      clickTarget.click();
                      console.log('[Luma Auto Register] Clicked to open dropdown');
                      
                      // Helper function to process menu options (can be called multiple times if needed)
                      // Define it here so it can be called from setTimeout
                      var processMenuOptions = function(menuWrapper) {
                        
                        // Find dropdown menu options - look for clickable items inside the menu
                        // Try to find options with role="option" first (most reliable)
                        var menuOptions = menuWrapper.querySelectorAll('[role="option"]:not([aria-disabled="true"])');
                        console.log('[Luma Auto Register] Found ' + menuOptions.length + ' options with role="option"');
                        
                        // If no role="option" found, look for Luma-specific menu items
                        if (menuOptions.length === 0) {
                          menuOptions = menuWrapper.querySelectorAll('[class*="lux-menu-item"]:not([aria-disabled="true"])');
                          console.log('[Luma Auto Register] Found ' + menuOptions.length + ' options with lux-menu-item class');
                        }
                        
                        // If still no options, look for other patterns
                        if (menuOptions.length === 0) {
                          menuOptions = menuWrapper.querySelectorAll(
                            '[role="menuitem"]:not([aria-disabled="true"]), ' +
                            'button:not([disabled]), ' +
                            'div[class*="option"]:not([disabled]), ' +
                            'div[class*="Option"]:not([disabled]), ' +
                            'li:not([disabled])'
                          );
                          console.log('[Luma Auto Register] Found ' + menuOptions.length + ' options with alternative selectors');
                        }
                        
                        // If still no options, look for ANY clickable/selectable elements
                        if (menuOptions.length === 0) {
                          console.log('[Luma Auto Register] No options found with standard selectors, trying broader search...');
                          // Look for any elements that might be options
                          var allElements = menuWrapper.querySelectorAll('div, li, button, span, a');
                          var candidateOptions = Array.from(allElements).filter(function(el) {
                            var text = (el.textContent || el.innerText || '').trim();
                            // Must be visible and have some text
                            return el.offsetParent !== null &&
                                   text.length > 0 && 
                                   text.length < 100 &&
                                   !text.match(/^(select|choose|search|--|this field)/i) &&
                                   !text.match(/required/i);
                          });
                          
                          console.log('[Luma Auto Register] Found ' + candidateOptions.length + ' candidate elements');
                          
                          // Log first few candidates for debugging
                          if (candidateOptions.length > 0) {
                            console.log('[Luma Auto Register] Candidate options (first 5):');
                            for (var cand = 0; cand < Math.min(5, candidateOptions.length); cand++) {
                              var candEl = candidateOptions[cand];
                              var candText = (candEl.textContent || '').trim();
                              console.log('[Luma Auto Register]   - ' + candEl.tagName + ' (' + (candEl.className || 'no class') + '): "' + candText.substring(0, 30) + '"');
                            }
                          }
                          
                          // Filter candidates more carefully before using them
                          // Prioritize elements with menu-item classes
                          var filteredCandidates = candidateOptions.filter(function(el) {
                            var text = (el.textContent || el.innerText || '').trim();
                            var className = (el.className || '').toLowerCase();
                            
                            // Skip if empty or too short
                            if (!text || text.length < 2) return false;
                            
                            // Prefer elements with menu-item related classes
                            var hasMenuItemClass = className.indexOf('menu-item') > -1 || 
                                                   className.indexOf('option') > -1 ||
                                                   className.indexOf('select-option') > -1;
                            
                            // If it has a menu-item class, be more lenient with text length
                            var maxLength = hasMenuItemClass ? 100 : 50;
                            if (text.length > maxLength) return false;
                            
                            // Skip placeholder text
                            if (text.match(/^(select|choose|search|--|this field|required)/i)) return false;
                            
                            // Skip if it contains multiple sentences (unless it's a menu-item)
                            if (!hasMenuItemClass && text.split('.').length > 2) return false;
                            
                            // Skip if it has multiple lines (unless it's a menu-item)
                            var lines = text.split('\n').filter(function(l) { return l.trim().length > 0; });
                            if (!hasMenuItemClass && lines.length > 2) return false;
                            
                            // Skip malformed combined options (like "Yes!Not yet" or "Growth StartupMature Startup")
                            // Check if text looks like multiple options concatenated
                            if (text.match(/^[A-Z][a-z]+![A-Z]/)) return false;
                            // Check for concatenated options without spaces (e.g., "Growth StartupMature Startup")
                            if (text.match(/[a-z][A-Z][a-z]/) && !hasMenuItemClass) {
                              // This might be concatenated, but if it's a menu-item, it's probably fine
                              // Check if it's clearly multiple words concatenated
                              var hasMultipleWords = text.split(/([A-Z][a-z]+)/).filter(function(w) { return w.trim().length > 0; }).length > 3;
                              if (hasMultipleWords && !hasMenuItemClass) return false;
                            }
                            
                            // Must be visible
                            if (!el.offsetParent) return false;
                            
                            return true;
                          });
                          
                          // Sort to prioritize menu-item elements
                          filteredCandidates.sort(function(a, b) {
                            var aClass = (a.className || '').toLowerCase();
                            var bClass = (b.className || '').toLowerCase();
                            var aIsMenuItem = aClass.indexOf('menu-item') > -1;
                            var bIsMenuItem = bClass.indexOf('menu-item') > -1;
                            if (aIsMenuItem && !bIsMenuItem) return -1;
                            if (!aIsMenuItem && bIsMenuItem) return 1;
                            return 0;
                          });
                          
                          console.log('[Luma Auto Register] Filtered to ' + filteredCandidates.length + ' valid candidates');
                          
                          // Use filtered candidates (remove the <= 15 limit)
                          if (filteredCandidates.length > 0) {
                            menuOptions = filteredCandidates;
                          }
                        }
                        
                        // Filter out non-option elements more aggressively
                        var filteredOptions = [];
                        for (var f = 0; f < menuOptions.length; f++) {
                          var opt = menuOptions[f];
                          var optText = (opt.textContent || opt.innerText || '').trim();
                          
                          // Skip if empty or too short
                          if (!optText || optText.length < 2) continue;
                          
                          // Skip if it's too long (likely a container or description)
                          if (optText.length > 50) continue;
                          
                          // Skip placeholder/error text
                          if (optText.match(/^(select|choose|search|--|this field|required)/i)) continue;
                          
                          // Skip if it contains multiple sentences (likely description)
                          if (optText.split('.').length > 2) continue;
                          
                          // Skip if it's clearly not an option (has multiple lines)
                          var lines = optText.split('\n').filter(function(l) { return l.trim().length > 0; });
                          if (lines.length > 2) continue;
                          
                          // Skip malformed combined options (like "Yes!Not yet")
                          if (optText.match(/^[A-Z][a-z]+![A-Z]/)) continue;
                          
                          // Must be visible and clickable
                          if (!opt.offsetParent) continue;
                          
                          filteredOptions.push(opt);
                        }
                        menuOptions = filteredOptions;
                        
                        console.log('[Luma Auto Register] Found ' + menuOptions.length + ' dropdown options');
                        
                        var selectedOption = null;
                        var placeholderPattern = /^(select|choose|search|--|please select|select one|pick one|choose one|none|^$)/i;
                        
                        // Check if this is a Yes/No dropdown
                        var isYesNoDropdown = dropdownInfo.label.indexOf('are you') > -1 || 
                                             dropdownInfo.label.indexOf('do you') > -1 ||
                                             dropdownInfo.label.indexOf('have you') > -1 ||
                                             dropdownInfo.label.indexOf('will you') > -1 ||
                                             dropdownInfo.label.indexOf('is this') > -1 ||
                                             dropdownInfo.label.indexOf('can you') > -1;
                        
                        // Check if this is a multi-select dropdown with only Yes/No options (2-3 options total)
                        // For these, we should just select the first option (usually "Yes")
                        var isSimpleYesNoMultiSelect = isMultiSelect && menuOptions.length >= 2 && menuOptions.length <= 3;
                        if (isSimpleYesNoMultiSelect) {
                          // Check if options look like Yes/No
                          var hasYes = false;
                          var hasNo = false;
                          for (var check = 0; check < menuOptions.length; check++) {
                            var checkText = (menuOptions[check].textContent || menuOptions[check].innerText || '').trim().toLowerCase();
                            if (checkText === 'yes' || checkText === 'yes!' || checkText.indexOf('yes') === 0) {
                              hasYes = true;
                            }
                            if (checkText === 'no' || checkText === 'not yet' || checkText.indexOf('no') === 0 || checkText.indexOf('not') === 0) {
                              hasNo = true;
                            }
                          }
                          if (hasYes || hasNo) {
                            isSimpleYesNoMultiSelect = true;
                            console.log('[Luma Auto Register] Detected simple Yes/No multi-select dropdown (only ' + menuOptions.length + ' options)');
                          } else {
                            isSimpleYesNoMultiSelect = false;
                          }
                        }
                        
                        console.log('[Luma Auto Register] Filtered to ' + menuOptions.length + ' valid options');
                        
                        // For simple Yes/No multi-select dropdowns (2-3 options), just select the first option
                        if (isSimpleYesNoMultiSelect && menuOptions.length > 0) {
                          selectedOption = menuOptions[0];
                          var optText = (selectedOption.textContent || selectedOption.innerText || '').trim();
                          console.log('[Luma Auto Register] Selecting first option for simple Yes/No multi-select: "' + optText + '"');
                        }
                        // For Yes/No dropdowns, prefer "Yes" over "No"
                        else if (isYesNoDropdown) {
                          console.log('[Luma Auto Register] Detected Yes/No dropdown, looking for "Yes" option');
                          
                          // First, try to find exact "Yes" or "Yes!" match
                          for (var o = 0; o < menuOptions.length; o++) {
                            var opt = menuOptions[o];
                            var optText = (opt.textContent || opt.innerText || '').trim();
                            var optTextLower = optText.toLowerCase();
                            
                            // Look for "Yes" or "Yes!" (exact match or starts with "yes")
                            if (optTextLower === 'yes' || optTextLower === 'yes!' ||
                                optTextLower.indexOf('yes') === 0) {
                              selectedOption = opt;
                              console.log('[Luma Auto Register] ✓ Found "Yes" option: "' + optText + '"');
                              break;
                            }
                          }
                          
                          // If no "Yes" found, look for "No" or "Not yet"
                          if (!selectedOption) {
                            for (var o = 0; o < menuOptions.length; o++) {
                              var opt = menuOptions[o];
                              var optText = (opt.textContent || opt.innerText || '').trim();
                              var optTextLower = optText.toLowerCase();
                              
                              if (optTextLower === 'no' || optTextLower === 'not yet' ||
                                  optTextLower.indexOf('no') === 0 || optTextLower.indexOf('not') === 0) {
                                selectedOption = opt;
                                console.log('[Luma Auto Register] ✓ Found "No" option: "' + optText + '"');
                                break;
                              }
                            }
                          }
                        }
                        
                        // If not Yes/No or no Yes/No option found, try to match against settings first
                        if (!selectedOption) {
                          // Determine which settings to check based on dropdown label
                          var labelLower = dropdownInfo.label.toLowerCase();
                          var settingsToCheck = [];
                          
                          // Check what kind of field this is and which settings might match
                          // Job title/role/position fields - check multiple variations
                          if (labelLower.indexOf('job title') > -1 || labelLower.indexOf('jobtitle') > -1 ||
                              labelLower.indexOf('title') > -1 || labelLower.indexOf('role') > -1 ||
                              labelLower.indexOf('position') > -1 || labelLower.indexOf('your role') > -1 ||
                              labelLower.indexOf('what is your role') > -1 || labelLower.indexOf('what\'s your role') > -1 ||
                              labelLower.indexOf('occupation') > -1 || labelLower.indexOf('job') > -1) {
                            if (settings.title) settingsToCheck.push(settings.title);
                            if (settings.roleCategory) settingsToCheck.push(settings.roleCategory);
                            // Also check if title contains common job title keywords that might match dropdown options
                            if (settings.title) {
                              var titleLower = settings.title.toLowerCase();
                              // Extract key words from title for better matching
                              var titleWords = titleLower.split(/\s+/);
                              for (var tw = 0; tw < titleWords.length; tw++) {
                                if (titleWords[tw].length > 2) {
                                  settingsToCheck.push(titleWords[tw]);
                                }
                              }
                            }
                          }
                          
                          if (labelLower.indexOf('industry') > -1 || labelLower.indexOf('sector') > -1) {
                            if (settings.industryCategory) settingsToCheck.push(settings.industryCategory);
                          }
                          
                          if (labelLower.indexOf('experience') > -1 || labelLower.indexOf('level') > -1) {
                            if (settings.experienceLevel) settingsToCheck.push(settings.experienceLevel);
                          }
                          
                          if (labelLower.indexOf('organization') > -1 || labelLower.indexOf('company type') > -1) {
                            if (settings.company) settingsToCheck.push(settings.company);
                          }
                          
                          // Check for country fields (country, country of residence, etc.)
                          if (labelLower.indexOf('country') > -1) {
                            if (settings.country) {
                              // Map country codes to full country names for better matching
                              var countryCode = settings.country.toUpperCase();
                              var countryMap = {
                                'US': 'United States',
                                'USA': 'United States',
                                'CA': 'Canada',
                                'UK': 'United Kingdom',
                                'GB': 'United Kingdom',
                                'DE': 'Germany',
                                'FR': 'France',
                                'IT': 'Italy',
                                'ES': 'Spain',
                                'NL': 'Netherlands',
                                'BE': 'Belgium',
                                'CH': 'Switzerland',
                                'AT': 'Austria',
                                'SE': 'Sweden',
                                'NO': 'Norway',
                                'DK': 'Denmark',
                                'FI': 'Finland',
                                'PL': 'Poland',
                                'AU': 'Australia',
                                'NZ': 'New Zealand',
                                'JP': 'Japan',
                                'CN': 'China',
                                'IN': 'India',
                                'BR': 'Brazil',
                                'MX': 'Mexico',
                                'AR': 'Argentina',
                                'ZA': 'South Africa',
                                'IE': 'Ireland',
                                'PT': 'Portugal',
                                'GR': 'Greece',
                                'TR': 'Turkey',
                                'RU': 'Russia',
                                'KR': 'South Korea',
                                'SG': 'Singapore',
                                'HK': 'Hong Kong',
                                'TW': 'Taiwan',
                                'TH': 'Thailand',
                                'VN': 'Vietnam',
                                'PH': 'Philippines',
                                'ID': 'Indonesia',
                                'MY': 'Malaysia'
                              };
                              
                              // For country fields, prioritize full country name matches
                              // Add the full country name FIRST (highest priority)
                              if (countryMap[countryCode]) {
                                settingsToCheck.push(countryMap[countryCode]);
                              }
                              
                              // Also add common variations
                              if (countryCode === 'US' || countryCode === 'USA') {
                                settingsToCheck.push('America', 'USA', 'U.S.', 'U.S.A.');
                              } else if (countryCode === 'UK' || countryCode === 'GB') {
                                settingsToCheck.push('Britain', 'Great Britain', 'England');
                              }
                              
                              // Store country code separately for special matching logic
                              // We'll handle country code matching separately to avoid false positives
                              window.__lumaCountryCode = countryCode;
                            }
                          }
                          
                          // Check for company stage or fund stage fields
                          if (labelLower.indexOf('stage') > -1 || labelLower.indexOf('fund') > -1 || 
                              labelLower.indexOf('investment') > -1 || labelLower.indexOf('round') > -1) {
                            // Try to match against common stage values
                            // Check if any settings might contain stage info
                            if (settings.company) settingsToCheck.push(settings.company);
                            if (settings.bio) {
                              // Extract potential stage info from bio
                              var bioLower = (settings.bio || '').toLowerCase();
                              if (bioLower.indexOf('seed') > -1) settingsToCheck.push('seed');
                              if (bioLower.indexOf('series a') > -1) settingsToCheck.push('series a');
                              if (bioLower.indexOf('series b') > -1) settingsToCheck.push('series b');
                              if (bioLower.indexOf('pre-seed') > -1) settingsToCheck.push('pre-seed');
                            }
                          }
                          
                          // Try to match options against settings
                          var matchedOption = null;
                          for (var o = 0; o < menuOptions.length && !matchedOption; o++) {
                            var opt = menuOptions[o];
                            var optText = (opt.textContent || opt.innerText || '').trim();
                            
                            // Skip placeholder options
                            if (!optText || optText.match(placeholderPattern)) {
                              continue;
                            }
                            
                            var optTextLower = optText.toLowerCase();
                            
                            // Check if option matches any setting
                            for (var s = 0; s < settingsToCheck.length; s++) {
                              var settingValue = (settingsToCheck[s] || '').toLowerCase().trim();
                              if (settingValue) {
                                var isCountryField = labelLower.indexOf('country') > -1;
                                var isCountryCode = isCountryField && settingValue.length === 2;
                                
                                // For country fields with codes, use strict matching to avoid false positives
                                if (isCountryCode) {
                                  // Only match country codes if:
                                  // 1. Exact match (case-insensitive)
                                  // 2. Option starts with code followed by space/dash (e.g., "CA - Canada")
                                  // 3. Option is exactly the code
                                  var codeMatch = optTextLower === settingValue ||
                                                 optTextLower.indexOf(settingValue + ' ') === 0 ||
                                                 optTextLower.indexOf(settingValue + '-') === 0 ||
                                                 optTextLower.indexOf(settingValue + '(') === 0;
                                  
                                  if (codeMatch) {
                                  matchedOption = opt;
                                    console.log('[Luma Auto Register] ✓ Matched option "' + optText + '" to country code: "' + settingsToCheck[s] + '"');
                                  break;
                                }
                                } else if (settingValue.length > 2) {
                                  // For full country names and other settings, use normal matching
                                  // But prioritize exact matches first, then fuzzy matching
                                  var exactMatch = optTextLower === settingValue;
                                  var containsMatch = optTextLower.indexOf(settingValue) > -1 || 
                                                      settingValue.indexOf(optTextLower) > -1;
                                  
                                  // For job titles, also check for common abbreviations and variations
                                  var isJobTitleField = labelLower.indexOf('job title') > -1 || 
                                                       labelLower.indexOf('role') > -1 ||
                                                       labelLower.indexOf('position') > -1;
                                  var fuzzyMatch = false;
                                  
                                  if (isJobTitleField) {
                                    // Common job title mappings (e.g., "CEO" matches "Chief Executive Officer")
                                    var titleMappings = {
                                      'ceo': ['chief executive officer', 'executive officer', 'chief executive'],
                                      'cto': ['chief technology officer', 'technology officer', 'tech officer'],
                                      'cfo': ['chief financial officer', 'financial officer'],
                                      'cmo': ['chief marketing officer', 'marketing officer'],
                                      'coo': ['chief operating officer', 'operating officer'],
                                      'president': ['pres', 'president'],
                                      'founder': ['founder', 'co-founder', 'cofounder'],
                                      'director': ['dir', 'director'],
                                      'manager': ['mgr', 'manager', 'management'],
                                      'engineer': ['eng', 'engineer', 'engineering'],
                                      'developer': ['dev', 'developer', 'development'],
                                      'designer': ['design', 'designer'],
                                      'analyst': ['analyst', 'analysis'],
                                      'consultant': ['consultant', 'consulting'],
                                      'investor': ['investor', 'investment', 'vc', 'venture capital'],
                                      'advisor': ['advisor', 'adviser', 'advisory']
                                    };
                                    
                                    // Industry/experience level mappings
                                    var industryMappings = {
                                      'tech': ['technology', 'technological', 'tech industry', 'it', 'information technology'],
                                      'technology': ['tech', 'it', 'information technology'],
                                      'finance': ['financial', 'fintech', 'banking'],
                                      'healthcare': ['health', 'medical', 'health care'],
                                      'beginner': ['entry level', 'entry-level', 'junior', 'starting', 'new'],
                                      'entry level': ['beginner', 'junior', 'starting', 'new'],
                                      'intermediate': ['mid-level', 'mid level', 'experienced', 'some experience'],
                                      'advanced': ['senior', 'expert', 'professional', 'experienced'],
                                      'senior': ['advanced', 'expert', 'professional', 'experienced']
                                    };
                                    
                                    // Check industry/experience mappings if applicable
                                    var isIndustryField = labelLower.indexOf('industry') > -1 || labelLower.indexOf('sector') > -1;
                                    var isExperienceField = labelLower.indexOf('experience') > -1 || labelLower.indexOf('level') > -1;
                                    
                                    if (isIndustryField || isExperienceField) {
                                      for (var imKey in industryMappings) {
                                        if (settingValue.indexOf(imKey) > -1 || imKey.indexOf(settingValue) > -1) {
                                          for (var im = 0; im < industryMappings[imKey].length; im++) {
                                            if (optTextLower.indexOf(industryMappings[imKey][im]) > -1) {
                                              fuzzyMatch = true;
                                              break;
                                            }
                                          }
                                          if (fuzzyMatch) break;
                                        }
                                      }
                                      
                                      // Also check reverse
                                      for (var imKey in industryMappings) {
                                        if (optTextLower.indexOf(imKey) > -1) {
                                          for (var im = 0; im < industryMappings[imKey].length; im++) {
                                            if (settingValue.indexOf(industryMappings[imKey][im]) > -1) {
                                              fuzzyMatch = true;
                                              break;
                                            }
                                          }
                                          if (fuzzyMatch) break;
                                        }
                                      }
                                    }
                                    
                                    // Check if setting value matches any key in titleMappings
                                    for (var key in titleMappings) {
                                      if (settingValue.indexOf(key) > -1 || key.indexOf(settingValue) > -1) {
                                        // Check if option contains any of the mapped values
                                        for (var m = 0; m < titleMappings[key].length; m++) {
                                          if (optTextLower.indexOf(titleMappings[key][m]) > -1) {
                                            fuzzyMatch = true;
                                            break;
                                          }
                                        }
                                        if (fuzzyMatch) break;
                                      }
                                    }
                                    
                                    // Also check reverse - if option is a key, check if setting contains mapped values
                                    for (var key in titleMappings) {
                                      if (optTextLower.indexOf(key) > -1) {
                                        for (var m = 0; m < titleMappings[key].length; m++) {
                                          if (settingValue.indexOf(titleMappings[key][m]) > -1) {
                                            fuzzyMatch = true;
                                            break;
                                          }
                                        }
                                        if (fuzzyMatch) break;
                                      }
                                    }
                                    
                                    // Also check word-by-word matching for job titles
                                    var settingWords = settingValue.split(/\s+/);
                                    var optWords = optTextLower.split(/\s+/);
                                    var matchingWords = 0;
                                    for (var sw = 0; sw < settingWords.length; sw++) {
                                      for (var ow = 0; ow < optWords.length; ow++) {
                                        if (settingWords[sw].length > 2 && optWords[ow].indexOf(settingWords[sw]) > -1) {
                                          matchingWords++;
                                          break;
                                        }
                                      }
                                    }
                                    // If at least 50% of words match, consider it a match
                                    if (settingWords.length > 0 && matchingWords / settingWords.length >= 0.5) {
                                      fuzzyMatch = true;
                                    }
                                    
                                    // Improved partial word matching - check if significant parts of words match
                                    // This helps with cases like "Software Engineer" matching "Engineer"
                                    if (!fuzzyMatch && settingValue.length > 3) {
                                      // Extract key words (3+ characters) from setting
                                      var keyWords = settingValue.split(/\s+/).filter(function(w) { return w.length >= 3; });
                                      var matchedKeyWords = 0;
                                      for (var kw = 0; kw < keyWords.length; kw++) {
                                        // Check if any word in option contains this key word
                                        for (var ow = 0; ow < optWords.length; ow++) {
                                          if (optWords[ow].indexOf(keyWords[kw]) > -1 || keyWords[kw].indexOf(optWords[ow]) > -1) {
                                            matchedKeyWords++;
                                            break;
                                          }
                                        }
                                      }
                                      // If at least one key word matches, consider it a fuzzy match
                                      if (keyWords.length > 0 && matchedKeyWords > 0) {
                                        fuzzyMatch = true;
                                      }
                                    }
                                  }
                                  
                                  if (exactMatch || containsMatch || fuzzyMatch) {
                                    matchedOption = opt;
                                    var matchType = exactMatch ? 'exact' : (containsMatch ? 'contains' : 'fuzzy');
                                    console.log('[Luma Auto Register] ✓ Matched option "' + optText + '" to setting: "' + settingsToCheck[s] + '" (' + matchType + ' match)');
                                    break;
                                  }
                                }
                              }
                            }
                          }
                          
                          if (matchedOption) {
                            selectedOption = matchedOption;
                          } else {
                            // No match found, select first valid option as fallback
                            for (var o = 0; o < menuOptions.length; o++) {
                              var opt = menuOptions[o];
                              var optText = (opt.textContent || opt.innerText || '').trim();
                              
                              // Skip placeholder options
                              if (!optText || optText.match(placeholderPattern)) {
                                continue;
                              }
                              
                              // Select first valid option
                              selectedOption = opt;
                              if (isMultiSelect) {
                                console.log('[Luma Auto Register] ✓ No settings match found for multi-select dropdown, selecting first option: "' + optText + '"');
                              } else {
                                console.log('[Luma Auto Register] ✓ No settings match found, selecting first valid option: "' + optText + '"');
                              }
                              break;
                            }
                          }
                        }
                        
                        if (selectedOption) {
                          // If we already selected an option for simple Yes/No multi-select, treat it as single-select
                          if (isSimpleYesNoMultiSelect && selectedOption) {
                            console.log('[Luma Auto Register] Simple Yes/No multi-select - treating as single-select, clicking first option');
                            // Treat as single-select and skip the multi-select matching logic below
                            isMultiSelect = false;
                          } else if (isMultiSelect && !isSimpleYesNoMultiSelect) {
                            // For multi-select, try to match options against user settings first
                            console.log('[Luma Auto Register] Multi-select detected - trying to match options to settings');
                            
                            // Determine which settings to check based on dropdown label
                            var labelLower = dropdownInfo.label.toLowerCase();
                            var settingsToCheck = [];
                            
                            // Check what kind of field this is and which settings might match
                            // Job title/role/position fields - check multiple variations
                            if (labelLower.indexOf('describe') > -1 || labelLower.indexOf('role') > -1 || 
                                labelLower.indexOf('job') > -1 || labelLower.indexOf('job title') > -1 ||
                                labelLower.indexOf('jobtitle') > -1 || labelLower.indexOf('title') > -1 ||
                                labelLower.indexOf('position') > -1 || labelLower.indexOf('your role') > -1 ||
                                labelLower.indexOf('what is your role') > -1 || labelLower.indexOf('what\'s your role') > -1 ||
                                labelLower.indexOf('occupation') > -1) {
                              // Role/job-related: check title, roleCategory
                              if (settings.title) settingsToCheck.push(settings.title);
                              if (settings.roleCategory) settingsToCheck.push(settings.roleCategory);
                              // Also check if title contains common job title keywords that might match dropdown options
                              if (settings.title) {
                                var titleLower = settings.title.toLowerCase();
                                // Extract key words from title for better matching
                                var titleWords = titleLower.split(/\s+/);
                                for (var tw = 0; tw < titleWords.length; tw++) {
                                  if (titleWords[tw].length > 2) {
                                    settingsToCheck.push(titleWords[tw]);
                                  }
                                }
                              }
                            }
                            
                            if (labelLower.indexOf('industry') > -1 || labelLower.indexOf('sector') > -1) {
                              // Industry-related: check industryCategory
                              if (settings.industryCategory) settingsToCheck.push(settings.industryCategory);
                            }
                            
                            if (labelLower.indexOf('experience') > -1 || labelLower.indexOf('level') > -1) {
                              // Experience-related: check experienceLevel
                              if (settings.experienceLevel) settingsToCheck.push(settings.experienceLevel);
                            }
                            
                            // Check for country fields (country, country of residence, etc.)
                            if (labelLower.indexOf('country') > -1) {
                              if (settings.country) {
                                // Map country codes to full country names for better matching
                                var countryCode = settings.country.toUpperCase();
                                var countryMap = {
                                  'US': 'United States',
                                  'USA': 'United States',
                                  'CA': 'Canada',
                                  'UK': 'United Kingdom',
                                  'GB': 'United Kingdom',
                                  'DE': 'Germany',
                                  'FR': 'France',
                                  'IT': 'Italy',
                                  'ES': 'Spain',
                                  'NL': 'Netherlands',
                                  'BE': 'Belgium',
                                  'CH': 'Switzerland',
                                  'AT': 'Austria',
                                  'SE': 'Sweden',
                                  'NO': 'Norway',
                                  'DK': 'Denmark',
                                  'FI': 'Finland',
                                  'PL': 'Poland',
                                  'AU': 'Australia',
                                  'NZ': 'New Zealand',
                                  'JP': 'Japan',
                                  'CN': 'China',
                                  'IN': 'India',
                                  'BR': 'Brazil',
                                  'MX': 'Mexico',
                                  'AR': 'Argentina',
                                  'ZA': 'South Africa',
                                  'IE': 'Ireland',
                                  'PT': 'Portugal',
                                  'GR': 'Greece',
                                  'TR': 'Turkey',
                                  'RU': 'Russia',
                                  'KR': 'South Korea',
                                  'SG': 'Singapore',
                                  'HK': 'Hong Kong',
                                  'TW': 'Taiwan',
                                  'TH': 'Thailand',
                                  'VN': 'Vietnam',
                                  'PH': 'Philippines',
                                  'ID': 'Indonesia',
                                  'MY': 'Malaysia'
                                };
                                
                                // For country fields, prioritize full country name matches
                                // Add the full country name FIRST (highest priority)
                                if (countryMap[countryCode]) {
                                  settingsToCheck.push(countryMap[countryCode]);
                                }
                                
                                // Also add common variations
                                if (countryCode === 'US' || countryCode === 'USA') {
                                  settingsToCheck.push('America', 'USA', 'U.S.', 'U.S.A.');
                                } else if (countryCode === 'UK' || countryCode === 'GB') {
                                  settingsToCheck.push('Britain', 'Great Britain', 'England');
                                }
                                
                                // Store country code separately for special matching logic
                                window.__lumaCountryCode = countryCode;
                              }
                            }
                            
                            // Also check interests and bio for general matching
                            if (settings.interests) {
                              var interestWords = settings.interests.split(/[,\s]+/).filter(function(w) { return w.length > 2; });
                              settingsToCheck = settingsToCheck.concat(interestWords);
                            }
                            
                            var optionsToSelect = [];
                            var matchedOptions = [];
                            var unmatchedOptions = [];
                            
                            // First pass: try to match options against settings
                            for (var ms = 0; ms < menuOptions.length; ms++) {
                              var opt = menuOptions[ms];
                              var optText = (opt.textContent || opt.innerText || '').trim();
                              
                              // Skip placeholder options
                              if (!optText || optText.match(placeholderPattern)) {
                                continue;
                              }
                              
                              // Skip if already selected
                              var isAlreadySelected = opt.getAttribute('aria-selected') === 'true' ||
                                                      opt.classList.contains('selected') ||
                                                      opt.querySelector('[class*="check"], [class*="Check"], svg') !== null;
                              
                              if (isAlreadySelected) {
                                continue;
                              }
                              
                              // Try to match against settings
                              var optTextLower = optText.toLowerCase();
                              var matched = false;
                              
                              for (var s = 0; s < settingsToCheck.length; s++) {
                                var settingValue = (settingsToCheck[s] || '').toLowerCase().trim();
                                if (settingValue) {
                                  var isCountryField = labelLower.indexOf('country') > -1;
                                  var isJobTitleField = labelLower.indexOf('job title') > -1 || 
                                                       labelLower.indexOf('role') > -1 ||
                                                       labelLower.indexOf('position') > -1 ||
                                                       labelLower.indexOf('title') > -1;
                                  var isCountryCode = isCountryField && settingValue.length === 2;
                                  
                                  // For country fields with codes, use strict matching to avoid false positives
                                  if (isCountryCode) {
                                    // Only match country codes if:
                                    // 1. Exact match (case-insensitive)
                                    // 2. Option starts with code followed by space/dash (e.g., "CA - Canada")
                                    // 3. Option is exactly the code
                                    var codeMatch = optTextLower === settingValue ||
                                                   optTextLower.indexOf(settingValue + ' ') === 0 ||
                                                   optTextLower.indexOf(settingValue + '-') === 0 ||
                                                   optTextLower.indexOf(settingValue + '(') === 0;
                                    
                                    if (codeMatch) {
                                    matchedOptions.push(opt);
                                    matched = true;
                                      console.log('[Luma Auto Register] ✓ Matched option "' + optText + '" to country code: "' + settingsToCheck[s] + '"');
                                    break;
                                    }
                                  } else if (settingValue.length > 2) {
                                    // For full country names and other settings, use normal matching
                                    // But prioritize exact matches first, then fuzzy matching
                                    var exactMatch = optTextLower === settingValue;
                                    var containsMatch = optTextLower.indexOf(settingValue) > -1 || 
                                                        settingValue.indexOf(optTextLower) > -1;
                                    
                                    // For job titles, also check for common abbreviations and variations
                                    var fuzzyMatch = false;
                                    
                                    if (isJobTitleField) {
                                      // Common job title mappings (e.g., "CEO" matches "Chief Executive Officer")
                                      var titleMappings = {
                                        'ceo': ['chief executive officer', 'executive officer', 'chief executive'],
                                        'cto': ['chief technology officer', 'technology officer', 'tech officer'],
                                        'cfo': ['chief financial officer', 'financial officer'],
                                        'cmo': ['chief marketing officer', 'marketing officer'],
                                        'coo': ['chief operating officer', 'operating officer'],
                                        'president': ['pres', 'president'],
                                        'founder': ['founder', 'co-founder', 'cofounder'],
                                        'director': ['dir', 'director'],
                                        'manager': ['mgr', 'manager', 'management'],
                                        'engineer': ['eng', 'engineer', 'engineering'],
                                        'developer': ['dev', 'developer', 'development'],
                                        'designer': ['design', 'designer'],
                                        'analyst': ['analyst', 'analysis'],
                                        'consultant': ['consultant', 'consulting'],
                                        'investor': ['investor', 'investment', 'vc', 'venture capital'],
                                        'advisor': ['advisor', 'adviser', 'advisory']
                                      };
                                      
                                      // Industry/experience level mappings
                                      var industryMappings = {
                                        'tech': ['technology', 'technological', 'tech industry', 'it', 'information technology'],
                                        'technology': ['tech', 'it', 'information technology'],
                                        'finance': ['financial', 'fintech', 'banking'],
                                        'healthcare': ['health', 'medical', 'health care'],
                                        'beginner': ['entry level', 'entry-level', 'junior', 'starting', 'new'],
                                        'entry level': ['beginner', 'junior', 'starting', 'new'],
                                        'intermediate': ['mid-level', 'mid level', 'experienced', 'some experience'],
                                        'advanced': ['senior', 'expert', 'professional', 'experienced'],
                                        'senior': ['advanced', 'expert', 'professional', 'experienced']
                                      };
                                      
                                      // Check industry/experience mappings if applicable
                                      var isIndustryField = labelLower.indexOf('industry') > -1 || labelLower.indexOf('sector') > -1;
                                      var isExperienceField = labelLower.indexOf('experience') > -1 || labelLower.indexOf('level') > -1;
                                      
                                      if (isIndustryField || isExperienceField) {
                                        for (var imKey in industryMappings) {
                                          if (settingValue.indexOf(imKey) > -1 || imKey.indexOf(settingValue) > -1) {
                                            for (var im = 0; im < industryMappings[imKey].length; im++) {
                                              if (optTextLower.indexOf(industryMappings[imKey][im]) > -1) {
                                                fuzzyMatch = true;
                                                break;
                                              }
                                            }
                                            if (fuzzyMatch) break;
                                          }
                                        }
                                        
                                        // Also check reverse
                                        for (var imKey in industryMappings) {
                                          if (optTextLower.indexOf(imKey) > -1) {
                                            for (var im = 0; im < industryMappings[imKey].length; im++) {
                                              if (settingValue.indexOf(industryMappings[imKey][im]) > -1) {
                                                fuzzyMatch = true;
                                                break;
                                              }
                                            }
                                            if (fuzzyMatch) break;
                                          }
                                        }
                                      }
                                      
                                      // Check if setting value matches any key in titleMappings
                                      for (var key in titleMappings) {
                                        if (settingValue.indexOf(key) > -1 || key.indexOf(settingValue) > -1) {
                                          // Check if option contains any of the mapped values
                                          for (var m = 0; m < titleMappings[key].length; m++) {
                                            if (optTextLower.indexOf(titleMappings[key][m]) > -1) {
                                              fuzzyMatch = true;
                                              break;
                                            }
                                          }
                                          if (fuzzyMatch) break;
                                        }
                                      }
                                      
                                      // Also check reverse - if option is a key, check if setting contains mapped values
                                      for (var key in titleMappings) {
                                        if (optTextLower.indexOf(key) > -1) {
                                          for (var m = 0; m < titleMappings[key].length; m++) {
                                            if (settingValue.indexOf(titleMappings[key][m]) > -1) {
                                              fuzzyMatch = true;
                                              break;
                                            }
                                          }
                                          if (fuzzyMatch) break;
                                        }
                                      }
                                      
                                      // Also check word-by-word matching for job titles
                                      var settingWords = settingValue.split(/\s+/);
                                      var optWords = optTextLower.split(/\s+/);
                                      var matchingWords = 0;
                                      for (var sw = 0; sw < settingWords.length; sw++) {
                                        for (var ow = 0; ow < optWords.length; ow++) {
                                          if (settingWords[sw].length > 2 && optWords[ow].indexOf(settingWords[sw]) > -1) {
                                            matchingWords++;
                                            break;
                                          }
                                        }
                                      }
                                      // If at least 50% of words match, consider it a match
                                      if (settingWords.length > 0 && matchingWords / settingWords.length >= 0.5) {
                                        fuzzyMatch = true;
                                      }
                                      
                                      // Improved partial word matching - check if significant parts of words match
                                      // This helps with cases like "Software Engineer" matching "Engineer"
                                      if (!fuzzyMatch && settingValue.length > 3) {
                                        // Extract key words (3+ characters) from setting
                                        var keyWords = settingValue.split(/\s+/).filter(function(w) { return w.length >= 3; });
                                        var matchedKeyWords = 0;
                                        for (var kw = 0; kw < keyWords.length; kw++) {
                                          // Check if any word in option contains this key word
                                          for (var ow = 0; ow < optWords.length; ow++) {
                                            if (optWords[ow].indexOf(keyWords[kw]) > -1 || keyWords[kw].indexOf(optWords[ow]) > -1) {
                                              matchedKeyWords++;
                                              break;
                                            }
                                          }
                                        }
                                        // If at least one key word matches, consider it a fuzzy match
                                        if (keyWords.length > 0 && matchedKeyWords > 0) {
                                          fuzzyMatch = true;
                                        }
                                      }
                                    }
                                    
                                    if (exactMatch || containsMatch || fuzzyMatch) {
                                      matchedOptions.push(opt);
                                      matched = true;
                                      var matchType = exactMatch ? 'exact' : (containsMatch ? 'contains' : 'fuzzy');
                                      console.log('[Luma Auto Register] ✓ Matched option "' + optText + '" to setting: "' + settingsToCheck[s] + '" (' + matchType + ' match)');
                                      break;
                                    }
                                  }
                                }
                              }
                              
                              if (!matched) {
                                unmatchedOptions.push(opt);
                              }
                            }
                            
                            // Use matched options if found, otherwise use first 2-3 unmatched options
                            if (matchedOptions.length > 0) {
                              optionsToSelect = matchedOptions;
                              console.log('[Luma Auto Register] Found ' + matchedOptions.length + ' matching options from settings');
                            } else {
                              // No matches found, select ONLY the first option as a safe fallback.
                              // Previously we chose the first 2-3 options, but this can be overly
                              // aggressive for questions where a single choice is expected.
                              var maxSelections = Math.min(1, unmatchedOptions.length);
                              optionsToSelect = unmatchedOptions.slice(0, maxSelections);
                              console.log('[Luma Auto Register] No settings matches found, selecting first ' + optionsToSelect.length + ' option(s)');
                            }
                            
                            // Select each option one by one
                            var selectNextOption = function(optIndex) {
                              if (optIndex >= optionsToSelect.length) {
                                // All options selected, now close the dropdown
                                console.log('[Luma Auto Register] ✓ Selected ' + optionsToSelect.length + ' options in multi-select dropdown');
                                
                                // Wait a bit, then close the menu
                                // IMPORTANT: Don't use Escape or document.body.click() as it might close the main modal
                                setTimeout(function() {
                                  // Find the dropdown menu element
                                  var menuWrapper = document.querySelector('.lux-menu-wrapper:not([style*="display: none"])');
                                  
                                  // Close the dropdown by clicking the trigger again (toggles it closed)
                                  // This is the safest method - it doesn't interfere with other elements
                                  var dropdownTrigger = dropdown;
                                  if (dropdown.tagName !== 'INPUT' && dropdown.tagName !== 'BUTTON') {
                                    var trigger = dropdown.closest('.lux-menu-trigger-wrapper') || 
                                                 dropdown.querySelector('.lux-menu-trigger-wrapper') ||
                                                 dropdown;
                                    dropdownTrigger = trigger;
                                  }
                                  
                                  // Wait a moment for the selections to register, then close
                                  setTimeout(function() {
                                    if (dropdownTrigger) {
                                      console.log('[Luma Auto Register] Clicking dropdown trigger to close multi-select menu');
                                      // Focus first, then click to toggle closed
                                      dropdownTrigger.focus();
                                      setTimeout(function() {
                                        dropdownTrigger.click();
                                      }, 100);
                                    }
                                    
                                    // Also blur as a backup
                                    setTimeout(function() {
                                      if (dropdownTrigger) {
                                        dropdownTrigger.blur();
                                      }
                                      if (dropdown.tagName === 'INPUT') {
                                        dropdown.blur();
                                      }
                                    }, 200);
                                  }, 300);
                                  
                                  // Trigger events on the dropdown input
                                  if (dropdown.tagName === 'INPUT') {
                                    dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                                    dropdown.dispatchEvent(new Event('input', { bubbles: true }));
                                    dropdown.dispatchEvent(new Event('blur', { bubbles: true }));
                                  }
                                  
                                  // Process next dropdown
                                  setTimeout(function() {
                                    processCustomDropdown(index + 1);
                                  }, 600);
                                }, 400);
                                return;
                              }
                              
                              var opt = optionsToSelect[optIndex];
                              var optText = (opt.textContent || opt.innerText || '').trim();
                              
                              console.log('[Luma Auto Register] Clicking option ' + (optIndex + 1) + '/' + optionsToSelect.length + ': "' + optText + '"');
                              
                              // Click the option
                              opt.click();
                              opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                              opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                              opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                              
                              // Wait a bit before selecting next option (keep dropdown open)
                              setTimeout(function() {
                                selectNextOption(optIndex + 1);
                              }, 300);
                            };
                            
                            // Start selecting options
                            selectNextOption(0);
                            
                          } else {
                            // Single-select: select one option and close
                            console.log('[Luma Auto Register] Clicking option: "' + (selectedOption.textContent || selectedOption.innerText || '').trim() + '"');
                            selectedOption.click();
                            
                            // Also try mouse events for better compatibility
                            selectedOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                            selectedOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                            selectedOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            
                            console.log('[Luma Auto Register] ✓ Selected option in custom dropdown');
                            
                            // Trigger events on the dropdown input
                            dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                            dropdown.dispatchEvent(new Event('input', { bubbles: true }));
                            dropdown.dispatchEvent(new Event('blur', { bubbles: true }));
                            
                            // Verify the value was set
                            setTimeout(function() {
                              var newValue = (dropdown.value || '').trim();
                              if (newValue) {
                                console.log('[Luma Auto Register] ✓ Dropdown value set to: "' + newValue + '"');
                              } else {
                                console.log('[Luma Auto Register] ⚠️ Dropdown value not set, but option was clicked');
                              }
                            }, 300);
                            
                            // Process next dropdown after a delay
                            setTimeout(function() {
                              processCustomDropdown(index + 1);
                            }, 700);
                          }
                        } else {
                          console.log('[Luma Auto Register] ⚠️ Could not find suitable option');
                          console.log('[Luma Auto Register] Menu wrapper HTML sample: ' + (menuWrapper.innerHTML || '').substring(0, 200));
                          
                          // Fallback: if this \"dropdown\" is actually a plain text input/textarea,
                          // fill it with a generic answer so the form can still submit.
                          var fallbackFilled = false;
                          try {
                            if (dropdownInfo.element &&
                                (dropdownInfo.element.tagName === 'INPUT' ||
                                 dropdownInfo.element.tagName === 'TEXTAREA')) {
                              var currentVal = (dropdownInfo.element.value || '').trim();
                              if (!currentVal) {
                                var fallbackAnswer = (settings.genericFallbackAnswer || 'To be provided');
                                console.log('[Luma Auto Register] Using fallback answer for "' + dropdownInfo.label + '": "' + fallbackAnswer + '"');
                                dropdownInfo.element.focus();
                                dropdownInfo.element.value = fallbackAnswer;
                                dropdownInfo.element.dispatchEvent(new Event('input', { bubbles: true }));
                                dropdownInfo.element.dispatchEvent(new Event('change', { bubbles: true }));
                                dropdownInfo.element.blur();
                                fallbackFilled = true;
                              }
                            }
                          } catch (fallbackError) {
                            console.log('[Luma Auto Register] Error applying fallback answer: ' + fallbackError);
                          }
                          
                          if (!fallbackFilled) {
                            // Only count as manual if we truly couldn't handle it
                            requiresManualCount++;
                          }
                          
                          // Process next dropdown even if this one failed or used fallback
                          setTimeout(function() {
                            processCustomDropdown(index + 1);
                          }, 500);
                        }
                      }; // End of processMenuOptions function
                      
                      // Wait for dropdown menu to appear, then select option
                      // Use longer delay for complex dropdowns that might need time to render
                      // Also wait a bit for React to process the click
                      setTimeout(function() {
                        // CRITICAL: Find the correct menu wrapper - must be visible, not the logo, and contain actual menu items
                        // First, try to find menu wrappers near the clicked dropdown
                        var dropdownContainer = dropdown.closest('div, form, section, fieldset');
                        var menuWrapper = null;
                        
                        // Method 1: Look for menu wrapper near the dropdown (most reliable)
                        // First, try to find menu that appeared after clicking (should be visible and contain options)
                        if (dropdownContainer) {
                          var nearbyMenus = dropdownContainer.querySelectorAll(
                            '[class*="lux-menu-wrapper"]:not([class*="logo"]):not([class*="wordmark"]), ' +
                            '[class*="menu-wrapper"]:not([class*="logo"]):not([class*="wordmark"]), ' +
                            '[role="listbox"]'
                          );
                          for (var nm = 0; nm < nearbyMenus.length; nm++) {
                            var menu = nearbyMenus[nm];
                            // Skip logo wrappers
                            var menuClass = (menu.className || '').toLowerCase();
                            if (menuClass.indexOf('logo') > -1 || menuClass.indexOf('wordmark') > -1) {
                              continue;
                            }
                            
                            // Must be visible
                            if (!menu.offsetParent || menu.style.display === 'none') continue;
                            
                            // Must contain menu items (lux-menu-item or role="option")
                            var hasMenuItems = menu.querySelectorAll('[class*="lux-menu-item"], [role="option"]').length > 0;
                            
                            // Also check if menu has text that looks like options (not just SVG/logo)
                            var menuText = (menu.textContent || '').trim();
                            var hasValidOptions = hasMenuItems || 
                                                 (menuText.length > 10 && 
                                                  menuText.length < 1000 && 
                                                  !menuText.match(/^[\s\n]*$/) &&
                                                  !menuClass.indexOf('logo') > -1);
                            
                            if (hasValidOptions) {
                              menuWrapper = menu;
                              console.log('[Luma Auto Register] Found menu wrapper near dropdown (hasMenuItems: ' + hasMenuItems + ')');
                              break;
                            }
                          }
                        }
                        
                        // Also check document body for menus that appeared (might be portaled outside the container)
                        if (!menuWrapper) {
                          var allVisibleMenus = document.querySelectorAll(
                            '[class*="lux-menu-wrapper"]:not([class*="logo"]):not([class*="wordmark"]), ' +
                            '[class*="menu-wrapper"]:not([class*="logo"]):not([class*="wordmark"])'
                          );
                          for (var avm = 0; avm < allVisibleMenus.length; avm++) {
                            var menu = allVisibleMenus[avm];
                            var menuClass = (menu.className || '').toLowerCase();
                            
                            // Skip logo wrappers
                            if (menuClass.indexOf('logo') > -1 || menuClass.indexOf('wordmark') > -1) {
                              continue;
                            }
                            
                            // Must be visible
                            if (!menu.offsetParent || menu.style.display === 'none') continue;
                            
                            // Must contain menu items
                            var hasMenuItems = menu.querySelectorAll('[class*="lux-menu-item"], [role="option"]').length > 0;
                            if (hasMenuItems) {
                              menuWrapper = menu;
                              console.log('[Luma Auto Register] Found menu wrapper in document (portaled)');
                              break;
                            }
                          }
                        }
                        
                        // Method 2: Look for all menu wrappers and filter out logos
                        if (!menuWrapper) {
                          var allMenuWrappers = document.querySelectorAll(
                            '[class*="lux-menu-wrapper"], ' +
                            '[class*="menu-wrapper"], ' +
                            '[role="tooltip"][class*="menu"], ' +
                            '[role="listbox"], ' +
                            '.dropdown-menu, ' +
                            '[class*="dropdown-menu"]'
                          );
                          
                          for (var amw = 0; amw < allMenuWrappers.length; amw++) {
                            var menu = allMenuWrappers[amw];
                            
                            // Skip logo wrappers
                            var menuClass = (menu.className || '').toLowerCase();
                            if (menuClass.indexOf('logo') > -1 || menuClass.indexOf('wordmark') > -1) {
                              continue;
                            }
                            
                            // Must be visible
                            if (!menu.offsetParent || menu.style.display === 'none') continue;
                            
                            // Must contain menu items (lux-menu-item or role="option")
                            var hasMenuItems = menu.querySelectorAll('[class*="lux-menu-item"], [role="option"]').length > 0;
                            
                            // Also check if it has text content that looks like menu options (not just logo SVG)
                            var menuText = (menu.textContent || '').trim();
                            var hasValidText = menuText.length > 10 && 
                                             menuText.length < 500 && 
                                             !menuText.match(/^[\s\n]*$/) &&
                                             !menuClass.indexOf('logo') > -1;
                            
                            if (hasMenuItems || hasValidText) {
                              menuWrapper = menu;
                              console.log('[Luma Auto Register] Found menu wrapper (hasMenuItems: ' + hasMenuItems + ', hasValidText: ' + hasValidText + ')');
                              break;
                            }
                          }
                        }
                        
                        // Method 3: Fallback - look for any visible menu/options container (but still filter logos)
                        if (!menuWrapper) {
                          var allMenus = document.querySelectorAll('[role="tooltip"], [role="listbox"], [class*="menu"]');
                          for (var m = 0; m < allMenus.length; m++) {
                            var menu = allMenus[m];
                            
                            // Skip logo wrappers
                            var menuClass = (menu.className || '').toLowerCase();
                            if (menuClass.indexOf('logo') > -1 || menuClass.indexOf('wordmark') > -1) {
                              continue;
                            }
                            
                            if (menu.offsetParent && menu.style.display !== 'none') {
                              // Verify it has menu items
                              var hasMenuItems = menu.querySelectorAll('[class*="lux-menu-item"], [role="option"], [class*="menu-item"]').length > 0;
                              if (hasMenuItems) {
                                menuWrapper = menu;
                                break;
                              }
                            }
                          }
                        }
                        
                        if (!menuWrapper) {
                          console.log('[Luma Auto Register] ⚠️ Could not find dropdown menu, trying again with more thorough search...');
                          // Try one more time after a longer delay with more thorough search
                          setTimeout(function() {
                            // Search more thoroughly - check all possible menu locations
                            var allPossibleMenus = document.querySelectorAll(
                              '[class*="lux-menu-wrapper"]:not([class*="logo"]):not([class*="wordmark"]), ' +
                              '[class*="menu-wrapper"]:not([class*="logo"]):not([class*="wordmark"]), ' +
                              '[class*="lux-menu"]:not([class*="logo"]):not([class*="wordmark"]), ' +
                              '[role="tooltip"]:not([class*="logo"]), ' +
                              '[role="listbox"]:not([class*="logo"]), ' +
                              '[class*="dropdown-menu"]:not([class*="logo"])'
                            );
                            
                            for (var apm = 0; apm < allPossibleMenus.length; apm++) {
                              var menu = allPossibleMenus[apm];
                              var menuClass = (menu.className || '').toLowerCase();
                              
                              // Skip logo wrappers
                              if (menuClass.indexOf('logo') > -1 || menuClass.indexOf('wordmark') > -1) {
                                continue;
                              }
                              
                              // Must be visible
                              if (!menu.offsetParent || menu.style.display === 'none') continue;
                              
                              // Check z-index - menus usually have high z-index
                              var style = window.getComputedStyle(menu);
                              var zIndex = parseInt(style.zIndex) || 0;
                              
                              // Must contain menu items
                              var hasMenuItems = menu.querySelectorAll('[class*="lux-menu-item"], [role="option"], [class*="menu-item"]').length > 0;
                              
                              // Check if it has text that looks like options
                              var menuText = (menu.textContent || '').trim();
                              var hasValidOptions = hasMenuItems || 
                                                   (menuText.length > 10 && 
                                                    menuText.length < 1000 && 
                                                    !menuText.match(/^[\s\n]*$/) &&
                                                    !menuClass.indexOf('logo') > -1);
                              
                              if (hasValidOptions) {
                                menuWrapper = menu;
                                console.log('[Luma Auto Register] Found menu wrapper on retry (z-index: ' + zIndex + ', hasMenuItems: ' + hasMenuItems + ')');
                                break;
                              }
                            }
                            
                            if (!menuWrapper) {
                              console.log('[Luma Auto Register] ⚠️ Could not find dropdown menu after retry');
                              // Try to find the input and see if we can get its value another way
                              var inputValue = (dropdown.value || '').trim();
                              var inputPlaceholder = (dropdown.placeholder || '').trim();
                              console.log('[Luma Auto Register] Dropdown input value: "' + inputValue + '", placeholder: "' + inputPlaceholder + '"');
                              
                              requiresManualCount++;
                              setTimeout(function() {
                                processCustomDropdown(index + 1);
                              }, 500);
                              return;
                            }
                            
                            processMenuOptions(menuWrapper);
                          }, 1000); // Increased delay to 1 second
                        }
                        
                        // Only execute this code if menuWrapper was found synchronously (not inside the nested setTimeout)
                        if (menuWrapper) {
                          console.log('[Luma Auto Register] Found menu wrapper: ' + (menuWrapper.className || menuWrapper.getAttribute('role')));
                          
                          // Debug: Log what's actually in the menu wrapper
                          var allChildren = menuWrapper.querySelectorAll('*');
                          console.log('[Luma Auto Register] Menu wrapper has ' + allChildren.length + ' child elements');
                          if (allChildren.length > 0 && allChildren.length < 50) {
                            console.log('[Luma Auto Register] First few child elements:');
                            for (var dbg = 0; dbg < Math.min(5, allChildren.length); dbg++) {
                              var child = allChildren[dbg];
                              var childText = (child.textContent || '').trim().substring(0, 50);
                              console.log('[Luma Auto Register]   - ' + child.tagName + ' (' + child.className + '): "' + childText + '"');
                            }
                          }
                          
                          // Process menu options
                          processMenuOptions(menuWrapper);
                        }
                      }, 1200); // Increased to 1200ms for complex dropdowns that need time to render and for React to process
                      
                    } catch (error) {
                      console.log('[Luma Auto Register] ⚠️ Error with custom dropdown: ' + error);
                      requiresManualCount++;
                      // Continue with next dropdown
                      setTimeout(function() {
                        processCustomDropdown(index + 1);
                      }, 500);
                    }
                  } // End of processCustomDropdown function
                  
                  // Start processing from index 0
                  processCustomDropdown(0);
                }
                
                // Handle all required checkboxes
                console.log('[Luma Auto Register] === CHECKING REQUIRED CHECKBOXES ===');
                console.log('[Luma Auto Register] Found ' + requiredCheckboxes.length + ' required checkboxes (excluding terms)');
                
                // NOTE: Terms checkbox will be checked AFTER all dropdowns are processed
                // This prevents interference with dropdown interactions
                
                // Check if a terms acceptance modal appears (requires name signature)
                // This check should still run even if we're not auto-checking the checkbox
                if (termsCheckbox) {
                  setTimeout(function() {
                    console.log('[Luma Auto Register] === CHECKING FOR TERMS MODAL ===');
                      
                      // Look for "Accept Terms" modal
                      var termsModal = null;
                      var modalSelectors = [
                        '[role="dialog"]',
                        '.modal',
                        '[class*="modal"]',
                        '[class*="Modal"]',
                        '[class*="dialog"]',
                        '[class*="Dialog"]'
                      ];
                      
                      for (var ms = 0; ms < modalSelectors.length; ms++) {
                        var modals = document.querySelectorAll(modalSelectors[ms]);
                        for (var m = 0; m < modals.length; m++) {
                          var modal = modals[m];
                          var modalText = (modal.textContent || '').toLowerCase();
                          
                          // More specific detection: must have "sign" AND "accept" together, or "sign & accept" button
                          var hasSignAndAccept = (modalText.indexOf('sign') > -1 && modalText.indexOf('accept') > -1);
                          var hasSignAcceptButton = modal.querySelector('button:not([type="button"]), button[type="submit"]') && 
                                                     (modal.querySelector('button') ? (modal.querySelector('button').textContent || '').toLowerCase().indexOf('sign') > -1 && 
                                                      (modal.querySelector('button').textContent || '').toLowerCase().indexOf('accept') > -1 : false);
                          
                          // Must NOT be the main registration form (which has fields like "first name", "last name", "company", etc.)
                          var isMainForm = modalText.indexOf('first name') > -1 || 
                                           modalText.indexOf('last name') > -1 ||
                                           modalText.indexOf('company') > -1 ||
                                           modalText.indexOf('job title') > -1 ||
                                           modalText.indexOf('phone') > -1;
                          
                          if ((hasSignAndAccept || hasSignAcceptButton) && !isMainForm) {
                            termsModal = modal;
                            console.log('[Luma Auto Register] Found terms acceptance modal (not main form)');
                            break;
                          }
                        }
                        if (termsModal) break;
                      }
                      
                      // Check if we've already handled this modal
                      if (typeof window !== 'undefined' && window.__lumaTermsModalHandled) {
                        console.log('[Luma Auto Register] Terms modal already handled, skipping duplicate check...');
                        return;
                      }
                      
                      if (termsModal) {
                        console.log('[Luma Auto Register] === PROCESSING TERMS MODAL ===');
                        console.log('[Luma Auto Register] Modal HTML sample: ' + (termsModal.innerHTML || '').substring(0, 200));
                        
                        // Mark that we're handling it to prevent duplicates
                        if (typeof window !== 'undefined') {
                          window.__lumaTermsModalHandled = true;
                        }
                        
                        // Find the name input field - try multiple strategies
                        var nameInput = null;
                        
                        // First, log ALL inputs found in modal for debugging
                        var allInputs = termsModal.querySelectorAll('input, textarea, [contenteditable="true"]');
                        console.log('[Luma Auto Register] Found ' + allInputs.length + ' total input/textarea/contenteditable elements in modal');
                        
                        // Strategy 1: Look for input with placeholder containing "name" (case insensitive)
                        for (var ni = 0; ni < allInputs.length; ni++) {
                          var inp = allInputs[ni];
                          var placeholder = (inp.placeholder || '').toLowerCase();
                          var type = (inp.type || '').toLowerCase();
                          var name = (inp.name || '').toLowerCase();
                          var id = (inp.id || '').toLowerCase();
                          var className = (inp.className || '').toLowerCase();
                          var contentEditable = inp.contentEditable === 'true';
                          
                          console.log('[Luma Auto Register]   Checking input ' + ni + ': type="' + type + '", placeholder="' + placeholder + '", name="' + name + '", id="' + id + '", contentEditable=' + contentEditable);
                          
                          // Check if it's a text input, textarea, or contentEditable (not hidden, submit, button, etc.)
                          var isTextarea = inp.tagName === 'TEXTAREA';
                          var isTextInput = type === 'text' || type === '' || !type;
                          
                          if (isTextInput || isTextarea || contentEditable) {
                            // For terms modal signature, look for signature-specific indicators
                            // NOT regular form fields like "first name" or "last name"
                            var isSignatureField = false;
                            
                            // Signature fields typically have:
                            // - Placeholder like "jane", "john smith" (single name, not "first name")
                            // - NOT "first name", "last name", "first_name", "last_name"
                            var isRegularNameField = placeholder.indexOf('first name') > -1 || 
                                                     placeholder.indexOf('last name') > -1 ||
                                                     placeholder.indexOf('first_name') > -1 ||
                                                     placeholder.indexOf('last_name') > -1 ||
                                                     name.indexOf('first') > -1 ||
                                                     name.indexOf('last') > -1 ||
                                                     id.indexOf('first') > -1 ||
                                                     id.indexOf('last') > -1;
                            
                            if (isRegularNameField) {
                              console.log('[Luma Auto Register]   Skipping regular name field (first/last name): ' + (placeholder || name || id));
                              continue; // Skip regular form fields
                            }
                            
                            // Signature field indicators:
                            // - Placeholder with just a name (like "jane", "john smith") without "first" or "last"
                            // - Or placeholder/name/id/class containing "name" but NOT "first" or "last"
                            if ((placeholder.indexOf('name') > -1 && !isRegularNameField) || 
                                placeholder.indexOf('john') > -1 || // Common signature placeholder
                                placeholder.indexOf('smith') > -1 ||
                                placeholder.indexOf('jane') > -1 ||
                                (name.indexOf('name') > -1 && !isRegularNameField) || 
                                (id.indexOf('name') > -1 && !isRegularNameField) ||
                                (className.indexOf('name') > -1 && !isRegularNameField)) {
                              isSignatureField = true;
                            }
                            
                            if (isSignatureField) {
                              nameInput = inp;
                              console.log('[Luma Auto Register] ✓ Found signature name input (not regular form field): ' + (placeholder || name || id || className) + ' (tagName: ' + inp.tagName + ')');
                              break;
                            }
                          }
                        }
                        
                        // Strategy 2: If no specific match, find first visible text input, textarea, or contentEditable
                        // BUT skip regular form fields (first name, last name, etc.)
                        if (!nameInput) {
                          console.log('[Luma Auto Register] No specific match found, looking for first visible text input/textarea (excluding regular form fields)...');
                          for (var ni2 = 0; ni2 < allInputs.length; ni2++) {
                            var inp2 = allInputs[ni2];
                            var type2 = (inp2.type || '').toLowerCase();
                            var isContentEditable = inp2.contentEditable === 'true';
                            var isTextarea2 = inp2.tagName === 'TEXTAREA';
                            var isTextInput2 = type2 === 'text' || type2 === '' || !type2;
                            
                            // Skip regular form fields
                            var placeholder2 = (inp2.placeholder || '').toLowerCase();
                            var name2 = (inp2.name || '').toLowerCase();
                            var id2 = (inp2.id || '').toLowerCase();
                            var isRegularNameField2 = placeholder2.indexOf('first name') > -1 || 
                                                       placeholder2.indexOf('last name') > -1 ||
                                                       placeholder2.indexOf('first_name') > -1 ||
                                                       placeholder2.indexOf('last_name') > -1 ||
                                                       name2.indexOf('first') > -1 ||
                                                       name2.indexOf('last') > -1 ||
                                                       id2.indexOf('first') > -1 ||
                                                       id2.indexOf('last') > -1;
                            
                            if (isRegularNameField2) {
                              console.log('[Luma Auto Register]   Skipping regular name field in Strategy 2: ' + (placeholder2 || name2 || id2));
                              continue;
                            }
                            
                            if ((isTextInput2 || isTextarea2 || isContentEditable) && 
                                inp2.offsetParent !== null && 
                                !inp2.disabled &&
                                inp2.style.display !== 'none') {
                              nameInput = inp2;
                              console.log('[Luma Auto Register] ✓ Found name input (first visible text input/textarea/contentEditable, tagName: ' + inp2.tagName + ')');
                              break;
                            }
                          }
                        }
                        
                        // Strategy 3: Look for input with specific classes or attributes
                        if (!nameInput) {
                          nameInput = termsModal.querySelector('input[class*="name"], input[class*="Name"], input[data-name], input[aria-label*="name" i], [contenteditable="true"]');
                          if (nameInput) {
                            console.log('[Luma Auto Register] ✓ Found name input by class/attribute/contentEditable');
                          }
                        }
                        
                        if (nameInput) {
                          // Get user's name from settings
                          var firstName = (settings.firstName || '').trim();
                          var lastName = (settings.lastName || '').trim();
                          var fullName = '';
                          
                          if (firstName && lastName) {
                            fullName = firstName + ' ' + lastName;
                          } else if (firstName) {
                            fullName = firstName;
                          } else if (lastName) {
                            fullName = lastName;
                          } else {
                            // Fallback: try to get name from page (user profile)
                            var pageName = document.querySelector('[class*="name"], [class*="Name"], [data-name]');
                            if (pageName) {
                              fullName = (pageName.textContent || '').trim();
                            }
                          }
                          
                          if (fullName) {
                            console.log('[Luma Auto Register] Filling name in terms modal: "' + fullName + '"');
                            console.log('[Luma Auto Register] Name input found! TagName: ' + nameInput.tagName + ', Type: ' + (nameInput.type || 'N/A') + ', Placeholder: "' + (nameInput.placeholder || '') + '", contentEditable: ' + (nameInput.contentEditable || 'false'));
                            
                            // Focus the input first
                            nameInput.focus();
                            
                            // Get native value setter for React compatibility (if it's an input, not contentEditable)
                            var nativeInputValueSetter = null;
                            if (nameInput.tagName === 'INPUT' && nameInput.contentEditable !== 'true') {
                              try {
                                nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                              } catch (e) {
                                console.log('[Luma Auto Register] Could not get native value setter: ' + e.message);
                              }
                            }
                            
                            // Clear any existing value
                            if (nameInput.contentEditable === 'true') {
                              nameInput.textContent = '';
                              nameInput.innerText = '';
                            } else if (nativeInputValueSetter) {
                              // Use native setter to clear
                              nativeInputValueSetter.call(nameInput, '');
                            } else {
                              nameInput.value = '';
                            }
                            
                            // Type the name character by character to simulate human typing (prevents bot detection)
                            console.log('[Luma Auto Register] Typing name character by character...');
                            
                            // Store reference to modal for later use
                            var modalRef = termsModal;
                            var typingComplete = false;
                            
                            (function typeName(index) {
                              if (index >= fullName.length) {
                                // Done typing, trigger events
                                typingComplete = true;
                                
                                // Get current value to verify
                                var currentValue = nameInput.contentEditable === 'true' ? (nameInput.textContent || nameInput.innerText) : nameInput.value;
                                console.log('[Luma Auto Register] ✓ Finished typing name (typed ' + fullName.length + ' characters)');
                                console.log('[Luma Auto Register] Current input value: "' + currentValue + '"');
                                
                                // If value doesn't match, try to set it directly using React-compatible method
                                if (currentValue !== fullName && nameInput.contentEditable !== 'true') {
                                  console.log('[Luma Auto Register] Value mismatch detected, setting directly with React-compatible method...');
                                  if (nativeInputValueSetter) {
                                    nativeInputValueSetter.call(nameInput, fullName);
                                  } else {
                                    nameInput.value = fullName;
                                  }
                                  
                                  // Trigger React onChange handler if available
                                  var reactInstance = nameInput._reactInternalInstance || 
                                                      nameInput.__reactInternalInstance ||
                                                      (nameInput.__reactFiber$ || nameInput.__reactFiber);
                                  if (reactInstance) {
                                    try {
                                      var onChange = nameInput.onchange || nameInput.oninput;
                                      if (onChange) {
                                        var syntheticEvent = {
                                          target: nameInput,
                                          currentTarget: nameInput,
                                          type: 'input',
                                          bubbles: true,
                                          cancelable: true,
                                          defaultPrevented: false
                                        };
                                        onChange(syntheticEvent);
                                        console.log('[Luma Auto Register] Triggered React onChange handler');
                                      }
                                    } catch (e) {
                                      console.log('[Luma Auto Register] Could not trigger React handler: ' + e.message);
                                    }
                                  }
                                }
                                
                                // Trigger comprehensive events
                                nameInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                                nameInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                                nameInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: fullName[fullName.length - 1] }));
                                nameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: fullName[fullName.length - 1] }));
                                
                                // For contentEditable, also trigger input event
                                if (nameInput.contentEditable === 'true') {
                                  nameInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: fullName }));
                                }
                                
                                // Verify one more time after events
                                setTimeout(function() {
                                  var finalValue = nameInput.contentEditable === 'true' ? (nameInput.textContent || nameInput.innerText) : nameInput.value;
                                  console.log('[Luma Auto Register] Final input value after events: "' + finalValue + '"');
                                  if (finalValue !== fullName && finalValue.length < fullName.length) {
                                    console.log('[Luma Auto Register] ⚠️ Value still not set correctly, attempting direct set...');
                                    if (nameInput.contentEditable !== 'true' && nativeInputValueSetter) {
                                      nativeInputValueSetter.call(nameInput, fullName);
                                      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                                      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                  }
                                }, 100);
                                
                                // Blur to trigger validation
                                setTimeout(function() {
                                  nameInput.blur();
                                  
                                  // Wait a bit for validation, then find and click "Sign & Accept" button
                                  // Use longer delay to ensure typing is fully processed
                                  setTimeout(function() {
                                    // Double-check typing is complete
                                    if (!typingComplete) {
                                      console.log('[Luma Auto Register] ⚠️ Typing not complete yet, waiting...');
                                      setTimeout(arguments.callee, 200);
                                      return;
                                    }
                                    
                                    // Re-find modal in case DOM changed
                                    var currentModal = modalRef;
                                    if (!currentModal || !currentModal.offsetParent) {
                                      // Modal might have moved or been re-rendered, try to find it again
                                      var modalSelectors = [
                                        '[role="dialog"]',
                                        '.modal',
                                        '[class*="modal"]',
                                        '[class*="Modal"]',
                                        '[class*="dialog"]',
                                        '[class*="Dialog"]'
                                      ];
                                      
                                      for (var ms = 0; ms < modalSelectors.length; ms++) {
                                        var modals = document.querySelectorAll(modalSelectors[ms]);
                                        for (var m = 0; m < modals.length; m++) {
                                          var modal = modals[m];
                                          if (!modal.offsetParent) continue;
                                          var modalText = (modal.textContent || '').toLowerCase();
                                          if (modalText.indexOf('accept terms') > -1 || 
                                              (modalText.indexOf('sign') > -1 && modalText.indexOf('accept') > -1)) {
                                            currentModal = modal;
                                            break;
                                          }
                                        }
                                        if (currentModal && currentModal.offsetParent) break;
                                      }
                                    }
                                    
                                    if (!currentModal || !currentModal.offsetParent) {
                                      console.log('[Luma Auto Register] ⚠️ Terms modal no longer visible, may have closed');
                                      return;
                                    }
                                    
                                    var signButtons = currentModal.querySelectorAll('button, input[type="submit"]');
                                    var signBtn = null;
                                    
                                    console.log('[Luma Auto Register] Looking for "Sign & Accept" button, found ' + signButtons.length + ' buttons in modal');
                                    
                                    for (var sb = 0; sb < signButtons.length; sb++) {
                                      var btn = signButtons[sb];
                                      var btnText = (btn.textContent || '').toLowerCase();
                                      console.log('[Luma Auto Register] Checking button ' + sb + ': "' + btnText + '"');
                                      if (btnText.indexOf('sign') > -1 && btnText.indexOf('accept') > -1 ||
                                          btnText.indexOf('accept') > -1 && btnText.indexOf('sign') > -1 ||
                                          btnText === 'sign & accept' ||
                                          btnText === 'sign and accept') {
                                        signBtn = btn;
                                        console.log('[Luma Auto Register] Found "Sign & Accept" button');
                                        break;
                                      }
                                    }
                                    
                                    if (signBtn && !signBtn.disabled && signBtn.offsetParent) {
                                      console.log('[Luma Auto Register] Clicking "Sign & Accept" button (after typing complete)');
                                      signBtn.click();
                                      signBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                      signBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                      signBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                                      console.log('[Luma Auto Register] ✓ Terms modal signed and accepted');
                                      
                                      // Mark that we've handled the terms modal to prevent duplicate handling
                                      if (typeof window !== 'undefined') {
                                        window.__lumaTermsModalHandled = true;
                                      }
                                      
                                      // Wait for modal to actually close before continuing
                                      var checkModalClosed = function(attempts) {
                                        attempts = attempts || 0;
                                        if (attempts > 20) { // Max 4 seconds (20 * 200ms)
                                          console.log('[Luma Auto Register] ⚠️ Terms modal did not close after 4 seconds, continuing anyway...');
                                          return;
                                        }
                                        
                                        var modalStillOpen = false;
                                        var modalSelectors = [
                                          '[role="dialog"]',
                                          '.modal',
                                          '[class*="modal"]',
                                          '[class*="Modal"]'
                                        ];
                                        
                                        for (var ms = 0; ms < modalSelectors.length; ms++) {
                                          var modals = document.querySelectorAll(modalSelectors[ms]);
                                          for (var m = 0; m < modals.length; m++) {
                                            var modal = modals[m];
                                            if (!modal.offsetParent) continue;
                                            var modalText = (modal.textContent || '').toLowerCase();
                                            if (modalText.indexOf('accept terms') > -1 || 
                                                (modalText.indexOf('sign') > -1 && modalText.indexOf('accept') > -1)) {
                                              modalStillOpen = true;
                                              break;
                                            }
                                          }
                                          if (modalStillOpen) break;
                                        }
                                        
                                        if (modalStillOpen) {
                                          console.log('[Luma Auto Register] Terms modal still open, waiting... (attempt ' + (attempts + 1) + ')');
                                          setTimeout(function() {
                                            checkModalClosed(attempts + 1);
                                          }, 200);
                                        } else {
                                          console.log('[Luma Auto Register] ✓ Terms modal closed, continuing with registration...');
                                        }
                                      };
                                      
                                      // Start checking after a short delay
                                      setTimeout(function() {
                                        checkModalClosed(0);
                                      }, 300);
                                    } else {
                                      console.log('[Luma Auto Register] ⚠️ Could not find or click "Sign & Accept" button (disabled: ' + (signBtn ? signBtn.disabled : 'null') + ', visible: ' + (signBtn ? (signBtn.offsetParent !== null) : 'null') + ')');
                                    }
                                  }, 500); // Increased delay to 500ms to ensure typing is fully processed
                                }, 200); // Increased blur delay to 200ms
                                return;
                              }
                              
                              var char = fullName[index];
                              var currentText = fullName.substring(0, index + 1);
                              
                              if (nameInput.contentEditable === 'true') {
                                nameInput.textContent = currentText;
                                nameInput.innerText = currentText;
                              } else if (nativeInputValueSetter) {
                                // Use native setter for React compatibility
                                nativeInputValueSetter.call(nameInput, currentText);
                              } else {
                                nameInput.value = currentText;
                              }
                              
                              // Trigger keydown, keypress, and keyup events for each character
                              nameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char, keyCode: char.charCodeAt(0) }));
                              nameInput.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char, keyCode: char.charCodeAt(0) }));
                              
                              // Create input event with proper target
                              var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                              Object.defineProperty(inputEvent, 'target', { value: nameInput, enumerable: true, writable: false });
                              nameInput.dispatchEvent(inputEvent);
                              
                              nameInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char, keyCode: char.charCodeAt(0) }));
                              
                              // For contentEditable, also trigger InputEvent
                              if (nameInput.contentEditable === 'true') {
                                nameInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
                              }
                              
                              // Wait 40-100ms between characters (optimized for speed while still appearing natural)
                              var delay = 40 + Math.random() * 60;
                              setTimeout(function() {
                                typeName(index + 1);
                              }, delay);
                            })(0);
                          } else {
                            console.log('[Luma Auto Register] ⚠️ No name available to fill in terms modal');
                          }
                        } else {
                          console.log('[Luma Auto Register] ⚠️ Could not find name input in terms modal');
                          // Debug: log all inputs in modal
                          var allInputsDebug = termsModal.querySelectorAll('input, textarea');
                          console.log('[Luma Auto Register] Found ' + allInputsDebug.length + ' input/textarea elements in modal:');
                          for (var di = 0; di < allInputsDebug.length; di++) {
                            var inp = allInputsDebug[di];
                            console.log('[Luma Auto Register]   Input ' + di + ': type="' + (inp.type || 'text') + '", placeholder="' + (inp.placeholder || '') + '", name="' + (inp.name || '') + '", id="' + (inp.id || '') + '", visible=' + (inp.offsetParent !== null));
                          }
                        }
                      } else {
                        console.log('[Luma Auto Register] No terms modal found');
                      }
                    }, 1000); // Wait 1 second for modal to appear
                }
                
                // Handle all other required checkboxes (auto-check them)
                // These are always checked (unlike terms which respects settings)
                for (var cb = 0; cb < requiredCheckboxes.length; cb++) {
                  var checkbox = requiredCheckboxes[cb];
                  if (!checkbox.input.checked) {
                    console.log('[Luma Auto Register] Checking required checkbox: ' + checkbox.description);
                    reliablyCheckCheckbox(checkbox.input, checkbox.description || 'required checkbox');
                    
                    // Verify it's still checked after a brief delay (in case something unchecks it)
                    setTimeout(function(cbInput, cbDesc) {
                      return function() {
                        if (!cbInput.checked) {
                          console.log('[Luma Auto Register] ⚠️ Required checkbox was unchecked, re-checking: ' + cbDesc);
                          reliablyCheckCheckbox(cbInput, cbDesc || 'required checkbox');
                        }
                      };
                    }(checkbox.input, checkbox.description), 200);
                  } else {
                    console.log('[Luma Auto Register] ✓ Already checked: ' + checkbox.description);
                  }
                }
                
                // Wait longer for React to validate and enable the button
                // Also check if terms modal is being handled and wait for it to close
                var checkForTermsModalAndWait = function(callback, attempts) {
                  attempts = attempts || 0;
                  
                  // Check if terms modal is still open
                  var termsModalOpen = false;
                  if (typeof window !== 'undefined' && window.__lumaTermsModalHandled) {
                    // Modal was handled, check if it's still visible
                    var modalSelectors = [
                      '[role="dialog"]',
                      '.modal',
                      '[class*="modal"]',
                      '[class*="Modal"]'
                    ];
                    
                    for (var ms = 0; ms < modalSelectors.length; ms++) {
                      var modals = document.querySelectorAll(modalSelectors[ms]);
                      for (var m = 0; m < modals.length; m++) {
                        var modal = modals[m];
                        if (!modal.offsetParent) continue;
                        var modalText = (modal.textContent || '').toLowerCase();
                        if (modalText.indexOf('accept terms') > -1 || 
                            (modalText.indexOf('sign') > -1 && modalText.indexOf('accept') > -1)) {
                          termsModalOpen = true;
                          break;
                        }
                      }
                      if (termsModalOpen) break;
                    }
                  }
                  
                  if (termsModalOpen && attempts < 30) {
                    // Modal still open, wait a bit more
                    console.log('[Luma Auto Register] Terms modal still open, waiting before looking for submit button... (attempt ' + (attempts + 1) + ')');
                    setTimeout(function() {
                      checkForTermsModalAndWait(callback, attempts + 1);
                    }, 200);
                  } else {
                    // Modal closed or max attempts reached, proceed
                    if (termsModalOpen) {
                      console.log('[Luma Auto Register] ⚠️ Terms modal still open after 6 seconds, proceeding anyway...');
                    } else {
                      console.log('[Luma Auto Register] Terms modal closed, proceeding to submit button search...');
                    }
                    callback();
                  }
                };
                
                // Only search for submit button after a delay if there are no custom dropdowns
                // (If there are dropdowns, the search will happen after they're all processed)
                // CRITICAL: Wait for React to process field values before submitting
                if (customDropdownsToProcess.length === 0) {
                  setTimeout(function() {
                    // Verify fields are still filled before proceeding (React might have cleared them)
                    var allFilledFields = document.querySelectorAll('input[type="text"], input:not([type]), input[type="email"], textarea');
                    var fieldsStillFilled = true;
                    for (var vf = 0; vf < allFilledFields.length; vf++) {
                      var fieldToVerify = allFilledFields[vf];
                      if (!fieldToVerify.offsetParent || fieldToVerify.disabled) continue;
                      var fieldValue = (fieldToVerify.value || '').trim();
                      var fieldName = (fieldToVerify.name || '').toLowerCase();
                      var fieldPlaceholder = (fieldToVerify.placeholder || '').toLowerCase();
                      
                      // Check if this is a required field that should have a value
                      var labelEl = fieldToVerify.closest('label') || 
                                   fieldToVerify.previousElementSibling ||
                                   document.querySelector('label[for="' + (fieldToVerify.id || '') + '"]');
                      var labelText = '';
                      if (labelEl) {
                        labelText = (labelEl.textContent || '').toLowerCase();
                      }
                      
                      var isRequired = labelText.indexOf('*') > -1 || 
                                     fieldToVerify.required ||
                                     fieldToVerify.getAttribute('aria-required') === 'true';
                      
                      // Check if it's a field we filled (name, email, etc.)
                      var isFieldWeFilled = (fieldName.indexOf('name') > -1 && fieldName !== 'lastname' && fieldName !== 'firstname') ||
                                           fieldName.indexOf('email') > -1 ||
                                           fieldPlaceholder.indexOf('name') > -1 ||
                                           fieldPlaceholder.indexOf('email') > -1 ||
                                           labelText.indexOf('name') > -1 ||
                                           labelText.indexOf('email') > -1;
                      
                      if (isRequired && isFieldWeFilled && !fieldValue) {
                        console.log('[Luma Auto Register] ⚠️ Field was cleared by React: ' + (labelText || fieldName || fieldPlaceholder));
                        fieldsStillFilled = false;
                        // Re-fill the field
                        if (fieldName.indexOf('email') > -1 || fieldPlaceholder.indexOf('email') > -1 || labelText.indexOf('email') > -1) {
                          if (settings.email) {
                            fieldToVerify.value = settings.email;
                            fieldToVerify.dispatchEvent(new Event('input', { bubbles: true }));
                            fieldToVerify.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log('[Luma Auto Register] ✓ Re-filled email field');
                          }
                        } else if (fieldName.indexOf('name') > -1 || fieldPlaceholder.indexOf('name') > -1 || labelText.indexOf('name') > -1) {
                          var fullName = '';
                          if (settings.firstName && settings.lastName) {
                            fullName = settings.firstName + ' ' + settings.lastName;
                          } else if (settings.firstName) {
                            fullName = settings.firstName;
                          } else if (settings.lastName) {
                            fullName = settings.lastName;
                          }
                          if (fullName) {
                            fieldToVerify.value = fullName;
                            fieldToVerify.dispatchEvent(new Event('input', { bubbles: true }));
                            fieldToVerify.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log('[Luma Auto Register] ✓ Re-filled name field');
                          }
                        }
                      }
                    }
                    
                    if (!fieldsStillFilled) {
                      console.log('[Luma Auto Register] Some fields were cleared, waiting additional 500ms for React to process re-filled values...');
                      setTimeout(function() {
                        proceedToSubmitButtonSearch();
                      }, 500);
                      return;
                    }
                    
                    proceedToSubmitButtonSearch();
                    
                    function proceedToSubmitButtonSearch() {
                      // Check terms checkbox before looking for submit button (when no dropdowns to process)
                    if (termsCheckbox) {
                      var isRequired = false;
                      var termsLabelEl = termsCheckbox.closest('label') || 
                                       document.querySelector('label[for="' + (termsCheckbox.id || '') + '"]') ||
                                       termsCheckbox.previousElementSibling;
                      if (termsLabelEl) {
                        var termsLabel = (termsLabelEl.textContent || termsLabelEl.innerText || '').toLowerCase();
                        if (termsLabel.indexOf('*') > -1 || (termsLabelEl.innerHTML || '').indexOf('*') > -1) {
                          isRequired = true;
                        }
                      }
                      
                      if (isRequired || settings.autoAcceptTerms) {
                        console.log('[Luma Auto Register] === ACCEPTING TERMS (no dropdowns) ===');
                        if (!termsCheckbox.checked) {
                          console.log('[Luma Auto Register] Checking terms checkbox via helper (no dropdowns immediate path)');
                          reliablyCheckCheckbox(termsCheckbox, 'terms checkbox');
                        } else {
                          console.log('[Luma Auto Register] ✓ Terms checkbox already checked');
                        }
                      }
                    }
                    
                    checkForTermsModalAndWait(function() {
                    console.log('[Luma Auto Register] === LOOKING FOR SUBMIT BUTTON ===');
                  
                  // First try to find buttons in modals/dialogs (they're usually the submit buttons we want)
                  var modalButtons = document.querySelectorAll('[role="dialog"] button, .modal button, [class*="modal"] button');
                  var allButtons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
                  
                  console.log('[Luma Auto Register] Found ' + modalButtons.length + ' modal buttons, ' + allButtons.length + ' total buttons');
                  
                  var submitBtn = null;
                  var submitKeywords = ['request to join', 'submit', 'register', 'confirm', 'rsvp', 'join', 'continue', 'next', 'send'];
                  
                  // Function to check if button matches our criteria
                  function checkButton(btn, index, source) {
                    var text = btn.textContent.toLowerCase().trim();
                    var ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    var title = (btn.getAttribute('title') || '').toLowerCase();
                    var type = btn.type || '';
                    var disabled = btn.disabled ? ' [DISABLED]' : '';
                    var visible = btn.offsetParent !== null ? ' [VISIBLE]' : ' [HIDDEN]';
                    
                    // Combine all text sources
                    var allText = text + ' ' + ariaLabel + ' ' + title;
                    
                    console.log('[Luma Auto Register] ' + source + ' Button ' + index + ': "' + text + '"' + 
                                ' aria="' + ariaLabel + '" title="' + title + '"' + disabled + visible + ' (type: ' + type + ')');
                    
                    // Check if button text/label contains any submit keywords
                    for (var k = 0; k < submitKeywords.length; k++) {
                      if (allText.indexOf(submitKeywords[k]) > -1 || type === 'submit') {
                        // Check if visible and not disabled
                        if (btn.offsetParent !== null && !btn.disabled) {
                          // Prefer buttons with actual text over empty buttons
                          if (text.length > 0 || ariaLabel.length > 0 || type === 'submit') {
                            console.log('[Luma Auto Register] ✓✓✓ MATCHED KEYWORD: "' + submitKeywords[k] + '" or type=submit');
                            return btn;
                          }
                        } else if (btn.disabled) {
                          console.log('[Luma Auto Register] ⚠️ Matched but disabled: "' + (text || ariaLabel || type) + '"');
                        } else {
                          console.log('[Luma Auto Register] ⚠️ Matched but hidden: "' + (text || ariaLabel || type) + '"');
                        }
                      }
                    }
                    return null;
                  }
                  
                  // First check modal buttons (highest priority)
                  console.log('[Luma Auto Register] Checking modal buttons first...');
                  var bestButton = null;
                  var bestButtonScore = 0; // Prefer buttons with text over empty ones
                  
                  for (var i = 0; i < modalButtons.length; i++) {
                    var found = checkButton(modalButtons[i], i, 'MODAL');
                    if (found) {
                      // Score the button - prefer ones with text
                      var text = found.textContent.trim();
                      var ariaLabel = found.getAttribute('aria-label') || '';
                      var score = text.length + ariaLabel.length;
                      if (found.type === 'submit') score += 10; // Bonus for submit type
                      
                      if (score > bestButtonScore) {
                        bestButton = found;
                        bestButtonScore = score;
                        console.log('[Luma Auto Register] New best button with score: ' + score);
                      }
                    }
                  }
                  
                  submitBtn = bestButton;
                  
                  // If not found in modal, check all buttons
                  if (!submitBtn) {
                    console.log('[Luma Auto Register] No modal button found, checking all buttons...');
                    for (var i = 0; i < allButtons.length; i++) {
                      var found = checkButton(allButtons[i], i, 'ALL');
                      if (found) {
                        submitBtn = found;
                        break;
                      }
                    }
                  }
                  
                  if (!submitBtn) {
                    console.log('[Luma Auto Register] ✗✗✗ NO SUBMIT BUTTON FOUND');
                    console.log('[Luma Auto Register] This might be a one-click registration, checking status...');
                    
                    // Check if auto-registered
                    setTimeout(function() {
                      var bodyText = document.body.textContent;
                      var bodyTextLower = bodyText.toLowerCase();
                      var success = bodyTextLower.indexOf("you're going") > -1 ||
                                    bodyTextLower.indexOf("you're registered") > -1 ||
                                    bodyTextLower.indexOf("you're in") > -1 ||
                                    bodyTextLower.indexOf("pending approval") > -1 ||
                                    bodyTextLower.indexOf("registration confirmed") > -1 ||
                                    bodyTextLower.indexOf("we will let you know when the host approves") > -1 ||
                                    bodyTextLower.indexOf("thank you for joining") > -1 ||
                                    bodyTextLower.indexOf("thanks for joining") > -1;
                      
                      if (success) {
                        console.log('[Luma Auto Register] ✓ Auto-registered successfully!');
                        resolve({ 
                          success: true,
                          message: 'Registered successfully (one-click)'
                        });
                      } else {
                        console.log('[Luma Auto Register] ✗ No submit button and not auto-registered');
                        resolve({ 
                          success: false, 
                          message: 'Could not find submit button - please register manually' 
                        });
                      }
                    }, 2000);
                    return;
                  }
                  
                  // FOUND THE SUBMIT BUTTON!
                  console.log('[Luma Auto Register] ✓✓✓ FOUND SUBMIT BUTTON: "' + submitBtn.textContent.trim() + '"');
                  console.log('[Luma Auto Register] Button disabled status: ' + submitBtn.disabled);
                  
                  // Check if button is disabled - if so, wait a bit for it to enable
                  if (submitBtn.disabled) {
                    console.log('[Luma Auto Register] Button IS disabled, entering disabled handler...');
                    console.log('[Luma Auto Register] ⚠️ Button is disabled, waiting 1.5 seconds for validation...');
                    setTimeout(function() {
                      if (submitBtn.disabled) {
                        console.log('[Luma Auto Register] ✗ Button still disabled after waiting');
                        resolve({
                          success: false,
                          message: 'Submit button disabled - form validation may have failed'
                        });
                        return;
                      }
                      
                      // Check for terms modal before submitting (only if not already handled)
                      if (typeof window === 'undefined' || !window.__lumaTermsModalHandled) {
                        if (handleTermsModal(function() {
                          // After terms modal is handled, try submitting again
                          var submitBtn2 = document.querySelector('button[type="submit"], button:not([type])');
                          var submitText2 = submitBtn2 ? submitBtn2.textContent.toLowerCase() : '';
                          if (submitText2.indexOf('request to join') > -1 || 
                              submitText2.indexOf('submit') > -1 ||
                              submitText2.indexOf('register') > -1) {
                            console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON (after terms) ===');
                            submitBtn2.click();
                            submitBtn2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            submitBtn2.dispatchEvent(new Event('submit', { bubbles: true }));
                          }
                        })) {
                          return; // Terms modal was found and handled, don't proceed with normal submit
                        }
                      }
                      
                      // Button is now enabled, click it!
                      console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON ===');
                      console.log('[Luma Auto Register] Button text: "' + submitBtn.textContent + '"');
                      console.log('[Luma Auto Register] Button aria-label: "' + (submitBtn.getAttribute('aria-label') || 'none') + '"');
                      console.log('[Luma Auto Register] Button type: ' + (submitBtn.type || 'none'));
                      
                      // Try multiple click methods
                      submitBtn.click();
                      submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                      submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                      
                      console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                      
                      // Wait for submission to process
                      setTimeout(function() {
                        console.log('[Luma Auto Register] === CHECKING REGISTRATION RESULT ===');
                        var bodyText = document.body.textContent;
                        
                        // Check for validation errors - prioritize red borders (most reliable)
                        var hasValidationErrors = false;
                        var fieldsWithErrors = []; // Store actual input elements, not just labels
                        
                        // First, find ALL inputs with red borders (most reliable indicator)
                        var allInputs = document.querySelectorAll('input, [role="combobox"], [role="listbox"], textarea');
                        for (var inp = 0; inp < allInputs.length; inp++) {
                          var inpEl = allInputs[inp];
                          if (!inpEl.offsetParent || inpEl.disabled) continue; // Skip hidden/disabled
                          
                          var style = window.getComputedStyle(inpEl);
                          var borderColor = style.borderColor || '';
                          var borderWidth = parseFloat(style.borderWidth) || 0;
                          
                          // Check for red border (common validation error indicator)
                          var hasRedBorder = false;
                          if (borderWidth > 0) {
                            // Check various red color formats
                            if (borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                borderColor.indexOf('rgb(220, 38, 38)') > -1 ||
                                borderColor.indexOf('rgb(185, 28, 28)') > -1 ||
                                borderColor.indexOf('#ef4444') > -1 ||
                                borderColor.indexOf('#dc2626') > -1 ||
                                borderColor.indexOf('#b91c1c') > -1 ||
                                borderColor.toLowerCase().indexOf('red') > -1) {
                              hasRedBorder = true;
                            }
                          }
                          
                          // Also check for aria-invalid
                          var ariaInvalid = inpEl.getAttribute('aria-invalid') === 'true';
                          
                          if (hasRedBorder || ariaInvalid) {
                            // Get the label for this field
                            var inpLabel = '';
                            var inpLabelEl = inpEl.closest('label') || 
                                            inpEl.previousElementSibling ||
                                            document.querySelector('label[for="' + (inpEl.id || '') + '"]');
                            
                            // Also check parent container for label text
                            if (!inpLabelEl || !inpLabelEl.textContent) {
                              var parent = inpEl.closest('div, form, section');
                              if (parent) {
                                var labelText = parent.querySelector('label, [class*="label"]');
                                if (labelText) inpLabelEl = labelText;
                              }
                            }
                            
                            if (inpLabelEl) {
                              inpLabel = (inpLabelEl.textContent || '').trim();
                            }
                            
                            // Check if this field already has a value (skip if it does)
                            var hasValue = (inpEl.value || '').trim().length > 0;
                            var placeholder = (inpEl.placeholder || '').trim();
                            // For dropdowns, empty value with placeholder is still considered "empty"
                            if (placeholder && placeholder.indexOf('select') > -1 && !hasValue) {
                              hasValue = false;
                            }
                            
                            if (!hasValue && inpEl) {
                              fieldsWithErrors.push({
                                element: inpEl,
                                label: inpLabel,
                                hasRedBorder: hasRedBorder,
                                ariaInvalid: ariaInvalid
                              });
                              console.log('[Luma Auto Register] ⚠️ Found field with validation error: ' + inpLabel + ' (red border: ' + hasRedBorder + ', aria-invalid: ' + ariaInvalid + ')');
                              hasValidationErrors = true;
                            }
                          }
                        }
                        
                        // Also look for error messages near inputs (secondary check)
                        var errorMessages = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="invalid"], [class*="Invalid"]');
                        for (var err = 0; err < errorMessages.length; err++) {
                          var errEl = errorMessages[err];
                          var errText = (errEl.textContent || '').toLowerCase();
                          if (errText.indexOf('this field is required') > -1 || 
                              errText.indexOf('field is required') > -1) {
                            // Find the associated input field
                            var inputField = errEl.closest('div, form, section')?.querySelector('input, [role="combobox"], textarea');
                            if (inputField && inputField.offsetParent && !inputField.disabled) {
                              // Check if we already found this field
                              var alreadyFound = false;
                              for (var f = 0; f < fieldsWithErrors.length; f++) {
                                if (fieldsWithErrors[f].element === inputField) {
                                  alreadyFound = true;
                                  break;
                                }
                              }
                              
                              if (!alreadyFound) {
                                var fieldLabel = '';
                                var labelEl = inputField.closest('label') || 
                                             inputField.previousElementSibling ||
                                             document.querySelector('label[for="' + (inputField.id || '') + '"]');
                                if (labelEl) {
                                  fieldLabel = (labelEl.textContent || '').trim();
                                }
                                
                                var hasValue = (inputField.value || '').trim().length > 0;
                                if (!hasValue) {
                                  fieldsWithErrors.push({
                                    element: inputField,
                                    label: fieldLabel,
                                    hasRedBorder: false,
                                    ariaInvalid: false
                                  });
                                  console.log('[Luma Auto Register] ⚠️ Found field with error message: ' + fieldLabel);
                                  hasValidationErrors = true;
                                }
                              }
                            }
                          }
                        }
                        
                        // If validation errors found, try to fill missing fields
                        if (hasValidationErrors && fieldsWithErrors.length > 0) {
                          var missingFieldLabels = fieldsWithErrors.map(function(f) { return f.label; });
                          console.log('[Luma Auto Register] ⚠️ Validation errors detected! Missing fields: ' + missingFieldLabels.join(', '));
                          console.log('[Luma Auto Register] === RE-SCANNING FOR MISSING FIELDS ===');
                          
                          var newDropdowns = [];
                          
                          // First, process all fields that have validation errors (red borders)
                          for (var fe = 0; fe < fieldsWithErrors.length; fe++) {
                            var fieldError = fieldsWithErrors[fe];
                            var input = fieldError.element;
                            
                            if (!input || !input.offsetParent || input.disabled) continue;
                            
                            var inputPlaceholder = (input.placeholder || '').toLowerCase();
                            var inputLabel = fieldError.label.toLowerCase();
                            
                            // Check if this is a dropdown
                            var looksLikeDropdown = inputPlaceholder.indexOf('select') > -1 || 
                                                   inputPlaceholder.indexOf('choose') > -1 ||
                                                   inputLabel.indexOf('select') > -1 ||
                                                   inputLabel.indexOf('choose') > -1 ||
                                                   input.getAttribute('role') === 'combobox' ||
                                                   input.getAttribute('role') === 'listbox';
                            
                            // Check if already processed
                            var alreadyProcessed = false;
                            for (var p = 0; p < customDropdownsToProcess.length; p++) {
                              if (customDropdownsToProcess[p].element === input) {
                                alreadyProcessed = true;
                                break;
                              }
                            }
                            
                            if (looksLikeDropdown && !alreadyProcessed) {
                              console.log('[Luma Auto Register] Found missing dropdown with error: ' + fieldError.label + ' (placeholder: "' + inputPlaceholder + '")');
                              newDropdowns.push({
                                element: input,
                                label: inputLabel,
                                isMultiSelect: inputPlaceholder.indexOf('select one or more') > -1 || 
                                             inputPlaceholder.indexOf('select multiple') > -1
                              });
                            }
                          }
                          
                          // Also scan all inputs to catch any we might have missed
                          var allFormInputs = document.querySelectorAll('input[type="text"], input:not([type]), input[type=""]');
                          for (var d = 0; d < allFormInputs.length; d++) {
                            var input = allFormInputs[d];
                            if (!input.offsetParent || input.disabled) continue;
                            
                            var inputPlaceholder = (input.placeholder || '').toLowerCase();
                            var inputLabel = '';
                            var labelEl = input.closest('label') || 
                                         input.previousElementSibling ||
                                         document.querySelector('label[for="' + (input.id || '') + '"]');
                            if (labelEl) {
                              inputLabel = (labelEl.textContent || '').toLowerCase();
                            }
                            
                            var looksLikeDropdown = inputPlaceholder.indexOf('select') > -1 || 
                                                   inputPlaceholder.indexOf('choose') > -1;
                            var isRequired = inputLabel.indexOf('*') > -1 || 
                                            inputPlaceholder.indexOf('select one or more') > -1 ||
                                            input.getAttribute('aria-required') === 'true';
                            
                            var style = window.getComputedStyle(input);
                            var hasError = style.borderColor && (style.borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                                                  style.borderColor.indexOf('red') > -1);
                            
                            if (looksLikeDropdown && (isRequired || hasError)) {
                              var alreadyProcessed = false;
                              for (var p = 0; p < customDropdownsToProcess.length; p++) {
                                if (customDropdownsToProcess[p].element === input) {
                                  alreadyProcessed = true;
                                  break;
                                }
                              }
                              
                              if (!alreadyProcessed) {
                                console.log('[Luma Auto Register] Found missing dropdown: ' + inputLabel + ' (placeholder: "' + inputPlaceholder + '")');
                                newDropdowns.push({
                                  element: input,
                                  label: inputLabel,
                                  isMultiSelect: inputPlaceholder.indexOf('select one or more') > -1
                                });
                              }
                            }
                          }
                          
                          if (newDropdowns.length > 0) {
                            console.log('[Luma Auto Register] Processing ' + newDropdowns.length + ' missing dropdown(s)...');
                            for (var nd = 0; nd < newDropdowns.length; nd++) {
                              customDropdownsToProcess.push(newDropdowns[nd]);
                            }
                            
                            (function processNewDropdown(index) {
                              if (index >= newDropdowns.length) {
                                console.log('[Luma Auto Register] All missing dropdowns processed, waiting before re-submitting...');
                                setTimeout(function() {
                                  var submitBtn = document.querySelector('button[type="submit"], button:not([type])');
                                  var submitText = submitBtn ? submitBtn.textContent.toLowerCase() : '';
                                  if (submitText.indexOf('request to join') > -1 || 
                                      submitText.indexOf('submit') > -1 ||
                                      submitText.indexOf('register') > -1) {
                                    console.log('[Luma Auto Register] Re-submitting form...');
                                    submitBtn.click();
                                    submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                    
                                    setTimeout(function() {
                                      var bodyText = document.body.textContent || '';
                                      // Normalize for case and curly apostrophes
                                      var bodyTextLower = bodyText
                                        .toLowerCase()
                                        .replace(/[\u2018\u2019\u201B]/g, "'");
                                      var successPhrases = [
                                        "you're in", "you're going", "you're registered",
                                        "you are registered", "already registered",
                                        "registration confirmed", "request sent", "pending approval",
                                        "approval required", "request pending",
                                        "we will let you know when the host approves",
                                        "you're on the waitlist", "youre on the waitlist", "on the waitlist",
                                        "thank you for joining", "thanks for joining"
                                      ];
                                      var success = false;
                                      for (var i = 0; i < successPhrases.length; i++) {
                                        if (bodyTextLower.indexOf(successPhrases[i]) > -1) {
                                          success = true;
                                          break;
                                        }
                                      }
                                      if (success) {
                                        resolve({ success: true, message: 'Registered successfully after filling missing fields' });
                                      } else {
                                        resolve({ success: false, message: 'Still has validation errors - please verify manually' });
                                      }
                                    }, 3000);
                                  } else {
                                    resolve({ success: false, message: 'Could not find submit button for re-submission' });
                                  }
                                }, 1000);
                                return;
                              }
                              
                              var dropdownInfo = newDropdowns[index];
                              var dropdown = dropdownInfo.element;
                              console.log('[Luma Auto Register] Processing missing dropdown: ' + dropdownInfo.label);
                              
                              try {
                                dropdown.click();
                                setTimeout(function() {
                                  var menuWrapper = document.querySelector('[class*="lux-menu-wrapper"], [class*="menu-wrapper"], [role="listbox"]');
                                  if (menuWrapper) {
                                    var menuOptions = menuWrapper.querySelectorAll('[class*="lux-menu-item"], [role="option"]');
                                    if (menuOptions.length > 0) {
                                      var firstOption = menuOptions[0];
                                      var optionText = (firstOption.textContent || firstOption.innerText || '').trim();
                                      firstOption.click();
                                      firstOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                      firstOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                                      firstOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                      console.log('[Luma Auto Register] ✓ Selected option in missing dropdown: "' + optionText + '"');
                                      
                                      // For multi-select, close the menu
                                      if (dropdownInfo.isMultiSelect) {
                                        setTimeout(function() {
                                          var escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true });
                                          document.dispatchEvent(escapeEvent);
                                          dropdown.dispatchEvent(escapeEvent);
                                        }, 200);
                                      }
                                      
                                      // Trigger events on dropdown
                                      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                                      dropdown.dispatchEvent(new Event('input', { bubbles: true }));
                                      
                                      setTimeout(function() {
                                        processNewDropdown(index + 1);
                                      }, dropdownInfo.isMultiSelect ? 700 : 500);
                                    } else {
                                      processNewDropdown(index + 1);
                                    }
                                  } else {
                                    processNewDropdown(index + 1);
                                  }
                                }, 500);
                              } catch (error) {
                                console.log('[Luma Auto Register] Error processing dropdown: ' + error);
                                processNewDropdown(index + 1);
                              }
                            })(0);
                            
                            return;
                          }
                        }
                        
                        // Success indicators (case-insensitive) - Only actual registration status messages
                        // Normalize text to handle curly apostrophes (You’re → You're)
                        var bodyTextLower = (bodyText || '')
                          .toLowerCase()
                          .replace(/[\u2018\u2019\u201B]/g, "'");
                        var successPhrases = [
                          "you're in",                    // Confirmed registration
                          "you're going",                 // Confirmed registration
                          "you're registered",            // Confirmed registration
                          "you are registered",           // Alternate wording
                          "already registered",           // Already registered is still success
                          "registration confirmed",       // Confirmed registration
                          "registration successful",      // Confirmed registration
                          "successfully registered",      // Confirmed registration
                          "pending approval",             // Registration submitted, awaiting approval
                          "we will let you know when the host approves", // Pending approval message
                          "you're on the waitlist",       // Waitlisted (successful registration to waitlist)
                          "youre on the waitlist",        // Without apostrophe after normalization
                          "on the waitlist",              // Waitlisted
                          "request sent",                 // Registration request submitted
                          "request pending",              // Registration request pending
                          "approval required",            // Registration submitted, approval needed
                          "thank you for joining",        // Confirmed registration (success message)
                          "thanks for joining"            // Confirmed registration (success message)
                        ];
                        
                        var success = false;
                        var foundPhrase = '';
                        for (var i = 0; i < successPhrases.length; i++) {
                          if (bodyTextLower.indexOf(successPhrases[i]) > -1) {
                            success = true;
                            foundPhrase = successPhrases[i];
                            console.log('[Luma Auto Register] ✓✓✓ SUCCESS PHRASE FOUND: "' + foundPhrase + '"');
                            break;
                          }
                        }
                        
                        if (success) {
                          console.log('[Luma Auto Register] ✓✓✓ REGISTRATION SUCCESSFUL!');
                          var message = 'Registered successfully';
                          if (fieldsToFill.length > 0) {
                            message += ' (auto-filled ' + fieldsToFill.length + ' fields)';
                          }
                          resolve({ 
                            success: true, 
                            message: message
                          });
                        } else {
                          console.log('[Luma Auto Register] ✗✗✗ COULD NOT CONFIRM REGISTRATION');
                          console.log('[Luma Auto Register] Page text sample: ' + bodyText.substring(0, 300));
                          var errorMsg = 'Could not confirm registration - please verify manually';
                          if (hasValidationErrors) {
                            errorMsg += ' (validation errors detected)';
                          }
                          resolve({ 
                            success: false, 
                            message: errorMsg
                          });
                        }
                      }, 2500); // Wait 2.5 seconds for submission to complete (reduced from 4000ms)
                    }, 1000); // Wait 1 second for button to enable (reduced from 1500ms)
                    return;
                  }
                  
                  // Button is NOT disabled, proceed to click it
                  console.log('[Luma Auto Register] Button is NOT disabled, proceeding to click...');
                  
                  // Check if terms modal was already handled
                  var termsModalAlreadyHandled = (typeof window !== 'undefined' && window.__lumaTermsModalHandled);
                  console.log('[Luma Auto Register] Terms modal handled flag: ' + termsModalAlreadyHandled);
                  
                  // Store the submitBtn in a closure so any callback can use it
                  var submitBtnToClick = submitBtn;
                  
                  // Check for terms modal before submitting (only if not already handled)
                  if (!termsModalAlreadyHandled) {
                    console.log('[Luma Auto Register] Terms modal not yet handled, checking...');
                    if (handleTermsModal(function() {
                      // After terms modal is handled, click the button we already found
                      console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON (after terms) ===');
                      console.log('[Luma Auto Register] Using previously found button: "' + (submitBtnToClick ? submitBtnToClick.textContent.trim() : 'NOT FOUND') + '"');
                      
                      // Wait a moment for modal to fully close
                      setTimeout(function() {
                        if (submitBtnToClick && submitBtnToClick.offsetParent !== null && !submitBtnToClick.disabled) {
                          console.log('[Luma Auto Register] Clicking submit button (after terms modal closed)...');
                          submitBtnToClick.click();
                          submitBtnToClick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                          submitBtnToClick.dispatchEvent(new Event('submit', { bubbles: true }));
                          console.log('[Luma Auto Register] ✓ Submit button clicked (after terms modal)!');
                        } else {
                          // Fallback: try to find button again
                          console.log('[Luma Auto Register] ⚠️ Previously found button not available, searching again...');
                          var submitBtn2 = document.querySelector('button[type="submit"], button:not([type])');
                          var submitText2 = submitBtn2 ? submitBtn2.textContent.toLowerCase() : '';
                          if (submitText2.indexOf('request to join') > -1 || 
                              submitText2.indexOf('submit') > -1 ||
                              submitText2.indexOf('register') > -1) {
                            console.log('[Luma Auto Register] Found button again, clicking...');
                            submitBtn2.click();
                            submitBtn2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            submitBtn2.dispatchEvent(new Event('submit', { bubbles: true }));
                          }
                        }
                      }, 500); // Wait 500ms for modal to close
                    })) {
                      console.log('[Luma Auto Register] Terms modal was found and is being handled, will click after...');
                      return; // Terms modal was found and handled, callback will handle the click
                    }
                  }
                  
                  // Button is enabled and terms modal already handled (or not needed), click immediately!
                  console.log('[Luma Auto Register] Proceeding to click submit button immediately (termsModalAlreadyHandled: ' + termsModalAlreadyHandled + ')...');
                  console.log('[Luma Auto Register] === CLICKING SUBMIT BUTTON ===');
                  console.log('[Luma Auto Register] Button text: "' + submitBtn.textContent + '"');
                  console.log('[Luma Auto Register] Button aria-label: "' + (submitBtn.getAttribute('aria-label') || 'none') + '"');
                  console.log('[Luma Auto Register] Button type: ' + (submitBtn.type || 'none'));
                  
                  // Try multiple click methods to ensure it works
                  submitBtn.click();
                  submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  submitBtn.dispatchEvent(new Event('submit', { bubbles: true }));
                  
                  console.log('[Luma Auto Register] ✓ Submit button clicked (3 methods)!');
                  
                  // Wait for submission to process - increased delay to let React process the submission
                  // Don't check for validation errors too quickly as React might still be processing
                  setTimeout(function() {
                    console.log('[Luma Auto Register] === CHECKING REGISTRATION RESULT ===');
                    var bodyText = document.body.textContent;
                    
                    // Check for validation errors first (but only after giving React time to process)
                    var validationErrors = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="invalid"], [class*="Invalid"], [aria-invalid="true"]');
                    var errorMessages = document.querySelectorAll('*');
                    var hasValidationErrors = false;
                    var missingFields = [];
                    
                    // Look for "This field is required" or similar error messages
                    for (var err = 0; err < errorMessages.length; err++) {
                      var errEl = errorMessages[err];
                      var errText = (errEl.textContent || '').toLowerCase();
                      if (errText.indexOf('this field is required') > -1 || 
                          errText.indexOf('field is required') > -1 ||
                          errText.indexOf('required') > -1 && errText.indexOf('field') > -1) {
                        hasValidationErrors = true;
                        // Find the associated input field
                        var inputField = errEl.closest('div, form, section')?.querySelector('input[type="text"], input:not([type]), [role="combobox"]');
                        if (inputField) {
                          // Get label for this field
                          var fieldLabel = '';
                          var labelEl = inputField.closest('label') || 
                                       inputField.previousElementSibling ||
                                       document.querySelector('label[for="' + (inputField.id || '') + '"]');
                          if (labelEl) {
                            fieldLabel = (labelEl.textContent || '').trim();
                          }
                          if (fieldLabel && missingFields.indexOf(fieldLabel) === -1) {
                            missingFields.push(fieldLabel);
                            console.log('[Luma Auto Register] ⚠️ Found validation error for field: ' + fieldLabel);
                          }
                        }
                      }
                    }
                    
                    // Also check for red borders on inputs (common validation indicator)
                    var allInputs = document.querySelectorAll('input, [role="combobox"], [role="listbox"]');
                    for (var inp = 0; inp < allInputs.length; inp++) {
                      var inpEl = allInputs[inp];
                      var style = window.getComputedStyle(inpEl);
                      if (style.borderColor && (style.borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                                 style.borderColor.indexOf('red') > -1 ||
                                                 style.borderColor === '#ef4444')) {
                        // Red border indicates validation error
                        var inpLabel = '';
                        var inpLabelEl = inpEl.closest('label') || 
                                        inpEl.previousElementSibling ||
                                        document.querySelector('label[for="' + (inpEl.id || '') + '"]');
                        if (inpLabelEl) {
                          inpLabel = (inpLabelEl.textContent || '').trim();
                        }
                        if (inpLabel && missingFields.indexOf(inpLabel) === -1) {
                          missingFields.push(inpLabel);
                          console.log('[Luma Auto Register] ⚠️ Found field with validation error (red border): ' + inpLabel);
                          hasValidationErrors = true;
                        }
                      }
                    }
                    
                    // If validation errors found, verify fields are actually empty before trying to fill
                    // Sometimes React shows validation errors even when fields are filled (timing issue)
                    if (hasValidationErrors && missingFields.length > 0) {
                      console.log('[Luma Auto Register] ⚠️ Validation errors detected! Missing fields: ' + missingFields.join(', '));
                      
                      // First, verify which fields are actually empty (not just showing errors)
                      var actuallyEmptyFields = [];
                      for (var aef = 0; aef < missingFields.length; aef++) {
                        var missingFieldLabel = missingFields[aef];
                        // Try to find the input for this field
                        var allInputsForCheck = document.querySelectorAll('input, textarea');
                        for (var aic = 0; aic < allInputsForCheck.length; aic++) {
                          var inputForCheck = allInputsForCheck[aic];
                          if (!inputForCheck.offsetParent || inputForCheck.disabled) continue;
                          
                          var labelForCheck = '';
                          var labelElForCheck = inputForCheck.closest('label') || 
                                               inputForCheck.previousElementSibling ||
                                               document.querySelector('label[for="' + (inputForCheck.id || '') + '"]');
                          if (labelElForCheck) {
                            labelForCheck = (labelElForCheck.textContent || '').trim();
                          }
                          
                          if (labelForCheck.toLowerCase().indexOf(missingFieldLabel.toLowerCase()) > -1 ||
                              missingFieldLabel.toLowerCase().indexOf(labelForCheck.toLowerCase()) > -1) {
                            var valueForCheck = (inputForCheck.value || '').trim();
                            if (!valueForCheck || valueForCheck.length === 0) {
                              actuallyEmptyFields.push(missingFieldLabel);
                              console.log('[Luma Auto Register] Field is actually empty: ' + missingFieldLabel);
                            } else {
                              console.log('[Luma Auto Register] Field has value (validation error may be false positive): ' + missingFieldLabel + ' = "' + valueForCheck + '"');
                            }
                            break;
                          }
                        }
                      }
                      
                      if (actuallyEmptyFields.length === 0) {
                        console.log('[Luma Auto Register] All fields have values - validation errors may be false positives, waiting longer before checking result...');
                        // Fields are filled, just wait longer for React to process
                        setTimeout(function() {
                          // Re-check for success
                          var bodyText2 = document.body.textContent || '';
                          var bodyTextLower2 = bodyText2.toLowerCase().replace(/[\u2018\u2019\u201B]/g, "'");
                          var successPhrases2 = [
                            "you're in", "you're going", "you're registered",
                            "you are registered", "already registered",
                            "registration confirmed", "request sent", "pending approval",
                            "approval required", "request pending",
                            "we will let you know when the host approves",
                            "you're on the waitlist", "youre on the waitlist", "on the waitlist",
                            "thank you for joining", "thanks for joining"
                          ];
                          var success2 = false;
                          for (var i2 = 0; i2 < successPhrases2.length; i2++) {
                            if (bodyTextLower2.indexOf(successPhrases2[i2]) > -1) {
                              success2 = true;
                              break;
                            }
                          }
                          if (success2) {
                            resolve({ success: true, message: 'Registered successfully' });
                          } else {
                            resolve({ success: false, message: 'Could not confirm registration - please check manually' });
                          }
                        }, 3000);
                        return;
                      }
                      
                      console.log('[Luma Auto Register] === RE-SCANNING FOR MISSING FIELDS ===');
                      console.log('[Luma Auto Register] Actually empty fields: ' + actuallyEmptyFields.join(', '));
                      
                      // Re-scan for dropdowns that might have been missed
                      var allFormInputs = document.querySelectorAll('input[type="text"], input:not([type]), input[type=""]');
                      var newDropdowns = [];
                      
                      for (var d = 0; d < allFormInputs.length; d++) {
                        var input = allFormInputs[d];
                        if (!input.offsetParent || input.disabled) continue;
                        
                        var inputPlaceholder = (input.placeholder || '').toLowerCase();
                        var inputLabel = '';
                        var labelEl = input.closest('label') || 
                                     input.previousElementSibling ||
                                     document.querySelector('label[for="' + (input.id || '') + '"]');
                        if (labelEl) {
                          inputLabel = (labelEl.textContent || '').toLowerCase();
                        }
                        
                        // Check if this is a dropdown we haven't processed yet
                        var looksLikeDropdown = inputPlaceholder.indexOf('select') > -1 || 
                                               inputPlaceholder.indexOf('choose') > -1;
                        var isRequired = inputLabel.indexOf('*') > -1 || 
                                        inputPlaceholder.indexOf('select one or more') > -1 ||
                                        input.getAttribute('aria-required') === 'true';
                        
                        // Check if field has validation error (red border or error message nearby)
                        var style = window.getComputedStyle(input);
                        var hasError = style.borderColor && (style.borderColor.indexOf('rgb(239, 68, 68)') > -1 || 
                                                              style.borderColor.indexOf('red') > -1);
                        
                        if (looksLikeDropdown && (isRequired || hasError)) {
                          // Check if we already processed this field
                          var alreadyProcessed = false;
                          for (var p = 0; p < customDropdownsToProcess.length; p++) {
                            if (customDropdownsToProcess[p].element === input) {
                              alreadyProcessed = true;
                              break;
                            }
                          }
                          
                          if (!alreadyProcessed) {
                            console.log('[Luma Auto Register] Found missing dropdown: ' + inputLabel + ' (placeholder: "' + inputPlaceholder + '")');
                            newDropdowns.push({
                              element: input,
                              label: inputLabel,
                              isMultiSelect: inputPlaceholder.indexOf('select one or more') > -1
                            });
                          }
                        }
                      }
                      
                      // Process new dropdowns
                      if (newDropdowns.length > 0) {
                        console.log('[Luma Auto Register] Processing ' + newDropdowns.length + ' missing dropdown(s)...');
                        // Add to existing list and process them
                        for (var nd = 0; nd < newDropdowns.length; nd++) {
                          customDropdownsToProcess.push(newDropdowns[nd]);
                        }
                        
                        // Process the new dropdowns
                        (function processNewDropdown(index) {
                          if (index >= newDropdowns.length) {
                            // All new dropdowns processed, try submitting again
                            console.log('[Luma Auto Register] All missing dropdowns processed, waiting before re-submitting...');
                            setTimeout(function() {
                              var submitBtn = document.querySelector('button[type="submit"], button:not([type])');
                              var submitText = submitBtn ? submitBtn.textContent.toLowerCase() : '';
                              if (submitText.indexOf('request to join') > -1 || 
                                  submitText.indexOf('submit') > -1 ||
                                  submitText.indexOf('register') > -1) {
                                console.log('[Luma Auto Register] Re-submitting form...');
                                submitBtn.click();
                                submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                
                                // Check result again after delay
                                setTimeout(function() {
                                  var bodyText = document.body.textContent || '';
                                  var bodyTextLower = bodyText
                                    .toLowerCase()
                                    .replace(/[\u2018\u2019\u201B]/g, "'");
                                  var successPhrases = [
                                    "you're in", "you're going", "you're registered",
                                    "you are registered", "already registered",
                                    "registration confirmed", "request sent", "pending approval",
                                    "approval required", "request pending",
                                    "we will let you know when the host approves",
                                    "you're on the waitlist", "youre on the waitlist", "on the waitlist",
                                    "thank you for joining", "thanks for joining"
                                  ];
                                  var success = false;
                                  for (var i = 0; i < successPhrases.length; i++) {
                                    if (bodyTextLower.indexOf(successPhrases[i]) > -1) {
                                      success = true;
                                      break;
                                    }
                                  }
                                  if (success) {
                                    resolve({ success: true, message: 'Registered successfully after filling missing fields' });
                                  } else {
                                    resolve({ success: false, message: 'Still has validation errors - please verify manually' });
                                  }
                                }, 3000);
                              } else {
                                resolve({ success: false, message: 'Could not find submit button for re-submission' });
                              }
                            }, 1000);
                            return;
                          }
                          
                          var dropdownInfo = newDropdowns[index];
                          var dropdown = dropdownInfo.element;
                          console.log('[Luma Auto Register] Processing missing dropdown: ' + dropdownInfo.label);
                          
                          try {
                            dropdown.click();
                            setTimeout(function() {
                              var menuWrapper = document.querySelector('[class*="lux-menu-wrapper"], [class*="menu-wrapper"], [role="listbox"]');
                              if (menuWrapper) {
                                var menuOptions = menuWrapper.querySelectorAll('[class*="lux-menu-item"], [role="option"]');
                                if (menuOptions.length > 0) {
                                  // Select first option
                                  var firstOption = menuOptions[0];
                                  firstOption.click();
                                  firstOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                  console.log('[Luma Auto Register] ✓ Selected option in missing dropdown');
                                  setTimeout(function() {
                                    processNewDropdown(index + 1);
                                  }, 500);
                                } else {
                                  processNewDropdown(index + 1);
                                }
                              } else {
                                processNewDropdown(index + 1);
                              }
                            }, 500);
                          } catch (error) {
                            console.log('[Luma Auto Register] Error processing dropdown: ' + error);
                            processNewDropdown(index + 1);
                          }
                        })(0);
                        
                        return; // Don't resolve yet, wait for re-submission
                      }
                    }
                    
                    // Success indicators (case-insensitive) - normalize apostrophes
                    var bodyTextLower = (bodyText || '')
                      .toLowerCase()
                      .replace(/[\u2018\u2019\u201B]/g, "'");
                    var successPhrases = [
                      "you're in",
                      "you're going",
                      "you're registered",
                      "you are registered",
                      "already registered",
                      "registration confirmed",
                      "registration successful",
                      "successfully registered",
                      "request sent",
                      "pending approval",
                      "approval required",
                      "request pending",
                      "we will let you know when the host approves",
                      "you're on the waitlist",
                      "youre on the waitlist",
                      "on the waitlist",
                      "thank you for joining",
                      "thanks for joining"
                    ];
                    
                    var success = false;
                    var foundPhrase = '';
                    for (var i = 0; i < successPhrases.length; i++) {
                      if (bodyTextLower.indexOf(successPhrases[i]) > -1) {
                        success = true;
                        foundPhrase = successPhrases[i];
                        console.log('[Luma Auto Register] ✓✓✓ SUCCESS PHRASE FOUND: "' + foundPhrase + '"');
                        break;
                      }
                    }
                    
                    if (success) {
                      console.log('[Luma Auto Register] ✓✓✓ REGISTRATION SUCCESSFUL!');
                      var message = 'Registered successfully';
                      if (fieldsToFill.length > 0) {
                        message += ' (auto-filled ' + fieldsToFill.length + ' fields)';
                      }
                      resolve({ 
                        success: true, 
                        message: message
                      });
                    } else {
                      console.log('[Luma Auto Register] ✗✗✗ COULD NOT CONFIRM REGISTRATION');
                      console.log('[Luma Auto Register] Page text sample: ' + bodyText.substring(0, 300));
                      var errorMsg = 'Could not confirm registration - please verify manually';
                      if (hasValidationErrors) {
                        errorMsg += ' (validation errors detected)';
                      }
                      resolve({ 
                        success: false, 
                        message: errorMsg
                      });
                    }
                  }, 4000); // Wait 4 seconds for submission to complete
                  
                    }); // End of checkForTermsModalAndWait callback
                    } // End of proceedToSubmitButtonSearch function
                  }, fieldsFilledDelay); // Wait for React to process field values before submitting
                } // End of if (customDropdownsToProcess.length === 0) check - only search for submit button if no dropdowns
              } // End of processForm function
              
            } catch (error) {
              console.log('[Luma Auto Register] ✗ ERROR: ' + error.message);
              resolve({ success: false, message: error.message });
            }
          }); // End of Promise
        }
      });
      
      // Race the registration promise against the timeout
      let result;
      let timedOut = false;
      
      try {
        const raceResult = await Promise.race([registrationPromise, timeoutPromise]);
        
        // Check if we timed out
        if (raceResult && raceResult.timeout) {
          timedOut = true;
          
          if (raceResult.cloudflare) {
            // Cloudflare detected, wait for extended timeout
            this.sendLog('info', `  Cloudflare challenge detected - extending timeout to ${CLOUDFLARE_EXTENDED_TIMEOUT / 1000} seconds`);
            const extendedTimeoutPromise = new Promise((resolve) => {
              setTimeout(() => resolve({ timeout: true }), CLOUDFLARE_EXTENDED_TIMEOUT - REGISTRATION_TIMEOUT);
            });
            
            const finalResult = await Promise.race([registrationPromise, extendedTimeoutPromise]);
            
            if (finalResult && finalResult.timeout) {
              // Still timed out even with extended timeout
              event.status = 'failed';
              event.message = `Registration timed out after ${CLOUDFLARE_EXTENDED_TIMEOUT / 1000} seconds (Cloudflare challenge took too long)`;
              this.stats.failed++;
              this.sendLog('error', `✗ Timeout: ${event.title} - Registration took longer than ${CLOUDFLARE_EXTENDED_TIMEOUT / 1000} seconds (Cloudflare challenge)`);
              this.sendLog('info', `  Keeping tab open for manual review...`);
              return; // Exit early, don't process result
            } else {
              // Got result after Cloudflare - use it
              result = finalResult;
            }
          } else {
            // No Cloudflare, timeout reached
            event.status = 'failed';
            event.message = `Registration timed out after ${REGISTRATION_TIMEOUT / 1000} seconds`;
            this.stats.failed++;
            this.sendLog('error', `✗ Timeout: ${event.title} - Registration took longer than ${REGISTRATION_TIMEOUT / 1000} seconds`);
            this.sendLog('info', `  Keeping tab open for manual review...`);
            return; // Exit early, don't process result
          }
        } else {
          // Registration completed before timeout - use the result
          result = raceResult;
        }
      } catch (error) {
        // If there's an error in the race, try to get the registration result anyway
        this.sendLog('warn', `  Error in timeout race: ${error.message}, trying to get registration result...`);
        try {
          result = await registrationPromise;
        } catch (regError) {
          event.status = 'failed';
          event.message = `Registration error: ${regError.message}`;
          this.stats.failed++;
          this.sendLog('error', `✗ Error: ${event.title} - ${regError.message}`);
          return;
        }
      }

      const registrationResult = result[0]?.result;
      
      // Add logging for debugging
      this.sendLog('info', `  Registration result: ${JSON.stringify(registrationResult)}`);
      
      // Normalize the message once for downstream checks
      const rawMsg = (registrationResult && registrationResult.message) || '';
      const msgLower = rawMsg.toLowerCase();
      
      if (!registrationResult) {
        event.status = 'failed';
        event.message = 'No result returned from registration';
        this.stats.failed++;
        this.sendLog('error', `✗ Failed: ${event.title} - No result returned`);
        this.sendLog('error', `  Check browser console on event page for details`);
      } else if (registrationResult.requiresManual) {
        // Event explicitly requires manual information
        event.status = 'manual';
        event.message = registrationResult.message;
        this.stats.manual++;
        this.sendLog('info', `⚠️ Manual Info Required: ${event.title} - ${registrationResult.message}`);
      } else if (
        // If the page/result explicitly says we couldn't confirm registration,
        // always treat this as "manual review" even if some flag erroneously
        // reports success. This is safer than reporting a false success.
        msgLower.indexOf('could not confirm registration') > -1 ||
        msgLower.indexOf('couldn\'t confirm registration') > -1
      ) {
        event.status = 'manual';
        event.message = registrationResult.message;
        this.stats.manual++;
        this.sendLog('info', `⚠️ Manual Review: ${event.title} - ${registrationResult.message}`);
      } else if (registrationResult.success) {
        event.status = 'success';
        this.stats.success++;
        this.sendLog('success', `✓ Registered: ${event.title}`);
      } else {
        event.status = 'failed';
        event.message = registrationResult.message;
        this.stats.failed++;
        this.sendLog('error', `✗ Failed: ${event.title} - ${registrationResult.message}`);
      }
      
      // Remove overlay from the tab when registration completes (success or failure)
      if (tab?.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function() {
              try {
                var overlay = document.getElementById('__lumaAutoRegisterOverlay');
                if (overlay && overlay.parentNode) {
                  overlay.parentNode.removeChild(overlay);
                }
              } catch (e) {}
            }
          });
        } catch (e) {
          // Tab might be closed or script injection failed, ignore
        }
      }
      
      // Wait a bit so user can see the result
      if (event.status === 'success') {
        this.sendLog('info', `  Closing tab in 2 seconds...`);
        await this.sleep(2000);
      } else {
        this.sendLog('info', `  Keeping tab open for manual review...`);
      }
    } catch (error) {
      event.status = 'failed';
      event.message = error.message;
      this.stats.failed++;
      this.sendLog('error', `✗ Error: ${event.title} - ${error.message}`);
      this.sendLog('info', `  Keeping tab open for manual review...`);
    } finally {
      // Only close tab if registration was successful
      // Keep tabs open for failed/manual registrations so user can review
      if (tab?.id) {
        if (event.status === 'success') {
          try {
            await chrome.tabs.remove(tab.id);
            this.activeTabs.delete(tab.id);
          } catch (e) {
            // Tab might already be closed
          }
        } else {
          // Keep tab open, but remove from activeTabs tracking
          // Store tab ID in result so dashboard can show it
          event.tabId = tab.id;
          this.sendLog('info', `  Tab ${tab.id} kept open for: ${event.title}`);
        }
      }
      
      // Add to results
      this.results.push({
        ...event,
        timestamp: new Date().toISOString()
      });
      
      // Send result to dashboard (catch error if dashboard is closed)
      try {
        chrome.runtime.sendMessage({
          type: 'REGISTRATION_RESULT',
          data: {
            ...event,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        // Dashboard is closed, ignore
      }
      
      this.stats.processed++;
      this.stats.pending--;
      
      // Update stats and save
      this.updateStats();
      await this.saveState();
    }
  }

  pauseRegistration() {
    this.paused = true;
    this.sendLog('info', 'Registration paused');
  }

  resumeRegistration() {
    this.paused = false;
    this.sendLog('info', 'Registration resumed');
    this.processQueue();
  }

  stopRegistration() {
    this.processing = false;
    this.paused = false;
    
    // Do NOT close any event tabs on stop; leave them open for review
    // Just clear active tab tracking so the queue won't keep using them
    this.activeTabs.clear();
  
    // Clear badge
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    
    // Show completion notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../icons/icon48.png',
      title: 'Luma Auto Register',
      message: `Registration stopped. Completed: ${this.stats.processed}/${this.stats.total}`,
      priority: 2
    }).catch(() => {}); // Ignore errors
    
    this.sendLog('info', 'Registration stopped');
    this.saveState();
  }

  updateStats() {
    try {
      chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        data: this.stats
      });
    } catch (error) {
      // Dashboard/popup is closed, ignore
    }
  }

  sendLog(level, message) {
    // Send to popup (catch error if popup is closed)
    try {
      chrome.runtime.sendMessage({
        type: 'LOG',
        level: level,
        message: message
      });
    } catch (error) {
      // Popup/dashboard is closed, ignore
    }
    
    // Send browser notifications for important events
    if (this.processing && (level === 'success' || level === 'error')) {
      // Show notification for each registration result
      if (message.includes('Registered:') || message.includes('Failed:')) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '../icons/icon48.png',
          title: 'Luma Auto Register',
          message: message,
          priority: 1,
          silent: false
        }).catch(() => {}); // Ignore errors
      }
    }
    
    // Update badge with progress
    if (this.processing) {
      const progress = `${this.stats.processed}/${this.stats.total}`;
      chrome.action.setBadgeText({ text: progress }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }).catch(() => {});
    }
  }

  async waitForTab(tabId) {
    return new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async saveState() {
    await chrome.storage.local.set({
      queue: this.queue,
      results: this.results,
      stats: this.stats,
      processingState: this.processing ? 'processing' : this.paused ? 'paused' : 'complete'
    });
  }
}

// Initialize
const manager = new RegistrationManager();
manager.init();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_SCAN':
      manager.startScan(message.url);
      break;
    case 'START_SCAN_CURRENT_TAB':
      console.log('[Background] ===== MESSAGE RECEIVED: START_SCAN_CURRENT_TAB =====');
      console.log('[Background] Message tabId:', message.tabId);
      (async () => {
        try {
          console.log('[Background] Inside async function, calling startScanCurrentTab...');
          if (!message.tabId) {
            console.error('[Background] No tabId in message!');
            manager.sendLog('error', 'Error: No tab ID provided in scan request');
            return;
          }
          console.log('[Background] About to call manager.startScanCurrentTab with tabId:', message.tabId);
          await manager.startScanCurrentTab(message.tabId);
          console.log('[Background] manager.startScanCurrentTab completed!');
        } catch (error) {
          console.error('[Background] ERROR in startScanCurrentTab handler:', error);
          console.error('[Background] Error stack:', error.stack);
          manager.sendLog('error', `Scan failed: ${error.message}`);
        }
      })();
      console.log('[Background] Returning true from message handler');
      return true; // Indicate we're handling this asynchronously
    case 'START_REGISTRATION':
      // Get the window ID from the sender (popup/dashboard window)
      // This ensures tabs open in the same window where registration was started
      (async () => {
        let senderWindowId = null;
        
        if (sender && sender.tab) {
          // Dashboard tab - get window from the tab
          try {
            const tab = await chrome.tabs.get(sender.tab.id);
            senderWindowId = tab.windowId;
          } catch (error) {
            // Tab not found, will use fallback
          }
        } else if (sender && sender.id) {
          // Popup - get current window (popup is attached to a window)
          try {
            const currentWindow = await chrome.windows.getCurrent();
            senderWindowId = currentWindow.id;
          } catch (error) {
            // Couldn't get current window, will use fallback
          }
        }
        
        // Start registration with the window ID (or null if we couldn't determine it)
        manager.startRegistration(message.events, message.settings, senderWindowId);
      })();
      break;
    case 'PAUSE_REGISTRATION':
      manager.pauseRegistration();
      break;
    case 'RESUME_REGISTRATION':
      manager.resumeRegistration();
      break;
    case 'STOP_REGISTRATION':
      manager.stopRegistration();
      break;
    case 'CLOUDFLARE_CHALLENGE_DETECTED':
      manager.handleCloudflareChallenge(message.eventTitle);
      break;
    case 'CLOUDFLARE_CHALLENGE_COMPLETED':
      manager.handleCloudflareChallengeCompleted();
      break;
  }
});
