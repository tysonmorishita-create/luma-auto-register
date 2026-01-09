// Content Script - Runs on all Luma pages
// This script helps detect page state and can assist with registration

(function() {
  'use strict';

  // Helper to detect if we're on an event page
  function isEventPage() {
    const url = window.location.href;
    const isLumaEvent = /(?:lu\.ma|luma\.com)\/[a-zA-Z0-9-]+/.test(url);
    const notExcluded = !url.includes('/calendar') && 
                       !url.includes('/profile') && 
                       !url.includes('/discover') &&
                       !url.includes('/create');
    return isLumaEvent && notExcluded;
  }

  // Helper to detect if already registered
  function isAlreadyRegistered() {
    const rawText = document.body.textContent || '';
    // Normalize to handle curly quotes and similar punctuation
    const text = rawText
      .toLowerCase()
      .replace(/[\u2018\u2019\u201B]/g, "'"); // map various apostrophes to '

    return text.includes("you're going") ||
           text.includes("you're registered") ||
           text.includes("you're in") ||
           text.includes('you are registered') ||
           text.includes('already registered') ||
           text.includes('see you there');
  }

  // Helper to detect if event is full
  function isEventFull() {
    const bodyText = document.body.textContent;
    return bodyText.includes('Event Full') ||
           bodyText.includes('Sold Out') ||
           bodyText.includes('Join Waitlist') ||
           bodyText.includes('Waitlist');
  }

  // Helper to find registration button
  function findRegisterButton() {
    const buttons = [
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('a[role="button"]')
    ];

    for (const btn of buttons) {
      const text = btn.textContent.toLowerCase();
      if (text.includes('register') || 
          text.includes('rsvp') || 
          text.includes('sign up') ||
          text.includes('join event') ||
          text.includes('get tickets')) {
        return btn;
      }
    }
    return null;
  }

  // Helper to find and click submit button
  function findSubmitButton() {
    const buttons = [
      ...document.querySelectorAll('button[type="submit"]'),
      ...document.querySelectorAll('button')
    ];

    for (const btn of buttons) {
      const text = btn.textContent.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      
      if (text.includes('submit') || 
          text.includes('register') || 
          text.includes('confirm') ||
          text.includes('continue') ||
          text.includes('rsvp') ||
          ariaLabel.includes('submit') ||
          ariaLabel.includes('register')) {
        return btn;
      }
    }
    return null;
  }

  // Detect page state
  function getPageState() {
    if (!isEventPage()) {
      return { type: 'not_event_page' };
    }

    if (isAlreadyRegistered()) {
      return { type: 'already_registered' };
    }

    if (isEventFull()) {
      return { type: 'event_full' };
    }

    const registerBtn = findRegisterButton();
    if (registerBtn) {
      return { type: 'ready_to_register', button: registerBtn };
    }

    return { type: 'unknown' };
  }

  // Auto-fill form if needed (for future enhancement)
  function autoFillForm() {
    // Luma typically auto-fills if you're logged in
    // This is a placeholder for custom form filling if needed
    const nameInput = document.querySelector('input[name="name"], input[placeholder*="name" i]');
    const emailInput = document.querySelector('input[type="email"], input[name="email"]');
    
    // If fields exist and are empty, could auto-fill from storage
    // For now, we rely on Luma's auto-fill
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PAGE_STATE') {
      const state = getPageState();
      sendResponse(state);
    } else if (message.type === 'CLICK_REGISTER') {
      const state = getPageState();
      if (state.type === 'ready_to_register' && state.button) {
        state.button.click();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, reason: state.type });
      }
    }
    return true; // Keep channel open for async response
  });

  // Observer to detect when modals/forms appear
  const observer = new MutationObserver((mutations) => {
    // Check if a registration modal appeared
    const modal = document.querySelector('[role="dialog"], [class*="modal"]');
    if (modal) {
      // Could notify background script that modal is open
      // For now, the performRegistration function in background.js handles this
    }
  });

  // Start observing
  if (isEventPage()) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Log that content script is loaded (for debugging)
  console.log('Luma Auto Register - Content Script Loaded');
})();
