// Popup UI Controller
class PopupController {
  constructor() {
    this.events = [];
    this.filteredEvents = [];
    this.searchQuery = '';
    this.dateFilter = ''; // Selected date filter
    this.availableDates = []; // List of unique dates
    this.state = 'idle'; // idle, scanning, ready, processing, paused, complete
    this.showRegistered = true; // Toggle for showing registered events
    this.registeredAtBottom = false; // Toggle for moving registered events to bottom
    this.newCount = 0;
    this.registeredCount = 0;
    this.trulyNewCount = 0; // Events never seen before (Google Sheets only)
    this.teamRegisteredCount = 0; // Events where team registered but current user hasn't
    this.availableCount = 0; // Events available to register
    this.init();
  }

  init() {
    this.bindElements();
    this.attachEventListeners();
    this.loadState();
    this.startStatusListener();
  }

  bindElements() {
    // Input elements
    this.parallelTabs = document.getElementById('parallelTabs');
    this.delayBetween = document.getElementById('delayBetween');

    // Buttons
    this.openDashboardBtn = document.getElementById('openDashboardBtn');
    this.openSettingsBtn = document.getElementById('openSettingsBtn');
    this.scanBtn = document.getElementById('scanBtn');
    this.selectAllBtn = document.getElementById('selectAllBtn');
    this.deselectAllBtn = document.getElementById('deselectAllBtn');
    this.startBtn = document.getElementById('startBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.resetBtn = document.getElementById('resetBtn');
    this.toggleDebugBtn = document.getElementById('toggleDebugBtn');
    this.clearDebugBtn = document.getElementById('clearDebugBtn');
    this.exportDebugBtn = document.getElementById('exportDebugBtn');
    this.exportDebugBtnMain = document.getElementById('exportDebugBtnMain');
    this.toggleRegisteredBtn = document.getElementById('toggleRegisteredBtn');
    this.moveToBottomBtn = document.getElementById('moveToBottomBtn');
    this.recheckAllBtn = document.getElementById('recheckAllBtn');
    this.failedEventsContainer = document.getElementById('failedEventsContainer');
    this.failedEventsList = document.getElementById('failedEventsList');

    // Sections
    this.eventsSection = document.getElementById('eventsSection');
    this.settingsSection = document.getElementById('settingsSection');
    this.progressSection = document.getElementById('progressSection');
    this.resultsSection = document.getElementById('resultsSection');
    this.debugSection = document.getElementById('debugSection');
    this.eventsSummary = document.getElementById('eventsSummary');

    // Display elements
    this.scanStatus = document.getElementById('scanStatus');
    this.currentUrl = document.getElementById('currentUrl');
    this.eventCount = document.getElementById('eventCount');
    this.eventsList = document.getElementById('eventsList');
    this.eventSearch = document.getElementById('eventSearch');
    this.dateFilterSelect = document.getElementById('dateFilter');
    this.searchCount = document.getElementById('searchCount');
    this.summaryText = document.getElementById('summaryText');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    this.successCount = document.getElementById('successCount');
    this.failedCount = document.getElementById('failedCount');
    this.pendingCount = document.getElementById('pendingCount');
    this.logContainer = document.getElementById('logContainer');
    this.debugContainer = document.getElementById('debugContainer');
  }

  attachEventListeners() {
    this.openDashboardBtn.addEventListener('click', () => this.openDashboard());
    this.openSettingsBtn.addEventListener('click', () => this.openSettings());
    this.scanBtn.addEventListener('click', () => this.handleScan());
    this.selectAllBtn.addEventListener('click', () => this.selectAll(true));
    this.deselectAllBtn.addEventListener('click', () => this.selectAll(false));
    if (this.eventSearch) {
      this.eventSearch.addEventListener('input', (e) => this.handleSearch(e.target.value));
    }
    if (this.dateFilterSelect) {
      this.dateFilterSelect.addEventListener('change', (e) => this.handleDateFilter(e.target.value));
    }
    this.startBtn.addEventListener('click', () => this.handleStart());
    this.pauseBtn.addEventListener('click', () => this.handlePause());
    this.stopBtn.addEventListener('click', () => this.handleStop());
    this.exportBtn.addEventListener('click', () => this.handleExport());
    this.resetBtn.addEventListener('click', () => this.handleReset());
    this.toggleDebugBtn.addEventListener('click', () => this.toggleDebug());
    this.clearDebugBtn.addEventListener('click', () => this.clearDebug());
    if (this.exportDebugBtn) {
      this.exportDebugBtn.addEventListener('click', () => this.exportDebugLogs());
    }
    if (this.exportDebugBtnMain) {
      this.exportDebugBtnMain.addEventListener('click', () => this.exportDebugLogs());
    }
    if (this.toggleRegisteredBtn) {
      this.toggleRegisteredBtn.addEventListener('click', () => this.toggleRegisteredEvents());
    }
    if (this.moveToBottomBtn) {
      this.moveToBottomBtn.addEventListener('click', () => this.toggleRegisteredAtBottom());
    }
    if (this.recheckAllBtn) {
      this.recheckAllBtn.addEventListener('click', () => this.recheckFailedTabs());
    }
  }

  async loadState() {
    const result = await chrome.storage.local.get(['processingState', 'events', 'results']);
    if (result.processingState) {
      this.state = result.processingState;
      this.updateUIForState();
    }
    if (result.events) {
      this.events = result.events;
      this.renderEvents();
    }
  }

  startStatusListener() {
    // Listen for status updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'STATUS_UPDATE') {
        this.updateProgress(message.data);
      } else if (message.type === 'LOG') {
        this.addLog(message.level, message.message);
      } else if (message.type === 'SCAN_COMPLETE') {
        this.handleScanComplete(message.events, message.debug, message.newCount, message.registeredCount, message.teamRegisteredCount);
      } else if (message.type === 'REGISTRATION_RESULT_UPDATE') {
        // A failed/manual event was re-verified or manually marked as registered
        this.handleResultUpdate(message.data);
      } else if (message.type === 'RECHECK_COMPLETE') {
        // Re-check of all failed tabs completed
        this.handleRecheckComplete(message.data);
      }
    });
  }

  async handleScan() {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      this.showStatus('Could not get current tab', 'error');
      return;
    }

    // Check if it's a supported event platform page
    const isSupportedPlatform = tab.url.includes('luma.com') || 
                                 tab.url.includes('lu.ma') || 
                                 tab.url.includes('lemonade.social');
    if (!isSupportedPlatform) {
      this.showStatus('Please navigate to a Luma or Lemonade calendar page first', 'error');
      this.addLog('error', 'Not on a supported event platform page');
      return;
    }

    // Show current URL
    this.currentUrl.textContent = `Scanning: ${tab.url}`;

    this.state = 'scanning';
    this.scanBtn.disabled = true;
    this.showStatus('Scanning current page...', 'info');
    this.addLog('info', 'Starting scan of current page...');

    // Send message to background to scan the current tab
    chrome.runtime.sendMessage({
      type: 'START_SCAN_CURRENT_TAB',
      tabId: tab.id
    });
  }

  openDashboard() {
    // Open dashboard in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('dashboard.html')
    });
  }

  openSettings() {
    // Open settings in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('settings.html')
    });
  }

  handleScanComplete(events, debugInfo, newCount, registeredCount, teamRegisteredCount) {
    this.events = events;
    this.newCount = newCount || events.filter(e => !e.isRegistered).length;
    this.registeredCount = registeredCount || events.filter(e => e.isRegistered).length;
    this.trulyNewCount = events.filter(e => e.isNew).length; // Events never seen before (Google Sheets only)
    this.teamRegisteredCount = teamRegisteredCount || events.filter(e => e.teamRegistered && !e.isRegistered).length; // Team registered but not current user
    this.availableCount = events.filter(e => !e.isRegistered).length; // Events available to register
    this.state = 'ready';
    this.scanBtn.disabled = false;
    
    // Display debug information if available
    if (debugInfo) {
      this.showDebugInfo(debugInfo);
    }
    
    if (events.length === 0) {
      this.showStatus('No events found on this page - check Debug Console for details', 'error');
      this.addLog('error', 'No events found - click "Show Debug Console" for details');
      this.debugSection.style.display = 'block';
      this.toggleDebugBtn.textContent = 'Hide Debug Console';
      return;
    }

    // Populate date filter dropdown
    this.populateDateFilter();

    // Update summary
    this.updateEventsSummary();

    // Build status message based on what data we have
    let statusMsg;
    if (this.trulyNewCount > 0 || this.teamRegisteredCount > 0) {
      // Google Sheets is active - show truly new events and team registrations
      const parts = [];
      if (this.trulyNewCount > 0) parts.push(`${this.trulyNewCount} 🆕 NEW`);
      if (this.teamRegisteredCount > 0) parts.push(`${this.teamRegisteredCount} ⚡ team registered`);
      statusMsg = `Found ${parts.join(', ')}`;
      if (this.registeredCount > 0) {
        statusMsg += `, ${this.registeredCount} ✅ you registered`;
      }
    } else if (this.registeredCount > 0) {
      statusMsg = `Found ${this.availableCount} new events, ${this.registeredCount} already registered`;
    } else {
      statusMsg = `Found ${events.length} events`;
    }
    statusMsg += '!';
    
    this.showStatus(statusMsg, 'success');
    this.addLog('success', statusMsg);
    this.renderEvents();
    this.eventsSection.style.display = 'block';
    this.settingsSection.style.display = 'block';
  }

  populateDateFilter() {
    if (!this.dateFilterSelect) return;
    
    // Extract unique dates from events and sort them
    const dates = new Set();
    this.events.forEach(event => {
      if (event.date) {
        dates.add(event.date);
      }
    });
    
    // Convert to array and sort chronologically
    this.availableDates = Array.from(dates).sort((a, b) => {
      // Parse dates like "Feb 13" to compare them
      const parseDate = (dateStr) => {
        const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 
                        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
        const match = dateStr.match(/([A-Za-z]+)\s*(\d+)/);
        if (match) {
          const month = months[match[1]] || 0;
          const day = parseInt(match[2]) || 1;
          return new Date(2026, month, day); // Use a fixed year for comparison
        }
        return new Date(0);
      };
      return parseDate(a) - parseDate(b);
    });
    
    // Clear and populate dropdown
    this.dateFilterSelect.innerHTML = '<option value="">📅 All Dates</option>';
    this.availableDates.forEach(date => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = date;
      // Count events for this date
      const count = this.events.filter(e => e.date === date).length;
      option.textContent = `${date} (${count})`;
      this.dateFilterSelect.appendChild(option);
    });
  }

  handleDateFilter(date) {
    this.dateFilter = date;
    this.filterEvents();
    this.renderEvents();
  }

  handleSearch(query) {
    this.searchQuery = query.toLowerCase().trim();
    this.filterEvents();
    this.renderEvents();
  }

  filterEvents() {
    let filtered = this.events;
    
    // Filter by search query
    if (this.searchQuery) {
      filtered = filtered.filter(event => 
        event.title.toLowerCase().includes(this.searchQuery) ||
        (event.url && event.url.toLowerCase().includes(this.searchQuery)) ||
        (event.date && event.date.toLowerCase().includes(this.searchQuery))
      );
    }
    
    // Filter by date
    if (this.dateFilter) {
      filtered = filtered.filter(event => event.date === this.dateFilter);
    }
    
    this.filteredEvents = filtered;
  }

  renderEvents() {
    // Always filter events (handles both search and date filter)
    this.filterEvents();

    // Sort by date, optionally with registered events at bottom
    let sortedEvents = [...this.filteredEvents].sort((a, b) => {
      // Parse dates for sorting
      const parseDate = (dateStr) => {
        if (!dateStr) return new Date(9999, 11, 31); // Put events without dates at the end
        const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 
                        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
        const match = dateStr.match(/([A-Za-z]+)\s*(\d+)/);
        if (match) {
          const month = months[match[1]] || 0;
          const day = parseInt(match[2]) || 1;
          return new Date(2026, month, day);
        }
        return new Date(9999, 11, 31);
      };
      
      // If "registered at bottom" is enabled, sort registered events to the end first
      if (this.registeredAtBottom) {
        if (a.isRegistered !== b.isRegistered) {
          return a.isRegistered ? 1 : -1;
        }
      }
      
      // Then sort by date
      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);
      if (dateA.getTime() !== dateB.getTime()) {
        return dateA - dateB;
      }
      
      return 0;
    });

    // Filter out registered events if toggle is off
    if (!this.showRegistered) {
      sortedEvents = sortedEvents.filter(e => !e.isRegistered);
    }

    const totalCount = this.events.length;
    const displayedCount = sortedEvents.length;
    
    this.eventCount.textContent = `${totalCount} events found`;
    
    // Update search/filter count
    if (this.searchCount) {
      const hasFilters = this.searchQuery || this.dateFilter || (!this.showRegistered && this.registeredCount > 0);
      if (hasFilters && displayedCount !== totalCount) {
        let filterText = `Showing ${displayedCount} of ${totalCount}`;
        if (this.dateFilter) {
          filterText += ` • ${this.dateFilter}`;
        }
        this.searchCount.textContent = filterText;
        this.searchCount.style.display = 'block';
      } else {
        this.searchCount.textContent = '';
        this.searchCount.style.display = 'none';
      }
    }

    this.eventsList.innerHTML = '';

    if (sortedEvents.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      let message = 'No events to display';
      if (this.searchQuery && this.dateFilter) {
        message = `No events matching "${this.searchQuery}" on ${this.dateFilter}`;
      } else if (this.searchQuery) {
        message = `No events found matching "${this.searchQuery}"`;
      } else if (this.dateFilter) {
        message = `No events on ${this.dateFilter}`;
      }
      noResults.textContent = message;
      this.eventsList.appendChild(noResults);
      return;
    }

    // Render sorted/filtered events
    sortedEvents.forEach((event) => {
      const originalIndex = this.events.indexOf(event);
      const item = document.createElement('div');
      let itemClass = 'event-item';
      if (event.isRegistered) itemClass += ' registered';
      if (event.isNew) itemClass += ' new-event';
      if (event.teamRegistered && !event.isRegistered) itemClass += ' team-registered';
      item.className = itemClass;
      
      // Build the display title with optional date prefix
      const datePrefix = event.date ? `<span class="event-date">[${event.date}]</span>` : '';
      const registeredBadge = event.isRegistered ? '<span class="registered-badge">✓ Registered</span>' : '';
      const newBadge = event.isNew && !event.isRegistered ? '<span class="new-badge">🆕 NEW</span>' : '';
      
      // Team registered badge - show who registered
      let teamBadge = '';
      if (event.teamRegistered && !event.isRegistered) {
        const teamEmails = event.teamRegistered.map(r => r.email.split('@')[0]).join(', ');
        teamBadge = `<span class="team-badge" title="Registered by: ${event.teamRegistered.map(r => r.email).join(', ')}">⚡ ${teamEmails}</span>`;
      }
      
      item.innerHTML = `
        <input type="checkbox" id="event-${originalIndex}" ${event.selected ? 'checked' : ''}>
        <label for="event-${originalIndex}" class="event-title" title="${event.title}">${datePrefix}${event.title}</label>
        ${newBadge}${teamBadge}${registeredBadge}
      `;
      
      const checkbox = item.querySelector('input');
      checkbox.addEventListener('change', (e) => {
        this.events[originalIndex].selected = e.target.checked;
      });

      this.eventsList.appendChild(item);
    });
  }

  selectAll(selected) {
    // Only select/deselect filtered events if any filter is active
    if ((this.searchQuery || this.dateFilter) && this.filteredEvents.length > 0) {
      this.filteredEvents.forEach(event => {
        if (!event.isRegistered) { // Don't select already registered events
          event.selected = selected;
        }
      });
    } else {
      this.events.forEach(event => {
        if (!event.isRegistered) { // Don't select already registered events
          event.selected = selected;
        }
      });
    }
    this.renderEvents();
  }

  updateEventsSummary() {
    if (!this.eventsSummary) return;
    
    const hasNewEvents = this.trulyNewCount > 0 || this.availableCount > 0;
    
    if (this.registeredCount > 0 || this.trulyNewCount > 0 || this.teamRegisteredCount > 0) {
      this.eventsSummary.style.display = 'flex';
      
      if (this.trulyNewCount > 0 || this.teamRegisteredCount > 0) {
        // Google Sheets mode - show truly new events and team registrations
        let summaryParts = [];
        if (this.trulyNewCount > 0) summaryParts.push(`🆕 ${this.trulyNewCount} NEW`);
        if (this.teamRegisteredCount > 0) summaryParts.push(`⚡ ${this.teamRegisteredCount} team registered`);
        if (this.availableCount > this.trulyNewCount + this.teamRegisteredCount) {
          summaryParts.push(`${this.availableCount - this.trulyNewCount - this.teamRegisteredCount} other`);
        }
        if (this.registeredCount > 0) {
          summaryParts.push(`✓ ${this.registeredCount} you registered`);
        }
        this.summaryText.textContent = summaryParts.join(', ');
        this.summaryText.className = 'summary-text';
        this.eventsSummary.className = 'events-summary has-new';
      } else if (this.availableCount > 0) {
        this.summaryText.textContent = `🆕 ${this.availableCount} new events, ✓ ${this.registeredCount} already registered`;
        this.summaryText.className = 'summary-text';
        this.eventsSummary.className = 'events-summary has-new';
      } else {
        this.summaryText.textContent = `✓ All ${this.registeredCount} events already registered`;
        this.summaryText.className = 'summary-text all-registered';
        this.eventsSummary.className = 'events-summary all-registered';
      }
      
      // Update toggle button text
      if (this.toggleRegisteredBtn) {
        this.toggleRegisteredBtn.textContent = this.showRegistered ? 'Hide Registered' : 'Show Registered';
        this.toggleRegisteredBtn.className = this.showRegistered ? 'toggle-registered-btn active' : 'toggle-registered-btn';
      }
    } else {
      this.eventsSummary.style.display = 'none';
    }
  }

  toggleRegisteredEvents() {
    this.showRegistered = !this.showRegistered;
    this.updateEventsSummary();
    this.renderEvents();
  }

  toggleRegisteredAtBottom() {
    this.registeredAtBottom = !this.registeredAtBottom;
    // Update button appearance
    if (this.moveToBottomBtn) {
      if (this.registeredAtBottom) {
        this.moveToBottomBtn.textContent = '↑ Mixed Order';
        this.moveToBottomBtn.title = 'Show registered events in date order';
      } else {
        this.moveToBottomBtn.textContent = '↓ Move to Bottom';
        this.moveToBottomBtn.title = 'Move registered events to the bottom';
      }
    }
    this.renderEvents();
  }

  async handleStart() {
    // Check if required settings are configured
    const userSettingsResult = await chrome.storage.local.get('userSettings');
    const userSettings = userSettingsResult.userSettings || {};
    
    if (!userSettings.firstName || !userSettings.lastName || !userSettings.email) {
      const missing = [];
      if (!userSettings.firstName) missing.push('First Name');
      if (!userSettings.lastName) missing.push('Last Name');
      if (!userSettings.email) missing.push('Email');
      
      this.showStatus(`⚠️ Missing required settings: ${missing.join(', ')}. Please click the ⚙️ button to configure.`, 'error');
      this.addLog('error', `Cannot start: Missing ${missing.join(', ')} in settings`);
      return;
    }
    
    const selectedEvents = this.events.filter(e => e.selected);
    
    if (selectedEvents.length === 0) {
      this.showStatus('Please select at least one event', 'error');
      return;
    }

    const settings = {
      parallelTabs: parseInt(this.parallelTabs.value),
      delayBetween: parseInt(this.delayBetween.value) * 1000
    };

    this.state = 'processing';
    this.updateUIForState();
    this.addLog('info', `Starting registration for ${selectedEvents.length} events...`);

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'START_REGISTRATION',
      events: selectedEvents,
      settings: settings
    });
  }

  handlePause() {
    if (this.state === 'processing') {
      this.state = 'paused';
      this.pauseBtn.textContent = 'Resume';
      chrome.runtime.sendMessage({ type: 'PAUSE_REGISTRATION' });
      this.addLog('info', 'Registration paused');
    } else if (this.state === 'paused') {
      this.state = 'processing';
      this.pauseBtn.textContent = 'Pause';
      chrome.runtime.sendMessage({ type: 'RESUME_REGISTRATION' });
      this.addLog('info', 'Registration resumed');
    }
  }

  handleStop() {
    this.state = 'complete';
    chrome.runtime.sendMessage({ type: 'STOP_REGISTRATION' });
    this.addLog('info', 'Registration stopped');
    this.updateUIForState();
  }

  updateProgress(data) {
    const { processed, total, success, failed, pending } = data;
    
    // Update progress bar
    const percentage = (processed / total) * 100;
    this.progressFill.style.width = `${percentage}%`;
    this.progressText.textContent = `${processed} / ${total}`;

    // Update counts
    this.successCount.textContent = success;
    this.failedCount.textContent = failed;
    this.pendingCount.textContent = pending;

    // Check if complete
    if (processed >= total) {
      this.state = 'complete';
      this.updateUIForState();
      this.addLog('success', `Registration complete! ${success} succeeded, ${failed} failed`);
      // Render failed events list if there are any failures
      if (failed > 0) {
        this.renderFailedEvents();
      }
    }
  }

  updateUIForState() {
    // Hide all sections first
    this.eventsSection.style.display = 'none';
    this.settingsSection.style.display = 'none';
    this.progressSection.style.display = 'none';
    this.resultsSection.style.display = 'none';

    switch (this.state) {
      case 'idle':
      case 'scanning':
        // Nothing extra to show
        break;
      case 'ready':
        this.eventsSection.style.display = 'block';
        this.settingsSection.style.display = 'block';
        break;
      case 'processing':
      case 'paused':
        this.eventsSection.style.display = 'none';
        this.settingsSection.style.display = 'none';
        this.progressSection.style.display = 'block';
        this.resultsSection.style.display = 'block';
        this.pauseBtn.textContent = this.state === 'paused' ? 'Resume' : 'Pause';
        break;
      case 'complete':
        this.progressSection.style.display = 'none';
        this.resultsSection.style.display = 'block';
        break;
    }
  }

  showStatus(message, type = 'info') {
    this.scanStatus.textContent = message;
    this.scanStatus.style.color = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#6b7280';
  }

  addLog(level, message) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    entry.innerHTML = `
      <span class="log-time">[${time}]</span>
      <span class="log-message">${message}</span>
    `;
    this.logContainer.insertBefore(entry, this.logContainer.firstChild);

    // Keep only last 50 logs
    while (this.logContainer.children.length > 50) {
      this.logContainer.removeChild(this.logContainer.lastChild);
    }
  }

  async handleExport() {
    const result = await chrome.storage.local.get(['results']);
    if (!result.results) {
      this.addLog('error', 'No results to export');
      return;
    }

    const csv = this.generateCSV(result.results);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `luma-registration-results-${Date.now()}.csv`;
    a.click();
    
    this.addLog('success', 'Results exported');
  }

  generateCSV(results) {
    let csv = 'Event Title,Event URL,Status,Message,Timestamp\n';
    results.forEach(result => {
      csv += `"${result.title}","${result.url}","${result.status}","${result.message || ''}","${result.timestamp}"\n`;
    });
    return csv;
  }

  async handleReset() {
    // Clear storage
    await chrome.storage.local.clear();
    
    // Reset state
    this.events = [];
    this.state = 'idle';
    this.currentUrl.textContent = '';
    this.updateUIForState();
    this.eventsList.innerHTML = '';
    this.logContainer.innerHTML = '';
    this.debugContainer.innerHTML = '';
    this.showStatus('', 'info');
    this.addLog('info', 'Reset complete');
  }

  showDebugInfo(debugInfo) {
    this.debugContainer.innerHTML = '';
    
    // Total links
    this.addDebugItem('Total Links on Page', debugInfo.totalLinks || 0);
    this.addDebugItem('Luma Links Found', debugInfo.lumaLinks || 0);
    this.addDebugItem('Events Extracted', debugInfo.foundEvents?.length || 0);
    this.addDebugItem('Links Filtered Out', debugInfo.filteredOut?.length || 0);
    
    // Show found events
    if (debugInfo.foundEvents && debugInfo.foundEvents.length > 0) {
      const eventsDiv = document.createElement('div');
      eventsDiv.className = 'debug-item';
      eventsDiv.innerHTML = '<div class="debug-label">Found Events:</div>';
      debugInfo.foundEvents.slice(0, 5).forEach(event => {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'debug-value';
        eventDiv.textContent = `${event.title} (${event.eventId})`;
        eventsDiv.appendChild(eventDiv);
      });
      if (debugInfo.foundEvents.length > 5) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'debug-value';
        moreDiv.textContent = `... and ${debugInfo.foundEvents.length - 5} more`;
        eventsDiv.appendChild(moreDiv);
      }
      this.debugContainer.appendChild(eventsDiv);
    }
    
    // Show filtered out reasons
    if (debugInfo.filteredOut && debugInfo.filteredOut.length > 0) {
      const filteredDiv = document.createElement('div');
      filteredDiv.className = 'debug-item';
      filteredDiv.innerHTML = '<div class="debug-label">Filtered Out (first 5):</div>';
      debugInfo.filteredOut.slice(0, 5).forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'debug-value';
        itemDiv.textContent = `${item.reason}: ${item.href.substring(0, 50)}...`;
        filteredDiv.appendChild(itemDiv);
      });
      this.debugContainer.appendChild(filteredDiv);
    }
  }

  addDebugItem(label, value) {
    const item = document.createElement('div');
    item.className = 'debug-item';
    item.innerHTML = `
      <div class="debug-label">${label}:</div>
      <div class="debug-value">${value}</div>
    `;
    this.debugContainer.appendChild(item);
  }

  toggleDebug() {
    if (this.debugSection.style.display === 'none') {
      this.debugSection.style.display = 'block';
      this.toggleDebugBtn.textContent = 'Hide Debug Console';
    } else {
      this.debugSection.style.display = 'none';
      this.toggleDebugBtn.textContent = 'Show Debug Console';
    }
  }

  clearDebug() {
    this.debugContainer.innerHTML = '';
    this.addLog('info', 'Debug console cleared');
  }

  // Render failed/manual events list with action buttons
  async renderFailedEvents() {
    if (!this.failedEventsList || !this.failedEventsContainer) return;
    
    // Get results from storage
    const result = await chrome.storage.local.get(['results']);
    const results = result.results || [];
    
    // Filter for failed and manual events
    const failedEvents = results.filter(r => r.status === 'failed' || r.status === 'manual');
    
    if (failedEvents.length === 0) {
      this.failedEventsContainer.style.display = 'none';
      return;
    }
    
    this.failedEventsContainer.style.display = 'block';
    this.failedEventsList.innerHTML = '';
    
    failedEvents.forEach((event, index) => {
      const item = document.createElement('div');
      item.className = `failed-event-item ${event.status === 'manual' ? 'manual' : ''}`;
      item.dataset.url = event.url;
      item.dataset.tabId = event.tabId || '';
      
      const statusIcon = event.status === 'manual' ? '⚠️' : '❌';
      const statusText = event.status === 'manual' ? 'Manual review needed' : event.message || 'Failed';
      
      item.innerHTML = `
        <div class="failed-event-info">
          <div class="failed-event-title" title="${event.title}">${statusIcon} ${event.title}</div>
          <div class="failed-event-status">${statusText}</div>
        </div>
        <div class="failed-event-actions">
          ${event.tabId ? `<button class="btn-recheck-single" data-url="${event.url}" data-tab-id="${event.tabId}" title="Re-check this tab for registration success">🔄</button>` : ''}
          <button class="btn-mark-registered" data-url="${event.url}" data-tab-id="${event.tabId || ''}" title="Manually mark as registered">✓ Mark Done</button>
        </div>
      `;
      
      this.failedEventsList.appendChild(item);
    });
    
    // Add event listeners for action buttons
    this.failedEventsList.querySelectorAll('.btn-recheck-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = e.target.dataset.url;
        const tabId = parseInt(e.target.dataset.tabId);
        this.recheckSingleTab(url, tabId);
      });
    });
    
    this.failedEventsList.querySelectorAll('.btn-mark-registered').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = e.target.dataset.url;
        const tabId = e.target.dataset.tabId ? parseInt(e.target.dataset.tabId) : null;
        this.markAsRegistered(url, tabId);
      });
    });
  }
  
  // Re-check all failed tabs
  async recheckFailedTabs() {
    if (this.recheckAllBtn) {
      this.recheckAllBtn.disabled = true;
      this.recheckAllBtn.textContent = '🔄 Checking...';
    }
    
    this.addLog('info', 'Re-checking all failed/manual tabs...');
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RECHECK_FAILED_TABS' });
      
      if (response && response.success) {
        this.addLog('success', `Re-check complete: ${response.updated} of ${response.total} events updated to success`);
      } else {
        this.addLog('error', `Re-check failed: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.addLog('error', `Re-check error: ${error.message}`);
    } finally {
      if (this.recheckAllBtn) {
        this.recheckAllBtn.disabled = false;
        this.recheckAllBtn.textContent = '🔄 Re-check All Tabs';
      }
      // Refresh the failed events list
      await this.renderFailedEvents();
    }
  }
  
  // Re-check a single tab
  async recheckSingleTab(url, tabId) {
    this.addLog('info', `Re-checking tab for: ${url.substring(0, 50)}...`);
    
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'RECHECK_SINGLE_TAB', 
        url: url,
        tabId: tabId
      });
      
      if (response && response.success) {
        if (response.updated) {
          this.addLog('success', `✓ Registration confirmed for: ${response.title}`);
        } else {
          this.addLog('info', `Still not registered: ${response.title}`);
        }
      } else {
        this.addLog('error', `Re-check failed: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.addLog('error', `Re-check error: ${error.message}`);
    }
    
    // Refresh the failed events list
    await this.renderFailedEvents();
  }
  
  // Manually mark an event as registered
  async markAsRegistered(url, tabId) {
    this.addLog('info', `Marking as registered: ${url.substring(0, 50)}...`);
    
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'MARK_AS_REGISTERED', 
        url: url,
        tabId: tabId
      });
      
      if (response && response.success) {
        this.addLog('success', `✓ Marked as registered: ${response.title}`);
        // Update counts
        if (this.successCount) {
          this.successCount.textContent = parseInt(this.successCount.textContent) + 1;
        }
        if (this.failedCount && parseInt(this.failedCount.textContent) > 0) {
          this.failedCount.textContent = parseInt(this.failedCount.textContent) - 1;
        }
      } else {
        this.addLog('error', `Mark failed: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.addLog('error', `Mark error: ${error.message}`);
    }
    
    // Refresh the failed events list
    await this.renderFailedEvents();
  }
  
  // Handle result update from background
  handleResultUpdate(data) {
    this.addLog('success', `✓ Registration verified: ${data.title}`);
    // Update counts
    if (data.reverified || data.manuallyMarked) {
      if (this.successCount) {
        this.successCount.textContent = parseInt(this.successCount.textContent) + 1;
      }
      if (this.failedCount && parseInt(this.failedCount.textContent) > 0) {
        this.failedCount.textContent = parseInt(this.failedCount.textContent) - 1;
      }
    }
    // Refresh failed events list
    this.renderFailedEvents();
  }
  
  // Handle re-check complete from background
  handleRecheckComplete(data) {
    if (data.updated > 0) {
      this.addLog('success', `Re-check complete: ${data.updated} of ${data.total} events confirmed as registered`);
    } else {
      this.addLog('info', `Re-check complete: No changes - ${data.total} events still need attention`);
    }
    // Refresh failed events list
    this.renderFailedEvents();
  }

  async exportDebugLogs() {
    this.addLog('info', 'Generating debug report...');
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_DEBUG_LOGS' });
      
      if (response && response.success) {
        const report = response.report;
        const jsonString = JSON.stringify(report, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `luma-debug-report-${Date.now()}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        this.addLog('success', 'Debug report exported successfully');
      } else {
        this.addLog('error', `Failed to export: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.addLog('error', `Export failed: ${error.message}`);
    }
  }
}

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
