// ============================================================================
// SWIFTQUOTE MARKETPLACE APP - COMPLETE FRONTEND
// ============================================================================

const state = {
  account: null,
  csrfToken: null,
  services: [],
  providers: [],
  currentAccount: null,
  leads: [],
  quotes: [],
  jobs: [],
  providerLeads: [],
  providerJobs: [],
  notifications: [],
};

const API_URL = '/api';

function showError(message, elementId = 'requestStatus') {
  const el = document.getElementById(elementId);
  if (el) {
    el.className = 'status error';
    el.textContent = message;
  }
  console.error(message);
}

function showSuccess(message, elementId = 'requestStatus') {
  const el = document.getElementById(elementId);
  if (el) {
    el.className = 'status success';
    el.textContent = message;
  }
}

function clearStatus(elementId = 'requestStatus') {
  const el = document.getElementById(elementId);
  if (el) {
    el.className = 'status';
    el.textContent = '';
  }
}

async function apiCall(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.csrfToken && options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = state.csrfToken;
  }

  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof data === 'string' ? data : (data.error || `HTTP ${response.status}`);
    throw new Error(message);
  }

  return data;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function validatePhone(phone) {
  return (phone || '').replace(/\D/g, '').length >= 7;
}

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(Number(timestamp) || timestamp);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

async function initializeApp() {
  try {
    const config = await apiCall('/config');
    if (config.businessName) {
      document.title = `${config.businessName} | SwiftQuote`;
    }

    const servicesResp = await apiCall('/marketplace/services');
    state.services = servicesResp.services || servicesResp || [];
    populateServiceSelects();

    setupEventListeners();
    await checkUserSession();
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

async function checkUserSession() {
  try {
    const session = await apiCall('/account/me');
    if (session && (session.account || session.account_type)) {
      state.account = session.account || session;
      state.currentAccount = state.account;
      state.csrfToken = session.csrfToken || null;
      showDashboard();

      if (state.account.account_type === 'customer') {
        await loadCustomerData();
      } else if (state.account.account_type === 'provider') {
        await loadProviderData();
      }
    }
  } catch (error) {
    state.account = null;
    state.csrfToken = null;
    hideDashboard();
  }
}

function populateServiceSelects() {
  const select = document.getElementById('requestService');
  if (select) {
    const options = state.services
      .map((service) => `<option value="${service.id}">${service.label}</option>`)
      .join('');
    select.innerHTML = `<option value="">Select a service</option>${options}`;
  }
}

function setupEventListeners() {
  const requestForm = document.getElementById('requestForm');
  if (requestForm) requestForm.addEventListener('submit', handleQuoteRequest);

  const customerLoginForm = document.getElementById('customerLoginForm');
  if (customerLoginForm) customerLoginForm.addEventListener('submit', handleCustomerLogin);

  const customerRegisterForm = document.getElementById('customerRegisterForm');
  if (customerRegisterForm) customerRegisterForm.addEventListener('submit', handleCustomerRegister);

  const providerLoginForm = document.getElementById('providerLoginForm');
  if (providerLoginForm) providerLoginForm.addEventListener('submit', handleProviderLogin);

  const providerRegisterForm = document.getElementById('providerRegisterForm');
  if (providerRegisterForm) providerRegisterForm.addEventListener('submit', handleProviderRegister);

  const providerSearchBtn = document.getElementById('providerSearch');
  if (providerSearchBtn) providerSearchBtn.addEventListener('click', handleProviderSearch);

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', handleTabSwitch);
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const showCustomerRegister = document.getElementById('showCustomerRegister');
  if (showCustomerRegister) {
    showCustomerRegister.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('customerLoginForm').classList.add('hidden');
      document.getElementById('customerRegisterForm').classList.remove('hidden');
    });
  }

  const showProviderRegister = document.getElementById('showProviderRegister');
  if (showProviderRegister) {
    showProviderRegister.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('providerLoginForm').classList.add('hidden');
      document.getElementById('providerRegisterForm').classList.remove('hidden');
    });
  }
}

function showStatus(message, elementId = 'requestStatus') {
  const el = document.getElementById(elementId);
  if (el) {
    el.className = 'status';
    el.textContent = message;
  }
}

async function handleQuoteRequest(e) {
  e.preventDefault();
  clearStatus('requestStatus');

  const payload = {
    name: document.getElementById('requestName')?.value?.trim(),
    email: document.getElementById('requestEmail')?.value?.trim(),
    phone: document.getElementById('requestPhone')?.value?.trim(),
    service: document.getElementById('requestService')?.value,
    jobSize: document.getElementById('requestSize')?.value,
    timing: document.getElementById('requestTiming')?.value,
    address: document.getElementById('requestAddress')?.value?.trim(),
    details: document.getElementById('requestDetails')?.value?.trim(),
  };

  if (!payload.name || payload.name.length < 2) {
    showError('Please enter a valid name.', 'requestStatus');
    return;
  }
  if (!validateEmail(payload.email)) {
    showError('Please enter a valid email address.', 'requestStatus');
    return;
  }
  if (!validatePhone(payload.phone)) {
    showError('Please enter a valid phone number.', 'requestStatus');
    return;
  }
  if (!payload.service) {
    showError('Please select a service.', 'requestStatus');
    return;
  }
  if (!payload.jobSize) {
    showError('Please select project size.', 'requestStatus');
    return;
  }
  if (!payload.timing) {
    showError('Please select timing.', 'requestStatus');
    return;
  }
  if (!payload.address || payload.address.length < 5) {
    showError('Please provide a valid address.', 'requestStatus');
    return;
  }
  if (!payload.details || payload.details.length < 10) {
    showError('Please add more project details.', 'requestStatus');
    return;
  }

  try {
    showStatus('Submitting your request...', 'requestStatus');
    const result = await apiCall('/quote', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const estimateText = result.estimate ? `${result.estimate.min} - ${result.estimate.max}` : 'available';
    showSuccess(`Quote request submitted. Estimated range: $${estimateText}.`, 'requestStatus');
    e.target.reset();
  } catch (error) {
    showError(`Failed to submit request: ${error.message}`, 'requestStatus');
  }
}

async function handleCustomerLogin(e) {
  e.preventDefault();
  const email = document.querySelector('#customerLoginForm input[name="email"]')?.value?.trim();
  const password = document.querySelector('#customerLoginForm input[name="password"]')?.value;

  if (!validateEmail(email) || !password) {
    showError('Please enter a valid email and password.', 'customerAuthStatus');
    return;
  }

  try {
    const result = await apiCall('/account/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    state.csrfToken = result.csrfToken || null;
    showSuccess('Logged in successfully.', 'customerAuthStatus');
    setTimeout(() => checkUserSession(), 250);
  } catch (error) {
    showError(`Login failed: ${error.message}`, 'customerAuthStatus');
  }
}

async function handleCustomerRegister(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.querySelector('input[name="name"]')?.value?.trim(),
    email: form.querySelector('input[name="email"]')?.value?.trim(),
    password: form.querySelector('input[name="password"]')?.value,
  };

  if (!payload.name || payload.name.length < 2) {
    showError('Please enter your full name.', 'customerAuthStatus');
    return;
  }
  if (!validateEmail(payload.email)) {
    showError('Please enter a valid email.', 'customerAuthStatus');
    return;
  }
  if (!payload.password || payload.password.length < 8) {
    showError('Password must be at least 8 characters.', 'customerAuthStatus');
    return;
  }

  try {
    const result = await apiCall('/account/register', {
      method: 'POST',
      body: JSON.stringify({ ...payload, accountType: 'customer' }),
    });
    state.csrfToken = result.csrfToken || null;
    showSuccess('Account created. Logging in…', 'customerAuthStatus');
    setTimeout(() => checkUserSession(), 250);
  } catch (error) {
    showError(`Registration failed: ${error.message}`, 'customerAuthStatus');
  }
}

async function handleProviderLogin(e) {
  e.preventDefault();
  const email = document.querySelector('#providerLoginForm input[name="email"]')?.value?.trim();
  const password = document.querySelector('#providerLoginForm input[name="password"]')?.value;

  if (!validateEmail(email) || !password) {
    showError('Please enter a valid email and password.', 'customerAuthStatus');
    return;
  }

  try {
    const result = await apiCall('/account/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    state.csrfToken = result.csrfToken || null;
    showSuccess('Provider logged in successfully.', 'customerAuthStatus');
    setTimeout(() => checkUserSession(), 250);
  } catch (error) {
    showError(`Login failed: ${error.message}`, 'customerAuthStatus');
  }
}

async function handleProviderRegister(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.querySelector('input[name="businessName"]')?.value?.trim(),
    email: form.querySelector('input[name="email"]')?.value?.trim(),
    password: form.querySelector('input[name="password"]')?.value,
    providerKind: form.querySelector('select[name="providerKind"]')?.value,
  };

  if (!payload.name || payload.name.length < 2) {
    showError('Please enter a valid business name.', 'customerAuthStatus');
    return;
  }
  if (!validateEmail(payload.email)) {
    showError('Please enter a valid email.', 'customerAuthStatus');
    return;
  }
  if (!payload.password || payload.password.length < 8) {
    showError('Password must be at least 8 characters.', 'customerAuthStatus');
    return;
  }
  if (!payload.providerKind) {
    showError('Please select a provider type.', 'customerAuthStatus');
    return;
  }

  try {
    const result = await apiCall('/account/register', {
      method: 'POST',
      body: JSON.stringify({ ...payload, accountType: 'provider' }),
    });
    state.csrfToken = result.csrfToken || null;
    showSuccess('Provider account created. Logging in…', 'customerAuthStatus');
    setTimeout(() => checkUserSession(), 250);
  } catch (error) {
    showError(`Registration failed: ${error.message}`, 'customerAuthStatus');
  }
}

async function handleLogout() {
  try {
    await apiCall('/account/logout', { method: 'POST' });
    state.account = null;
    state.csrfToken = null;
    hideDashboard();
    location.reload();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}

function showDashboard() {
  const dashboardEl = document.getElementById('dashboard');
  const accountEl = document.getElementById('account');
  const providerEl = document.getElementById('provider');
  if (dashboardEl) dashboardEl.classList.remove('hidden');
  if (accountEl) accountEl.classList.add('hidden');
  if (providerEl) providerEl.classList.add('hidden');

  const dashboardTitle = document.getElementById('dashboardTitle');
  if (dashboardTitle && state.account) {
    dashboardTitle.textContent = `${state.account.name}`;
  }
}

function hideDashboard() {
  const dashboardEl = document.getElementById('dashboard');
  const accountEl = document.getElementById('account');
  const providerEl = document.getElementById('provider');
  if (dashboardEl) dashboardEl.classList.add('hidden');
  if (accountEl) accountEl.classList.remove('hidden');
  if (providerEl) providerEl.classList.remove('hidden');
}

function handleTabSwitch(e) {
  const nextTab = e.currentTarget.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === nextTab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn === e.currentTarget);
  });
}

async function loadCustomerData() {
  try {
    const [requests, quotes, jobs] = await Promise.all([
      apiCall('/customer/requests'),
      apiCall('/customer/quotes'),
      apiCall('/customer/jobs'),
    ]);

    state.leads = requests.requests || [];
    state.quotes = quotes.quotes || [];
    state.jobs = jobs.jobs || [];

    renderCustomerRequests();
    renderCustomerQuotes();
    renderCustomerJobs();
  } catch (error) {
    console.error('Failed to load customer data:', error);
  }
}

function renderCustomerRequests() {
  const container = document.getElementById('requestsList');
  if (!container) return;

  if (!state.leads || state.leads.length === 0) {
    container.innerHTML = '<div class="list-item"><p>No service requests yet.</p></div>';
    return;
  }

  container.innerHTML = state.leads.map((lead) => `
    <div class="list-item">
      <div class="item-header">
        <strong>Request #${lead.id}</strong>
        <span class="status-badge">${lead.status || 'new'}</span>
      </div>
      <p><strong>Service:</strong> ${lead.service}</p>
      <p><strong>Address:</strong> ${lead.address || '—'}</p>
      <p><strong>Submitted:</strong> ${formatDate(lead.created_at)}</p>
    </div>
  `).join('');
}

function renderCustomerQuotes() {
  const container = document.getElementById('quotesList');
  if (!container) return;

  if (!state.quotes || state.quotes.length === 0) {
    container.innerHTML = '<div class="list-item"><p>No quotes yet.</p></div>';
    return;
  }

  container.innerHTML = state.quotes.map((quote) => `
    <div class="list-item">
      <div class="item-header">
        <strong>Quote #${quote.id}</strong>
        <span class="status-badge">${quote.status}</span>
      </div>
      <p><strong>Provider:</strong> ${quote.business_name || 'Provider'}</p>
      <p><strong>Amount:</strong> ${formatCurrency(quote.amount)}</p>
      <p><strong>Scope:</strong> ${quote.scope || 'Service scope'}</p>
      <div class="nested-actions">
        <button class="btn small primary" onclick="respondToQuote(${quote.id}, 'accepted')">Accept</button>
        <button class="btn small secondary" onclick="respondToQuote(${quote.id}, 'declined')">Decline</button>
      </div>
    </div>
  `).join('');
}

function renderCustomerJobs() {
  const container = document.getElementById('jobsList');
  if (!container) return;

  if (!state.jobs || state.jobs.length === 0) {
    container.innerHTML = '<div class="list-item"><p>No jobs yet.</p></div>';
    return;
  }

  container.innerHTML = state.jobs.map((job) => `
    <div class="list-item">
      <div class="item-header">
        <strong>Job #${job.id}</strong>
        <span class="status-badge">${job.status}</span>
      </div>
      <p><strong>Service:</strong> ${job.service}</p>
      <p><strong>Scheduled:</strong> ${job.scheduled_at ? formatDate(job.scheduled_at) : 'Pending'}</p>
    </div>
  `).join('');
}

async function loadProviderData() {
  try {
    const [leads, jobs] = await Promise.all([
      apiCall('/provider/leads'),
      apiCall('/provider/jobs'),
    ]);

    state.providerLeads = leads.leads || [];
    state.providerJobs = jobs.jobs || [];

    renderProviderLeads();
    renderProviderJobs();
  } catch (error) {
    console.error('Failed to load provider data:', error);
  }
}

function renderProviderLeads() {
  const container = document.getElementById('providerLeadsList');
  if (!container) return;

  if (!state.providerLeads || state.providerLeads.length === 0) {
    container.innerHTML = '<div class="list-item"><p>No lead matches available.</p></div>';
    return;
  }

  container.innerHTML = state.providerLeads.map((lead) => `
    <div class="list-item">
      <div class="item-header">
        <strong>${lead.service}</strong>
        <span class="status-badge">Match</span>
      </div>
      <p><strong>Customer:</strong> ${lead.customer_name || 'Customer'}</p>
      <p><strong>Timing:</strong> ${lead.timing || 'Flexible'}</p>
      <p><strong>Estimate:</strong> ${formatCurrency(lead.estimate_min)} - ${formatCurrency(lead.estimate_max)}</p>
      <p><strong>Details:</strong> ${lead.details || 'No details provided.'}</p>
      <button class="btn small primary" onclick="claimLead(${lead.id})">Claim Lead</button>
    </div>
  `).join('');
}

function renderProviderJobs() {
  const container = document.getElementById('providerJobsList');
  if (!container) return;

  if (!state.providerJobs || state.providerJobs.length === 0) {
    container.innerHTML = '<div class="list-item"><p>No active jobs.</p></div>';
    return;
  }

  container.innerHTML = state.providerJobs.map((job) => `
    <div class="list-item">
      <div class="item-header">
        <strong>Job #${job.id}</strong>
        <span class="status-badge">${job.status}</span>
      </div>
      <p><strong>Service:</strong> ${job.service}</p>
      <p><strong>Customer:</strong> ${job.customer_name || 'Customer'}</p>
      <p><strong>Scheduled:</strong> ${job.scheduled_at ? formatDate(job.scheduled_at) : 'Pending'}</p>
      <button class="btn small primary" onclick="updateJobStatus(${job.id})">Update Status</button>
    </div>
  `).join('');
}

async function handleProviderSearch() {
  const industry = document.getElementById('providerIndustry')?.value || '';
  const zip = document.getElementById('providerZip')?.value || '';

  try {
    const params = new URLSearchParams();
    if (industry) params.set('industry', industry);
    if (zip) params.set('zip', zip);

    const results = await apiCall(`/marketplace/providers?${params.toString()}`);
    renderProviderSearch(results.providers || []);
  } catch (error) {
    showError(`Provider search failed: ${error.message}`);
  }
}

function renderProviderSearch(providers) {
  const container = document.getElementById('providersGrid');
  if (!container) return;

  if (!providers || providers.length === 0) {
    container.innerHTML = '<div class="list-item"><p>No providers found.</p></div>';
    return;
  }

  container.innerHTML = providers.map((p) => `
    <div class="provider-card">
      <h3>${p.business_name}</h3>
      <p><strong>Type:</strong> ${p.provider_kind}</p>
      <p><strong>Industry:</strong> ${p.industry}</p>
      <p><strong>Rating:</strong> ${p.rating || 0}/5</p>
      <p><strong>Jobs:</strong> ${p.jobs_completed || 0}</p>
      <p><strong>Verified:</strong> ${p.verified ? 'Yes' : 'No'}</p>
      <button class="btn small primary" onclick="viewProviderProfile(${p.account_id})">View Profile</button>
    </div>
  `).join('');
}

async function claimLead(leadId) {
  try {
    await apiCall(`/provider/leads/${leadId}/claim`, { method: 'POST' });
    showSuccess('Lead claimed successfully.');
    setTimeout(() => loadProviderData(), 500);
  } catch (error) {
    showError(`Failed to claim lead: ${error.message}`);
  }
}

async function respondToQuote(quoteId, decision) {
  try {
    const result = await apiCall(`/customer/quotes/${quoteId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });

    if (decision === 'accepted' && result.url) {
      window.location.href = result.url;
      return;
    }

    showSuccess(`Quote ${decision} successfully.`);
    setTimeout(() => loadCustomerData(), 500);
  } catch (error) {
    showError(`Failed to respond to quote: ${error.message}`);
  }
}

async function updateJobStatus(jobId) {
  const nextStatus = prompt('Enter new status (in_progress, completed, scheduled)');
  if (!nextStatus) return;

  try {
    await apiCall(`/provider/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus.trim() }),
    });
    showSuccess('Job status updated.');
    setTimeout(() => loadProviderData(), 500);
  } catch (error) {
    showError(`Failed to update status: ${error.message}`);
  }
}

function viewProviderProfile(providerId) {
  alert(`Provider profile view for ${providerId} is available in the next UI phase.`);
}

document.addEventListener('DOMContentLoaded', initializeApp);
