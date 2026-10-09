// SwiftQuote Marketplace App - Complete Implementation
const API_BASE = '/api';
const COOKIE_NAME = '__Host-sq_account' // HttpOnly in production, but use header auth

let currentUser = null;
let userType = null; // 'customer' or 'provider'
let csrfToken = null;

// ============= INITIALIZATION =============

async function initApp() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    const config = await res.json();
    document.title = `${config.appName || 'SwiftQuote'} — Service Marketplace`;
    
    // Load services
    await loadServices();
    
    // Check if user is logged in
    checkAuthStatus();
  } catch (err) {
    console.error('Failed to initialize app:', err);
  }
}

// ============= AUTH =============

async function checkAuthStatus() {
  try {
    const res = await fetch(`${API_BASE}/account/me`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    
    if (res.ok) {
      const data = await res.json();
      currentUser = data;
      userType = data.account_type;
      
      if (userType === 'customer') {
        showCustomerDashboard();
      } else if (userType === 'provider') {
        showProviderDashboard();
      }
    }
  } catch (err) {
    console.error('Auth check failed:', err);
  }
}

function toggleForm(formId) {
  const forms = document.querySelectorAll('.form');
  forms.forEach(f => f.classList.add('hidden'));
  
  if (formId === 'customer-login') document.getElementById('customerLoginForm')?.classList.remove('hidden');
  if (formId === 'customer-register') document.getElementById('customerRegisterForm')?.classList.remove('hidden');
  if (formId === 'provider-login') document.getElementById('providerLoginForm')?.classList.remove('hidden');
  if (formId === 'provider-register') document.getElementById('providerRegisterForm')?.classList.remove('hidden');
}

// ============= SERVICES =============

async function loadServices() {
  try {
    const res = await fetch(`${API_BASE}/marketplace/services`);
    const { services } = await res.json();
    
    const servicesList = document.getElementById('servicesList');
    const serviceSelect = document.getElementById('serviceSelect');
    
    servicesList.innerHTML = '';
    serviceSelect.innerHTML = '<option value="">Select a service...</option>';
    
    const seen = new Set();
    services.forEach(service => {
      if (!seen.has(service.id)) {
        seen.add(service.id);
        
        // Service card
        const card = document.createElement('div');
        card.className = 'service-card';
        card.innerHTML = `<p class="service-name">${service.label}</p>`;
        card.addEventListener('click', () => {
          document.getElementById('serviceSelect').value = service.id;
          document.getElementById('marketRequestForm').scrollIntoView({ behavior: 'smooth' });
        });
        servicesList.appendChild(card);
        
        // Service option
        const opt = document.createElement('option');
        opt.value = service.id;
        opt.textContent = service.label;
        serviceSelect.appendChild(opt);
      }
    });
  } catch (err) {
    console.error('Failed to load services:', err);
  }
}

// ============= CUSTOMER FUNCTIONS =============

function showCustomerDashboard() {
  document.getElementById('account').classList.add('hidden');
  document.getElementById('customer-dashboard').classList.remove('hidden');
  loadCustomerRequests();
  loadCustomerQuotes();
  loadCustomerJobs();
  
  document.getElementById('logoutBtn').addEventListener('click', logoutCustomer);
}

async function logoutCustomer() {
  try {
    await fetch(`${API_BASE}/account/logout`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    currentUser = null;
    userType = null;
    document.getElementById('customer-dashboard').classList.add('hidden');
    document.getElementById('account').classList.remove('hidden');
    document.getElementById('customerLoginForm').classList.remove('hidden');
    document.getElementById('customerRegisterForm').classList.add('hidden');
  } catch (err) {
    console.error('Logout failed:', err);
  }
}

async function loadCustomerRequests() {
  try {
    const res = await fetch(`${API_BASE}/customer/requests`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { requests } = await res.json();
    
    const container = document.getElementById('customerRequests');
    container.innerHTML = '';
    
    if (!requests || requests.length === 0) {
      container.innerHTML = '<div class="empty-state"><p class="empty-state-text">No service requests yet. Create one below!</p></div>';
      return;
    }
    
    requests.forEach(req => {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `
        <div class="list-card-header">
          <div>
            <p class="list-card-title">${req.service}</p>
            <p class="list-card-meta">${new Date(req.created_at).toLocaleDateString()}</p>
          </div>
          <span class="status-badge status-${req.status}">${req.status}</span>
        </div>
        <p>${req.details}</p>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load requests:', err);
  }
}

async function loadCustomerQuotes() {
  try {
    const res = await fetch(`${API_BASE}/customer/quotes`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { quotes } = await res.json();
    
    const container = document.getElementById('customerQuotes');
    container.innerHTML = '';
    
    if (!quotes || quotes.length === 0) {
      container.innerHTML = '<div class="empty-state"><p class="empty-state-text">No quotes yet. Submit a request to receive quotes from providers.</p></div>';
      return;
    }
    
    quotes.forEach(quote => {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `
        <div class="list-card-header">
          <div>
            <p class="list-card-title">${quote.business_name}</p>
            <p class="list-card-meta">${new Date(quote.created_at).toLocaleDateString()} • Rating: ${quote.rating}/5</p>
          </div>
          <span class="status-badge status-${quote.status}">$${(quote.amount / 100).toFixed(2)}</span>
        </div>
        <p>${quote.scope || 'Service quote'}</p>
        <div class="list-card-actions">
          <button class="btn btn-primary btn-small" onclick="acceptQuote(${quote.id})">Accept</button>
          <button class="btn btn-small" onclick="declineQuote(${quote.id})" style="background: #4b5563; color: white;">Decline</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load quotes:', err);
  }
}

async function acceptQuote(quoteId) {
  try {
    const res = await fetch(`${API_BASE}/customer/quotes/${quoteId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || ''
      },
      body: JSON.stringify({ decision: 'accepted' })
    });
    
    if (res.ok) {
      alert('Quote accepted! Proceeding to payment...');
      loadCustomerQuotes();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (err) {
    console.error('Failed to accept quote:', err);
  }
}

async function declineQuote(quoteId) {
  try {
    const res = await fetch(`${API_BASE}/customer/quotes/${quoteId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || ''
      },
      body: JSON.stringify({ decision: 'declined' })
    });
    
    if (res.ok) {
      alert('Quote declined.');
      loadCustomerQuotes();
    }
  } catch (err) {
    console.error('Failed to decline quote:', err);
  }
}

async function loadCustomerJobs() {
  try {
    const res = await fetch(`${API_BASE}/customer/jobs`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { jobs } = await res.json();
    
    const container = document.getElementById('customerJobs');
    container.innerHTML = '';
    
    if (!jobs || jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><p class="empty-state-text">No active jobs yet.</p></div>';
      return;
    }
    
    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `
        <div class="list-card-header">
          <div>
            <p class="list-card-title">Job #${job.id} — ${job.service}</p>
            <p class="list-card-meta">Scheduled: ${job.scheduled_at ? new Date(job.scheduled_at).toLocaleDateString() : 'Not scheduled'}</p>
          </div>
          <span class="status-badge status-${job.status}">${job.status}</span>
        </div>
        <div class="list-card-actions">
          <button class="btn btn-primary btn-small" onclick="viewJobDetails(${job.id})">View Details</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

function viewJobDetails(jobId) {
  alert(`Job #${jobId} details would open in a detailed view.`);
}

// ============= PROVIDER FUNCTIONS =============

function showProviderDashboard() {
  document.getElementById('provider').classList.add('hidden');
  document.getElementById('provider-dashboard').classList.remove('hidden');
  loadProviderLeads();
  loadProviderJobs();
  loadProviderProfile();
  loadProviderTrust();
  loadSubscriptionStatus();
  
  document.getElementById('providerLogoutBtn').addEventListener('click', logoutProvider);
}

async function logoutProvider() {
  try {
    await fetch(`${API_BASE}/account/logout`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    currentUser = null;
    userType = null;
    document.getElementById('provider-dashboard').classList.add('hidden');
    document.getElementById('provider').classList.remove('hidden');
    document.getElementById('providerLoginForm').classList.remove('hidden');
    document.getElementById('providerRegisterForm').classList.add('hidden');
  } catch (err) {
    console.error('Logout failed:', err);
  }
}

async function loadProviderLeads() {
  try {
    const res = await fetch(`${API_BASE}/provider/leads`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { leads } = await res.json();
    
    const container = document.getElementById('providerLeads');
    container.innerHTML = '';
    
    if (!leads || leads.length === 0) {
      container.innerHTML = '<div class="empty-state"><p class="empty-state-text">No leads available. Upgrade your subscription to receive more leads.</p></div>';
      return;
    }
    
    leads.forEach(lead => {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `
        <div class="list-card-header">
          <div>
            <p class="list-card-title">${lead.name} — ${lead.service}</p>
            <p class="list-card-meta">${lead.timing} • Lead Score: ${lead.lead_score}/100</p>
          </div>
          <span class="status-badge status-new">New Lead</span>
        </div>
        <p><strong>Location:</strong> ${lead.address}</p>
        <p><strong>Details:</strong> ${lead.details}</p>
        <div class="list-card-actions">
          <button class="btn btn-primary btn-small" onclick="claimLead(${lead.id})">Claim Lead</button>
          <button class="btn btn-small" onclick="submitQuote(${lead.id})" style="background: #4b5563; color: white;">Submit Quote</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load leads:', err);
  }
}

async function claimLead(leadId) {
  try {
    const res = await fetch(`${API_BASE}/provider/leads/${leadId}/claim`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    
    if (res.ok) {
      alert('Lead claimed! You can now submit a quote.');
      loadProviderLeads();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (err) {
    console.error('Failed to claim lead:', err);
  }
}

function submitQuote(leadId) {
  const amount = prompt('Enter quote amount ($):');
  if (!amount) return;
  
  const scope = prompt('Enter scope of work:');
  if (!scope) return;
  
  submitQuoteRequest(leadId, parseInt(amount) * 100, scope);
}

async function submitQuoteRequest(leadId, amount, scope) {
  try {
    const res = await fetch(`${API_BASE}/provider/leads/${leadId}/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || ''
      },
      body: JSON.stringify({ amount, scope })
    });
    
    if (res.ok) {
      alert('Quote submitted successfully!');
      loadProviderLeads();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (err) {
    console.error('Failed to submit quote:', err);
  }
}

async function loadProviderJobs() {
  try {
    const res = await fetch(`${API_BASE}/provider/jobs`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { jobs } = await res.json();
    
    const container = document.getElementById('providerJobs');
    container.innerHTML = '';
    
    if (!jobs || jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><p class="empty-state-text">No active jobs yet.</p></div>';
      return;
    }
    
    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `
        <div class="list-card-header">
          <div>
            <p class="list-card-title">Job #${job.id} — ${job.service}</p>
            <p class="list-card-meta">Scheduled: ${job.scheduled_at ? new Date(job.scheduled_at).toLocaleDateString() : 'Not scheduled'}</p>
          </div>
          <span class="status-badge status-${job.status}">${job.status}</span>
        </div>
        <div class="list-card-actions">
          <button class="btn btn-primary btn-small" onclick="updateJobStatus(${job.id}, 'in_progress')">Mark In Progress</button>
          <button class="btn btn-small" onclick="updateJobStatus(${job.id}, 'completed')" style="background: var(--success); color: white;">Complete</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

async function updateJobStatus(jobId, status) {
  try {
    const res = await fetch(`${API_BASE}/provider/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || ''
      },
      body: JSON.stringify({ status })
    });
    
    if (res.ok) {
      alert(`Job status updated to ${status}`);
      loadProviderJobs();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (err) {
    console.error('Failed to update job:', err);
  }
}

async function loadProviderProfile() {
  try {
    const res = await fetch(`${API_BASE}/account/me`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { profile } = await res.json();
    
    if (profile) {
      document.getElementById('businessName').value = profile.business_name || '';
      document.getElementById('providerIndustry').value = profile.industry || '';
      document.getElementById('providerServices').value = profile.services_json ? JSON.parse(profile.services_json).join(', ') : '';
      document.getElementById('serviceArea').value = profile.zip_codes || '';
      document.getElementById('providerDescription').value = profile.description || '';
    }
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

async function loadProviderTrust() {
  try {
    const res = await fetch(`${API_BASE}/account/trust-graph`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { rating, verified, jobsCompleted } = await res.json();
    
    document.getElementById('trustScore').textContent = `${rating.toFixed(1)}/5`;
    document.getElementById('trustDetails').textContent = `${jobsCompleted} jobs completed • ${verified ? 'Verified' : 'Not verified'}`;
  } catch (err) {
    console.error('Failed to load trust:', err);
  }
}

async function loadSubscriptionStatus() {
  try {
    const res = await fetch(`${API_BASE}/provider/usage`, {
      headers: { 'X-CSRF-Token': csrfToken || '' }
    });
    const { plan, status, used, limit } = await res.json();
    
    const statusDiv = document.getElementById('subscriptionStatus');
    statusDiv.innerHTML = `
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Status:</strong> ${status}</p>
      <p><strong>Leads:</strong> ${used}/${limit}</p>
    `;
  } catch (err) {
    console.error('Failed to load subscription:', err);
  }
}

// ============= TAB SWITCHING =============

function switchTab(tabName) {
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(t => t.classList.remove('active'));
  document.getElementById(tabName)?.classList.add('active');
  
  const btns = document.querySelectorAll('.tab-btn');
  btns.forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

function switchProviderTab(tabName) {
  switchTab(tabName);
}

// ============= FORM HANDLERS =============

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  
  // Customer login
  document.getElementById('customerLoginForm')?.addEventListener('submit', handleCustomerLogin);
  document.getElementById('customerRegisterForm')?.addEventListener('submit', handleCustomerRegister);
  document.getElementById('providerLoginForm')?.addEventListener('submit', handleProviderLogin);
  document.getElementById('providerRegisterForm')?.addEventListener('submit', handleProviderRegister);
  document.getElementById('marketRequestForm')?.addEventListener('submit', handleMarketRequest);
  document.getElementById('providerProfileForm')?.addEventListener('submit', handleProviderProfileSave);
});

async function handleCustomerLogin(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.querySelector('input[type="email"]').value;
  const password = form.querySelector('input[type="password"]').value;
  
  try {
    const res = await fetch(`${API_BASE}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
      currentUser = { email, account_type: 'customer' };
      userType = 'customer';
      showCustomerDashboard();
    } else {
      alert('Login failed. Please check your email and password.');
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Login failed.');
  }
}

async function handleCustomerRegister(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.querySelector('input[type="email"]').value;
  const password = form.querySelector('input[type="password"]').value;
  
  if (password.length < 8) {
    alert('Password must be at least 8 characters.');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accountType: 'customer' })
    });
    
    if (res.ok) {
      alert('Account created! Please log in.');
      toggleForm('customer-login');
    } else {
      const err = await res.json();
      alert(`Registration failed: ${err.error}`);
    }
  } catch (err) {
    console.error('Register error:', err);
    alert('Registration failed.');
  }
}

async function handleProviderLogin(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.querySelector('input[type="email"]').value;
  const password = form.querySelector('input[type="password"]').value;
  
  try {
    const res = await fetch(`${API_BASE}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
      currentUser = { email, account_type: 'provider' };
      userType = 'provider';
      showProviderDashboard();
    } else {
      alert('Login failed.');
    }
  } catch (err) {
    console.error('Login error:', err);
  }
}

async function handleProviderRegister(e) {
  e.preventDefault();
  const form = e.target;
  const inputs = form.querySelectorAll('input, select');
  const email = inputs[0].value;
  const password = inputs[1].value;
  const businessName = inputs[2].value;
  const providerKind = inputs[3].value;
  
  if (password.length < 8) {
    alert('Password must be at least 8 characters.');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accountType: 'provider', businessName, providerKind })
    });
    
    if (res.ok) {
      alert('Account created! Please log in.');
      toggleForm('provider-login');
    } else {
      const err = await res.json();
      alert(`Registration failed: ${err.error}`);
    }
  } catch (err) {
    console.error('Register error:', err);
  }
}

async function handleMarketRequest(e) {
  e.preventDefault();
  const form = e.target;
  const service = form.querySelector('#serviceSelect').value;
  const details = form.querySelector('#details').value;
  const zipCode = form.querySelector('#zipCode').value;
  const timing = form.querySelector('#timing').value;
  
  if (!service || !details || !zipCode || !timing) {
    alert('Please complete all fields.');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/marketplace/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, details, zipCode, timing })
    });
    
    if (res.ok) {
      document.getElementById('requestMsg').className = 'message success';
      document.getElementById('requestMsg').textContent = 'Request submitted! Providers will send you quotes.';
      form.reset();
      setTimeout(() => {
        document.getElementById('requestMsg').textContent = '';
      }, 5000);
    } else {
      const err = await res.json();
      document.getElementById('requestMsg').className = 'message error';
      document.getElementById('requestMsg').textContent = `Error: ${err.error}`;
    }
  } catch (err) {
    console.error('Request error:', err);
  }
}

async function handleProviderProfileSave(e) {
  e.preventDefault();
  alert('Profile update not fully implemented yet. Use the API directly.');
}
