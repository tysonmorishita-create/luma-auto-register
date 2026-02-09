// Dashboard Controller
class DashboardController {
  constructor() {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      manual: 0,
      pending: 0,
      processed: 0
    };
    this.results = [];
    this.processing = false;
    
    this.init();
  }

  init() {
    this.bindElements();
    this.attachEventListeners();
    this.startListening();
    this.loadState();
  }

  bindElements() {
    this.totalCount = document.getElementById('totalCount');
    this.successCount = document.getElementById('successCount');
    this.manualCount = document.getElementById('manualCount');
    this.failedCount = document.getElementById('failedCount');
    this.pendingCount = document.getElementById('pendingCount');
    this.statusText = document.getElementById('statusText');
    this.dashboardStatus = document.getElementById('dashboardStatus');
    this.progressBar = document.getElementById('progressBar');
    this.resultsList = document.getElementById('resultsList');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.exportDebugBtn = document.getElementById('exportDebugBtn');
    this.stopBtn = document.getElementById('stopBtn');
  }

  attachEventListeners() {
    this.refreshBtn.addEventListener('click', () => this.loadState());
    this.exportBtn.addEventListener('click', () => this.exportResults());
    this.exportDebugBtn.addEventListener('click', () => this.exportDebugLogs());
    this.stopBtn.addEventListener('click', () => this.stopRegistration());
  }

  startListening() {
    // Listen for updates from background script
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.type) {
        case 'STATUS_UPDATE':
          this.updateStats(message.data);
          break;
        case 'REGISTRATION_RESULT':
          this.addResult(message.data);
          break;
        case 'REGISTRATION_RESULT_UPDATE':
          this.updateResult(message.data);
          break;
        case 'REGISTRATION_COMPLETE':
          this.handleComplete();
          break;
      }
    });

    // Poll for updates every second
    setInterval(() => this.loadState(), 1000);
  }

  async loadState() {
    const result = await chrome.storage.local.get(['processingState', 'stats', 'results']);
    
    if (result.stats) {
      this.stats = result.stats;
      this.updateDisplay();
    }

    if (result.results) {
      this.results = result.results;
      this.renderResults();
    }

    if (result.processingState) {
      this.processing = result.processingState === 'processing';
      this.updateStatus();
    }
  }

  updateStats(stats) {
    this.stats = stats;
    this.updateDisplay();
    this.saveState();
  }

  updateDisplay() {
    this.totalCount.textContent = this.stats.total || 0;
    this.successCount.textContent = this.stats.success || 0;
    this.manualCount.textContent = this.stats.manual || 0;
    this.failedCount.textContent = this.stats.failed || 0;
    this.pendingCount.textContent = this.stats.pending || 0;

    // Update progress bar
    const total = this.stats.total || 1;
    const processed = this.stats.processed || 0;
    const percentage = Math.round((processed / total) * 100);
    
    this.progressBar.style.width = `${percentage}%`;
    this.progressBar.textContent = `${percentage}%`;

    this.updateStatus();
  }

  updateStatus() {
    if (this.processing) {
      const processed = this.stats.processed || 0;
      const total = this.stats.total || 0;
      this.statusText.textContent = `Processing... ${processed} of ${total} events`;
      this.statusText.className = 'status processing processing-indicator';
      this.dashboardStatus.textContent = '🔄 Registration in progress...';
      this.stopBtn.style.display = 'inline-block';
    } else {
      if (this.stats.processed > 0) {
        const manualText = this.stats.manual > 0 ? `, ⚠️ ${this.stats.manual} Need Manual Info` : '';
        const failedText = this.stats.failed > 0 ? ` (${this.stats.failed} tabs kept open for review)` : '';
        this.statusText.textContent = `Complete! ✓ ${this.stats.success} Successful, ✗ ${this.stats.failed} Failed${manualText}${failedText}`;
        this.statusText.className = 'status complete';
        this.dashboardStatus.textContent = this.stats.failed > 0 
          ? '✓ Registration complete! Check failed tabs below to review.' 
          : '✓ Registration complete!';
      } else {
        this.statusText.textContent = 'Waiting to start...';
        this.statusText.className = 'status';
        this.dashboardStatus.textContent = 'Ready to start registration';
      }
      this.stopBtn.style.display = 'none';
    }
  }

  addResult(result) {
    this.results.push(result);
    this.renderResults();
    this.saveState();
  }

  updateResult(updatedResult) {
    // Find and update the existing result (by URL and tabId)
    const index = this.results.findIndex(r => 
      r.url === updatedResult.url && r.tabId === updatedResult.tabId
    );
    
    if (index !== -1) {
      this.results[index] = updatedResult;
      this.renderResults();
      this.saveState();
      
      // Show a notification for re-verified successes
      if (updatedResult.reverified && updatedResult.status === 'success') {
        this.showNotification(`🔄 Re-verified: ${updatedResult.title} - Registration confirmed!`);
      }
    }
  }

  showNotification(message) {
    // Create a temporary toast notification
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #10b981;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
      max-width: 400px;
    `;
    document.body.appendChild(toast);
    
    // Remove after 4 seconds
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  renderResults() {
    if (this.results.length === 0) {
      this.resultsList.innerHTML = `
        <div class="empty-state">
          <h3>No Results Yet</h3>
          <p>Start a registration from the extension popup to see results here</p>
        </div>
      `;
      return;
    }

    // Sort by timestamp (newest first)
    const sorted = [...this.results].sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    this.resultsList.innerHTML = sorted.map(result => {
      let statusLabel = '';
      if (result.status === 'success') {
        // Distinguish between new registrations and events that were already signed up
        const msgLower = (result.message || '').toLowerCase();
        if (result.reverified) {
          // Event was re-verified after initial failure
          statusLabel = '🔄 Re-verified';
        } else if (
          msgLower.includes('already registered') ||
          msgLower.includes('already signed up') ||
          msgLower.includes('pending approval') ||
          msgLower.includes('on the waitlist') ||
          msgLower.includes('waitlist')
        ) {
          statusLabel = '✓ Already Signed Up';
        } else {
          statusLabel = '✓ Success';
        }
      } else if (result.status === 'manual') {
        statusLabel = '⚠️ Manual Info';
      } else if (result.status === 'failed') {
        statusLabel = '✗ Failed';
      } else {
        statusLabel = '⏳ Pending';
      }
      
      // Show a link button:
      // - For failed/manual: use tabId to jump to the still-open tab
      // - For success: use the stored URL so we can re-open the event page
      let tabLink = '';
      let markRegisteredBtn = '';
      if (result.tabId && (result.status === 'failed' || result.status === 'manual')) {
        tabLink = `<button class="tab-link-btn" data-tab-id="${result.tabId}" title="Click to switch to this tab">🔗 View Tab</button>`;
        // Add "Mark as Registered" button for failed/manual events
        markRegisteredBtn = `<button class="mark-registered-btn" data-url="${result.url}" data-tab-id="${result.tabId}" title="Manually mark this event as registered and add to database">✓ Mark Done</button>`;
      } else if (result.status === 'failed' || result.status === 'manual') {
        // Failed/manual without tabId - still allow marking as registered
        markRegisteredBtn = `<button class="mark-registered-btn" data-url="${result.url}" data-tab-id="" title="Manually mark this event as registered and add to database">✓ Mark Done</button>`;
        if (result.url) {
          tabLink = `<button class="tab-link-btn" data-url="${result.url}" title="Open event in a new tab">🔗 View Event</button>`;
        }
      } else if (result.url) {
        tabLink = `<button class="tab-link-btn" data-url="${result.url}" title="Open event in a new tab">🔗 View Event</button>`;
      }
      
      // Add date prefix if available
      const datePrefix = result.date ? `<span style="color: #6366f1; font-weight: 600; margin-right: 8px;">[${result.date}]</span>` : '';
      
      return `
        <div class="result-item ${result.status}">
          <div class="result-title">
            ${datePrefix}${result.title}
          </div>
          <div class="result-actions">
            <span class="result-status ${result.status}">
              ${statusLabel}
            </span>
            ${result.message ? `<span class="result-message">${result.message}</span>` : ''}
            ${tabLink}
            ${markRegisteredBtn}
          </div>
        </div>
      `;
    }).join('');
    
    // Attach click handlers for tab / URL links
    this.resultsList.querySelectorAll('.tab-link-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const tabIdAttr = target.getAttribute('data-tab-id');
        const url = target.getAttribute('data-url');

        // Prefer switching to an existing tab when we have a tabId
        const tabId = tabIdAttr ? parseInt(tabIdAttr, 10) : NaN;
        if (!isNaN(tabId)) {
          chrome.tabs.update(tabId, { active: true }).catch(() => {
            // Tab might be closed, fall back to opening the URL (if we have it)
            const result = sorted.find(r => r.tabId === tabId);
            const fallbackUrl = (result && result.url) || url;
            if (fallbackUrl) {
              chrome.tabs.create({ url: fallbackUrl, active: true });
            } else {
              alert('Tab is no longer available. It may have been closed.');
            }
          });
          // Also focus the window
          chrome.tabs.get(tabId).then(tab => {
            chrome.windows.update(tab.windowId, { focused: true });
          }).catch(() => {});
        } else if (url) {
          // Successful registrations or entries without a live tab: open the event URL
          chrome.tabs.create({ url, active: true });
        }
      });
    });
    
    // Attach click handlers for "Mark as Registered" buttons
    this.resultsList.querySelectorAll('.mark-registered-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget;
        const url = target.getAttribute('data-url');
        const tabIdAttr = target.getAttribute('data-tab-id');
        const tabId = tabIdAttr ? parseInt(tabIdAttr, 10) : null;
        
        // Disable button and show loading state
        target.disabled = true;
        target.textContent = '⏳ Marking...';
        
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'MARK_AS_REGISTERED',
            url: url,
            tabId: tabId
          });
          
          if (response && response.success) {
            this.showNotification(`✓ Marked as registered: ${response.title}`);
            // Update stats
            this.stats.failed = Math.max(0, (this.stats.failed || 0) - 1);
            this.stats.success = (this.stats.success || 0) + 1;
            this.updateDisplay();
            // Reload results to reflect the change
            await this.loadState();
          } else {
            alert(`Failed to mark as registered: ${response?.error || 'Unknown error'}`);
            target.disabled = false;
            target.textContent = '✓ Mark Done';
          }
        } catch (error) {
          alert(`Error: ${error.message}`);
          target.disabled = false;
          target.textContent = '✓ Mark Done';
        }
      });
    });
  }

  handleComplete() {
    this.processing = false;
    this.updateStatus();
  }

  async exportResults() {
    if (this.results.length === 0) {
      alert('No results to export');
      return;
    }

    const csv = [
      ['Date', 'Title', 'URL', 'Status', 'Message', 'Timestamp'].join(','),
      ...this.results.map(r => [
        `"${r.date || ''}"`,
        `"${r.title}"`,
        r.url,
        r.status,
        `"${r.message || ''}"`,
        r.timestamp
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luma-registrations-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  stopRegistration() {
    chrome.runtime.sendMessage({ type: 'STOP_REGISTRATION' });
  }

  async exportDebugLogs() {
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
        alert('Debug report exported successfully!');
      } else {
        alert(`Failed to export debug report: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Export failed: ${error.message}`);
    }
  }

  async saveState() {
    await chrome.storage.local.set({
      stats: this.stats,
      results: this.results
    });
  }
}

// Initialize dashboard
const dashboard = new DashboardController();
