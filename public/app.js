const app = document.getElementById('app');

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    app.innerHTML = `<h2>${data.businessName || 'SwiftQuote'}</h2><p>Welcome! This is the customer quote portal.</p>`;
  } catch (err) {
    console.error('Failed to load config:', err);
    app.innerHTML = '<p>Error loading app. Please refresh.</p>';
  }
}

loadConfig();
