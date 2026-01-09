// Popup UI Controller
class PopupController {
  constructor() {
    this.events = [];
    this.filteredEvents = [];
    this.searchQuery = '';
    this.state = 'idle'; // idle, scanning, ready, processing, paused, complete
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

    // Sections
    this.eventsSection = document.getElementById('eventsSection');
    this.settingsSection = document.getElementById('settingsSection');
    this.progressSection = document.getElementById('progressSection');
    this.resultsSection = document.getElementById('resultsSection');
    this.debugSection = document.getElementById('debugSection');

    // Display elements
    this.scanStatus = document.getElementById('scanStatus');
    this.currentUrl = document.getElementById('currentUrl');
    this.eventCount = document.getElementById('eventCount');
    this.eventsList = document.getElementById('eventsList');
    this.eventSearch = document.getElementById('eventSearch');
    this.searchCount = document.getElementById('searchCount');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    this.successCount = document.getElementById('successCount');
    this.failedCount = document.getElementById('failedCount');
    this.pendingCount = document.getElementById('pendingCount');
    this.logContainer = document.getElementById('logContainer');
    this.debugContainer = document.getElementById('debugContainer');
  }

  attachEventListeners() {
    this.scanBtn.addEventListener('click', () => this.handleScan());
    this.selectAllBtn.addEventListener('click', () => this.selectAll(true));
    this.deselectAllBtn.addEventListener('click', () => this.selectAll(false));
    this.eventSearch.addEventListener('input', (e) => this.handleSearch(e.target.value));
    this.startBtn.addEventListener('click', () => this.handleStart());
    this.pauseBtn.addEventListener('click', () => this.handlePause());
    this.stopBtn.addEventListener('click', () => this.handleStop());
    this.exportBtn.addEventListener('click', () => this.handleExport());
    this.resetBtn.addEventListener('click', () => this.handleReset());
    this.toggleDebugBtn.addEventListener('click', () => this.toggleDebug());
    this.clearDebugBtn.addEventListener('click', () => this.clearDebug());
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
        this.handleScanComplete(message.events, message.debug);
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

    // Check if it's a Luma page
    if (!tab.url.includes('luma.com') && !tab.url.includes('lu.ma')) {
      this.showStatus('Please navigate to a Luma calendar page first', 'error');
      this.addLog('error', 'Not on a Luma page');
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

  handleScanComplete(events, debugInfo) {
    this.events = events;
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

    this.showStatus(`Found ${events.length} events!`, 'success');
    this.addLog('success', `Found ${events.length} events`);
    this.renderEvents();
    this.eventsSection.style.display = 'block';
    this.settingsSection.style.display = 'block';
  }

  handleSearch(query) {
    this.searchQuery = query.toLowerCase().trim();
    this.filterEvents();
    this.renderEvents();
  }

  filterEvents() {
    if (!this.searchQuery) {
      this.filteredEvents = this.events;
    } else {
      this.filteredEvents = this.events.filter(event => 
        event.title.toLowerCase().includes(this.searchQuery) ||
        (event.url && event.url.toLowerCase().includes(this.searchQuery))
      );
    }
  }

  renderEvents() {
    // Update filtered events if search query exists
    if (this.searchQuery) {
      this.filterEvents();
    } else {
      this.filteredEvents = this.events;
    }

    const totalCount = this.events.length;
    const filteredCount = this.filteredEvents.length;
    
    this.eventCount.textContent = `${totalCount} events found`;
    
    // Update search count
    if (this.searchQuery && filteredCount !== totalCount) {
      this.searchCount.textContent = `Showing ${filteredCount} of ${totalCount}`;
      this.searchCount.style.display = 'block';
    } else {
      this.searchCount.textContent = '';
      this.searchCount.style.display = 'none';
    }

    this.eventsList.innerHTML = '';

    if (this.filteredEvents.length === 0 && this.searchQuery) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = `No events found matching "${this.searchQuery}"`;
      this.eventsList.appendChild(noResults);
      return;
    }

    // Render filtered events, but use original index for checkbox IDs
    this.filteredEvents.forEach((event) => {
      const originalIndex = this.events.indexOf(event);
      const item = document.createElement('div');
      item.className = 'event-item';
      item.innerHTML = `
        <input type="checkbox" id="event-${originalIndex}" ${event.selected ? 'checked' : ''}>
        <label for="event-${originalIndex}" class="event-title" title="${event.title}">${event.title}</label>
      `;
      
      const checkbox = item.querySelector('input');
      checkbox.addEventListener('change', (e) => {
        this.events[originalIndex].selected = e.target.checked;
      });

      this.eventsList.appendChild(item);
    });
  }

  selectAll(selected) {
    // Only select/deselect filtered events if search is active
    if (this.searchQuery && this.filteredEvents.length > 0) {
      this.filteredEvents.forEach(event => event.selected = selected);
    } else {
      this.events.forEach(event => event.selected = selected);
    }
    this.renderEvents();
  }

  async handleStart() {
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
}

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
