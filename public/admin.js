const loginForm = document.getElementById('loginForm');
const loginMsg = document.getElementById('loginMsg');
const login = document.getElementById('login');
const dashboard = document.getElementById('dashboard');
const logout = document.getElementById('logout');

async function checkSession() {
  try {
    const res = await fetch('/api/admin/session');
    if (res.ok) {
      login.hidden = true;
      dashboard.hidden = false;
    }
  } catch (err) {
    console.error('Session check failed:', err);
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = loginForm.querySelector('input[type="password"]').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      login.hidden = true;
      dashboard.hidden = false;
    } else {
      loginMsg.textContent = 'Invalid password';
    }
  } catch (err) {
    loginMsg.textContent = 'Error logging in';
  }
});

logout.addEventListener('click', async () => {
  try {
    await fetch('/api/admin/logout', { method: 'POST' });
    login.hidden = false;
    dashboard.hidden = true;
  } catch (err) {
    console.error('Logout failed:', err);
  }
});

checkSession();
