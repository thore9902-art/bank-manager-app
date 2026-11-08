
const form = document.getElementById('createManagerForm');
const table = document.getElementById('managerTable');
const message = document.getElementById('message');
const refreshButton = document.getElementById('refreshManagers');

let csrfToken = '';

function showMessage(text) {
  message.textContent = text;
}

async function api(url, options = {}) {
  const headers = { ...options.headers };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

async function loadCsrf() {
  const result = await api('/api/master/csrf-token');
  csrfToken = result.csrfToken;
}

async function loadManagers() {
  try {
    const result = await api('/api/master/managers');
    table.replaceChildren();

    if (!result.managers.length) {
      const row = table.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 3;
      cell.textContent = 'No Managers found';
      return;
    }

    for (const manager of result.managers) {
      const row = table.insertRow();

      row.insertCell().textContent = manager.username;
      row.insertCell().textContent =
        manager.is_active ? 'Active' : 'Disabled';

      const actions = row.insertCell();

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent =
        manager.is_active ? 'Disable' : 'Enable';

      toggle.addEventListener('click', async () => {
        const action = manager.is_active ? 'disable' : 'enable';

        if (!confirm(`Do you want to ${action} ${manager.username}?`)) {
          return;
        }

        try {
          await api(
            `/api/master/managers/${manager.id}/status`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                is_active: !manager.is_active
              })
            }
          );

          showMessage('Manager status updated');
          await loadManagers();
        } catch (error) {
          showMessage(error.message);
        }
      });

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Reset Password';

      reset.addEventListener('click', async () => {
        const password = prompt(
          `Enter a new password (minimum 6 characters) for ${manager.username}:`
        );

        if (password === null) return;

        if (password.length < 6 || password.length > 128) {
          showMessage('Password must be 6-128 characters');
          return;
        }

        try {
          await api(
            `/api/master/managers/${manager.id}/reset-password`,
            {
              method: 'POST',
              body: JSON.stringify({
                newPassword: password
              })
            }
          );

          showMessage('Password reset successfully');
        } catch (error) {
          showMessage(error.message);
        }
      });

      actions.append(toggle, ' ', reset);
    }
  } catch (error) {
    showMessage(error.message);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    await api('/api/master/managers', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    form.reset();
    showMessage('Manager created successfully');
    await loadManagers();
  } catch (error) {
    showMessage(error.message);
  }
});

refreshButton.addEventListener('click', loadManagers);

(async function initialize() {
  try {
    await loadCsrf();
    await loadManagers();
  } catch (error) {
    showMessage(error.message);
  }
})();
