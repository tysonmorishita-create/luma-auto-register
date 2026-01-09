// Settings Controller
class SettingsController {
  constructor() {
    this.defaultSettings = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      twitter: '',
      instagram: '',
      linkedin: '',
      youtube: '',
      telegram: '',
      company: '',
      title: '',
      website: '',
      companyWebsite: '',
      bio: '',
      interests: '',
      // Location & Demographics
      country: '',
      city: '',
      state: '',
      timezone: '',
      pronouns: '',
      // Professional Details
      industryCategory: '',
      experienceLevel: '',
      roleCategory: '',
      yearsExperience: '',
      // Event-Specific
      howDidYouHear: 'Social Media',
      dietaryRestrictions: 'None',
      tshirtSize: '',
      accessibilityNeeds: '',
      // Crypto/Web3
      cryptoExperience: '',
      primaryInterest: '',
      involvementLevel: '',
      // Generic Catch-All
      genericAnswer1: 'To be provided',
      // Options
      autoAcceptTerms: true,
      skipManualFields: false
    };
    
    this.init();
  }

  async init() {
    this.bindElements();
    this.attachEventListeners();
    await this.checkOnboarding();
    await this.loadSettings();
    this.setupFieldValidation();
  }

  async checkOnboarding() {
    const result = await chrome.storage.local.get('hasSeenOnboarding');
    if (!result.hasSeenOnboarding) {
      // Show onboarding
      const overlay = document.getElementById('onboardingOverlay');
      if (overlay) {
        overlay.classList.add('active');
      }
    }
  }

  setupFieldValidation() {
    // Required fields
    const requiredFields = {
      firstName: 'First name is required',
      lastName: 'Last name is required',
      email: 'Email is required and must be valid'
    };

    // Add validation to required fields
    Object.keys(requiredFields).forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        field.addEventListener('blur', () => this.validateField(fieldId, requiredFields[fieldId]));
        field.addEventListener('input', () => this.validateField(fieldId, requiredFields[fieldId]));
      }
    });

    // Email validation
    const emailField = document.getElementById('email');
    if (emailField) {
      emailField.addEventListener('blur', () => this.validateEmail());
      emailField.addEventListener('input', () => this.validateEmail());
    }

    // Phone validation (optional but format check)
    const phoneField = document.getElementById('phone');
    if (phoneField) {
      phoneField.addEventListener('blur', () => this.validatePhone());
    }
  }

  validateField(fieldId, errorMessage) {
    const field = document.getElementById(fieldId);
    const statusEl = document.getElementById(fieldId + 'Status');
    
    if (!field || !statusEl) return;

    if (!field.value.trim()) {
      statusEl.textContent = '⚠️ ' + errorMessage;
      statusEl.className = 'field-status invalid';
      field.style.borderColor = '#ef4444';
      return false;
    } else {
      statusEl.textContent = '✓';
      statusEl.className = 'field-status valid';
      field.style.borderColor = '#10b981';
      return true;
    }
  }

  validateEmail() {
    const emailField = document.getElementById('email');
    const statusEl = document.getElementById('emailStatus');
    
    if (!emailField || !statusEl) return;

    const email = emailField.value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email) {
      statusEl.textContent = '⚠️ Email is required';
      statusEl.className = 'field-status invalid';
      emailField.style.borderColor = '#ef4444';
      return false;
    } else if (!emailRegex.test(email)) {
      statusEl.textContent = '⚠️ Please enter a valid email address';
      statusEl.className = 'field-status invalid';
      emailField.style.borderColor = '#ef4444';
      return false;
    } else {
      statusEl.textContent = '✓';
      statusEl.className = 'field-status valid';
      emailField.style.borderColor = '#10b981';
      return true;
    }
  }

  validatePhone() {
    const phoneField = document.getElementById('phone');
    const statusEl = document.getElementById('phoneStatus');
    
    if (!phoneField || !statusEl) return;

    const phone = phoneField.value.trim();
    
    if (!phone) {
      statusEl.textContent = '';
      phoneField.style.borderColor = '#d1d5db';
      return true; // Phone is optional
    }

    // Basic phone validation (allows various formats)
    const phoneRegex = /^[\d\s\+\-\(\)]+$/;
    if (phoneRegex.test(phone) && phone.length >= 10) {
      statusEl.textContent = '✓';
      statusEl.className = 'field-status valid';
      phoneField.style.borderColor = '#10b981';
      return true;
    } else {
      statusEl.textContent = '⚠️ Please check phone format';
      statusEl.className = 'field-status invalid';
      phoneField.style.borderColor = '#f59e0b';
      return false;
    }
  }

  bindElements() {
    this.firstName = document.getElementById('firstName');
    this.lastName = document.getElementById('lastName');
    this.email = document.getElementById('email');
    this.phone = document.getElementById('phone');
    this.twitter = document.getElementById('twitter');
    this.instagram = document.getElementById('instagram');
    this.linkedin = document.getElementById('linkedin');
    this.youtube = document.getElementById('youtube');
    this.telegram = document.getElementById('telegram');
    this.company = document.getElementById('company');
    this.title = document.getElementById('title');
    this.website = document.getElementById('website');
    this.companyWebsite = document.getElementById('companyWebsite');
    this.bio = document.getElementById('bio');
    this.interests = document.getElementById('interests');
    // Location & Demographics
    this.country = document.getElementById('country');
    this.city = document.getElementById('city');
    this.timezone = document.getElementById('timezone');
    this.pronouns = document.getElementById('pronouns');
    // Professional Details
    this.industryCategory = document.getElementById('industryCategory');
    this.experienceLevel = document.getElementById('experienceLevel');
    this.roleCategory = document.getElementById('roleCategory');
    this.yearsExperience = document.getElementById('yearsExperience');
    // Event-Specific
    this.howDidYouHear = document.getElementById('howDidYouHear');
    this.dietaryRestrictions = document.getElementById('dietaryRestrictions');
    this.tshirtSize = document.getElementById('tshirtSize');
    this.accessibilityNeeds = document.getElementById('accessibilityNeeds');
    // Crypto/Web3
    this.cryptoExperience = document.getElementById('cryptoExperience');
    this.primaryInterest = document.getElementById('primaryInterest');
    this.involvementLevel = document.getElementById('involvementLevel');
    // Generic Catch-All
    this.genericAnswer1 = document.getElementById('genericAnswer1');
    // Options
    this.autoAcceptTerms = document.getElementById('autoAcceptTerms');
    this.skipManualFields = document.getElementById('skipManualFields');
    
    this.saveBtn = document.getElementById('saveBtn');
    this.resetBtn = document.getElementById('resetBtn');
    this.saveAlert = document.getElementById('saveAlert');
  }

  attachEventListeners() {
    this.saveBtn.addEventListener('click', () => this.saveSettings());
    this.resetBtn.addEventListener('click', () => this.resetSettings());
    
    // Onboarding handlers
    const startBtn = document.getElementById('startOnboarding');
    const showGuideBtn = document.getElementById('showGuideBtn');
    
    if (startBtn) {
      startBtn.addEventListener('click', () => this.closeOnboarding());
    }
    
    if (showGuideBtn) {
      showGuideBtn.addEventListener('click', () => this.showOnboarding());
    }
    
    // Also handle the button in the info box
    const showGuideBtn2 = document.getElementById('showGuideBtn2');
    if (showGuideBtn2) {
      showGuideBtn2.addEventListener('click', () => this.showOnboarding());
    }
  }

  showOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) {
      overlay.classList.add('active');
      // Scroll to top to show the modal
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async closeOnboarding(skip = false) {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
    
    if (!skip) {
      await chrome.storage.local.set({ hasSeenOnboarding: true });
    }
    
    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async loadSettings() {
    const result = await chrome.storage.local.get('userSettings');
    const settings = result.userSettings || this.defaultSettings;
    
    this.firstName.value = settings.firstName || '';
    this.lastName.value = settings.lastName || '';
    this.email.value = settings.email || '';
    this.phone.value = settings.phone || '';
    this.twitter.value = settings.twitter || '';
    this.instagram.value = settings.instagram || '';
    this.linkedin.value = settings.linkedin || '';
    this.youtube.value = settings.youtube || '';
    this.telegram.value = settings.telegram || '';
    this.company.value = settings.company || '';
    this.title.value = settings.title || '';
    this.website.value = settings.website || '';
    this.companyWebsite.value = settings.companyWebsite || '';
    this.bio.value = settings.bio || '';
    this.interests.value = settings.interests || '';
    // Location & Demographics
    this.country.value = settings.country || '';
    this.city.value = settings.city || '';
    this.timezone.value = settings.timezone || '';
    this.pronouns.value = settings.pronouns || '';
    // Professional Details
    this.industryCategory.value = settings.industryCategory || '';
    this.experienceLevel.value = settings.experienceLevel || '';
    this.roleCategory.value = settings.roleCategory || '';
    this.yearsExperience.value = settings.yearsExperience || '';
    // Event-Specific
    this.howDidYouHear.value = settings.howDidYouHear || 'Social Media';
    this.dietaryRestrictions.value = settings.dietaryRestrictions || 'None';
    this.tshirtSize.value = settings.tshirtSize || '';
    this.accessibilityNeeds.value = settings.accessibilityNeeds || '';
    // Crypto/Web3
    this.cryptoExperience.value = settings.cryptoExperience || '';
    this.primaryInterest.value = settings.primaryInterest || '';
    this.involvementLevel.value = settings.involvementLevel || '';
    // Generic Catch-All
    this.genericAnswer1.value = settings.genericAnswer1 || 'To be provided';
    // Options
    this.autoAcceptTerms.checked = settings.autoAcceptTerms !== false;
    this.skipManualFields.checked = settings.skipManualFields || false;
  }

  async saveSettings() {
    // Validate required fields first
    const firstNameValid = this.validateField('firstName', 'First name is required');
    const lastNameValid = this.validateField('lastName', 'Last name is required');
    const emailValid = this.validateEmail();

    if (!firstNameValid || !lastNameValid || !emailValid) {
      this.saveAlert.textContent = '⚠️ Please fix the errors above before saving';
      this.saveAlert.className = 'alert alert-error';
      this.saveAlert.style.display = 'block';
      
      // Scroll to first error
      const firstError = document.querySelector('.field-status.invalid');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      setTimeout(() => {
        this.saveAlert.style.display = 'none';
      }, 5000);
      return;
    }

    const settings = {
      firstName: this.firstName.value.trim(),
      lastName: this.lastName.value.trim(),
      email: this.email.value.trim(),
      phone: this.phone.value.trim(),
      twitter: this.twitter.value.trim(),
      instagram: this.instagram.value.trim(),
      linkedin: this.linkedin.value.trim(),
      youtube: this.youtube.value.trim(),
      telegram: this.telegram.value.trim(),
      company: this.company.value.trim(),
      title: this.title.value.trim(),
      website: this.website.value.trim(),
      companyWebsite: this.companyWebsite.value.trim(),
      bio: this.bio.value.trim(),
      interests: this.interests.value.trim(),
      // Location & Demographics
      country: this.country.value.trim(),
      city: this.city.value.trim(),
      timezone: this.timezone.value.trim(),
      pronouns: this.pronouns.value.trim(),
      // Professional Details
      industryCategory: this.industryCategory.value.trim(),
      experienceLevel: this.experienceLevel.value.trim(),
      roleCategory: this.roleCategory.value.trim(),
      yearsExperience: this.yearsExperience.value.trim(),
      // Event-Specific
      howDidYouHear: this.howDidYouHear.value.trim(),
      dietaryRestrictions: this.dietaryRestrictions.value.trim(),
      tshirtSize: this.tshirtSize.value.trim(),
      accessibilityNeeds: this.accessibilityNeeds.value.trim(),
      // Crypto/Web3
      cryptoExperience: this.cryptoExperience.value.trim(),
      primaryInterest: this.primaryInterest.value.trim(),
      involvementLevel: this.involvementLevel.value.trim(),
      // Generic Catch-All
      genericAnswer1: this.genericAnswer1.value.trim(),
      // Options
      autoAcceptTerms: this.autoAcceptTerms.checked,
      skipManualFields: this.skipManualFields.checked
    };

    await chrome.storage.local.set({ userSettings: settings });
    
    // Show success message
    this.saveAlert.textContent = '✓ Settings saved successfully!';
    this.saveAlert.className = 'alert alert-success';
    this.saveAlert.style.display = 'block';
    
    // Mark onboarding as seen if not already
    await chrome.storage.local.set({ hasSeenOnboarding: true });
    
    setTimeout(() => {
      this.saveAlert.style.display = 'none';
    }, 3000);
  }

  async resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      await chrome.storage.local.set({ userSettings: this.defaultSettings });
      this.loadSettings();
      
      this.saveAlert.textContent = '✓ Settings reset to defaults!';
      this.saveAlert.style.display = 'block';
      setTimeout(() => {
        this.saveAlert.style.display = 'none';
      }, 3000);
    }
  }
}

// Initialize
const settings = new SettingsController();
