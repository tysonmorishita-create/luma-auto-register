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
    this.stopBtn = document.getElementById('stopBtn');
  }

  attachEventListeners() {
    this.refreshBtn.addEventListener('click', () => this.loadState());
    this.exportBtn.addEventListener('click', () => this.exportResults());
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
        if (
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
      if (result.tabId && (result.status === 'failed' || result.status === 'manual')) {
        tabLink = `<button class="tab-link-btn" data-tab-id="${result.tabId}" title="Click to switch to this tab">🔗 View Tab</button>`;
      } else if (result.url) {
        tabLink = `<button class="tab-link-btn" data-url="${result.url}" title="Open event in a new tab">🔗 View Event</button>`;
      }
      
      return `
        <div class="result-item ${result.status}">
          <div class="result-title">
            ${result.title}
          </div>
          <div class="result-actions">
            <span class="result-status ${result.status}">
              ${statusLabel}
            </span>
            ${result.message ? `<span class="result-message">${result.message}</span>` : ''}
            ${tabLink}
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
      ['Title', 'URL', 'Status', 'Message', 'Timestamp'].join(','),
      ...this.results.map(r => [
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

  async saveState() {
    await chrome.storage.local.set({
      stats: this.stats,
      results: this.results
    });
  }
}

// Initialize dashboard
const dashboard = new DashboardController();
