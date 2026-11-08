
let accounts = [];
let currentRole = '';
let editingAccountId = null;

let permissions = {
  can_view: false,
  can_add: false,
  can_edit: false,
  can_delete: false,
  can_restore: false
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function can(permission) {
  return permissions[permission] === true;
}

async function loadMyPermissions() {
  const response = await fetch('/api/google/my-permissions', {
    credentials: 'same-origin',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Unable to load permissions. Sign in again.');
  }

  const data = await response.json();
  currentRole = data.role || '';
  permissions = data.permissions || {};

  const addButton = document.getElementById('addAccountButton');
  if (addButton) addButton.hidden = !can('can_add');

  const addDialog = document.getElementById('addAccountDialog');
  if (!can('can_add') && addDialog?.open) addDialog.close();

  const editDialog = document.getElementById('editAccountDialog');
  if (!can('can_edit') && editDialog?.open) editDialog.close();

  updateActionHeading();
  renderAccounts();
}

function updateStats() {
  setText('total', accounts.length);
  setText('savings', accounts.filter(a =>
    (a.accountType || '').toLowerCase() === 'savings'
  ).length);
  setText('current', accounts.filter(a =>
    (a.accountType || '').toLowerCase() === 'current'
  ).length);
}

function renderAccounts() {
  const search = (document.getElementById('search')?.value || '')
    .toLowerCase().trim();
  const filter = document.getElementById('filter')?.value || '';
  const tbody = document.getElementById('connectedAccountsTable');
  if (!tbody) return;

  tbody.replaceChildren();

  const filtered = accounts.filter(account => {
    const searchable = [
      account.accountHolder,
      account.bankName,
      account.accountLast4
    ].join(' ').toLowerCase();

    return searchable.includes(search) &&
      (!filter || account.accountType === filter);
  });

  const hasActions = can('can_edit') || can('can_delete');

  if (!filtered.length) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = hasActions ? 8 : 7;
    cell.textContent = 'No matching accounts found.';
    return;
  }

  filtered.forEach(account => {
    const row = tbody.insertRow();

    const values = [
      account.accountHolder,
      account.bankName,
      account.accountLast4 ? '•••• ' + account.accountLast4 : '',
      account.ifscCode,
      account.branch,
      account.accountType,
      account.status
    ];

    values.forEach(value => {
      row.insertCell().textContent = value || '-';
    });

    if (hasActions) {
      const actionCell = row.insertCell();

      if (can('can_edit')) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = 'Edit';
        editButton.className = 'edit-account-button';
        editButton.addEventListener('click', () => {
          openEditAccount(account.id);
        });
        actionCell.appendChild(editButton);
      }

      if (can('can_delete')) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.className = 'delete-account-button';

        deleteButton.addEventListener('click', async () => {
          if (!can('can_delete')) return;

          if (!confirm(
            'Move ' + account.accountHolder + ' to the Recycle Bin?'
          )) return;

          deleteButton.disabled = true;

          try {
            const csrfToken = await getCsrfToken();
            const response = await fetch(
              '/api/google/accounts/' + encodeURIComponent(account.id),
              {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: { 'X-CSRF-Token': csrfToken }
              }
            );

            const result = await response.json();
            if (!response.ok) {
              throw new Error(result.error || 'Delete failed');
            }

            await loadBankAccounts();
            await loadTrashAccounts();
            if (result.warning) alert(result.warning);
          } catch (error) {
            alert(error.message);
            console.error(error);
          } finally {
            deleteButton.disabled = false;
          }
        });

        actionCell.appendChild(deleteButton);
      }
    }
  });
}

function updateActionHeading() {
  const table = document.getElementById('connectedAccountsTable');
  const headerRow = table?.closest('table')?.querySelector('thead tr');
  if (!headerRow) return;

  let heading = headerRow.querySelector('[data-edit-actions-heading]');
  const hasActions = can('can_edit') || can('can_delete');

  if (hasActions && !heading) {
    heading = document.createElement('th');
    heading.textContent = 'Actions';
    heading.scope = 'col';
    heading.dataset.editActionsHeading = 'true';
    headerRow.appendChild(heading);
  } else if (!hasActions && heading) {
    heading.remove();
  }
}

async function loadBankAccounts() {
  const message = document.getElementById('connectedAccountsMessage');
  const button = document.getElementById('refreshAccountsButton');

  if (!can('can_view')) {
    accounts = [];
    updateStats();
    renderAccounts();
    if (message) {
      message.textContent = 'Account viewing is not permitted.';
      message.className = 'error';
    }
    return;
  }

  if (button) button.disabled = true;
  if (message) message.textContent = 'Loading accounts...';

  try {
    const response = await fetch('/api/google/accounts', {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) {
      let errorMessage = 'Unable to load accounts: HTTP ' + response.status;
      if (response.status === 401) {
        errorMessage = 'Login required. Please sign in again.';
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    accounts = Array.isArray(data.accounts) ? data.accounts : [];
    currentRole = data.role || currentRole;

    updateStats();
    updateActionHeading();
    renderAccounts();

    if (message) {
      message.textContent =
        accounts.length + ' accounts loaded successfully.';
      message.className = 'success';
    }
  } catch (error) {
    accounts = [];
    updateStats();
    renderAccounts();
    if (message) {
      message.textContent = error.message;
      message.className = 'error';
    }
    console.error('Google Sheets error:', error);
  } finally {
    if (button) button.disabled = false;
  }
}

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf-token', {
    credentials: 'same-origin',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Login expired. Please sign in again.');
  }

  const data = await response.json();
  if (!data.csrfToken) throw new Error('CSRF token missing');
  return data.csrfToken;
}

function openEditAccount(accountId) {
  if (!can('can_edit')) return;

  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    alert('Account not found. Refresh the dashboard.');
    return;
  }

  const dialog = document.getElementById('editAccountDialog');
  const form = document.getElementById('editAccountForm');
  const message = document.getElementById('editAccountMessage');

  if (!dialog || !form || !message) {
    alert('Edit Account form is not installed yet.');
    return;
  }

  editingAccountId = accountId;

 
[
  'accountHolder',
  'bankName',
  'accountLast4',
  'ifscCode',
  'branch',
  'accountType',
  'status',
  'cardLast4',
  'note',
  'email',
  'reference',
  'aadhaarLast4',
  'pan',
  'motherName'
].forEach(name => {
  const input = form.elements.namedItem(name);
  if (input) input.value = account[name] || '';
});


  message.textContent = '';
  dialog.showModal();
}

function setupEditAccount() {
  const dialog = document.getElementById('editAccountDialog');
  const form = document.getElementById('editAccountForm');
  const cancelButton = document.getElementById('cancelEditAccount');
  const saveButton = document.getElementById('saveEditAccountButton');
  const message = document.getElementById('editAccountMessage');

  if (!dialog || !form || !cancelButton || !saveButton || !message) {
    return;
  }

  cancelButton.addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    editingAccountId = null;
    message.textContent = '';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (!can('can_edit') || !editingAccountId) {
      message.textContent = 'Access denied';
      return;
    }

    saveButton.disabled = true;
    message.textContent = 'Updating account...';

    try {
      const csrfToken = await getCsrfToken();
      const data = Object.fromEntries(new FormData(form).entries());

      const response = await fetch(
        '/api/google/accounts/' + encodeURIComponent(editingAccountId),
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify(data)
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Account update failed');
      }

      if (result.warning) {
        message.textContent = result.warning;
        await loadBankAccounts();
        return;
      }

      dialog.close();
      await loadBankAccounts();
    } catch (error) {
      message.textContent = error.message;
      console.error('Edit Account error:', error);
    } finally {
      saveButton.disabled = false;
    }
  });
}

function setupAddAccount() {
  const openButton = document.getElementById('addAccountButton');
  const dialog = document.getElementById('addAccountDialog');
  const form = document.getElementById('addAccountForm');
  const cancelButton = document.getElementById('cancelAddAccount');
  const saveButton = document.getElementById('saveAccountButton');
  const message = document.getElementById('addAccountMessage');

  if (!openButton || !dialog || !form ||
      !cancelButton || !saveButton || !message) return;

  openButton.addEventListener('click', () => {
    if (!can('can_add')) return;
    message.textContent = '';
    dialog.showModal();
  });

  cancelButton.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (!can('can_add')) {
      message.textContent = 'Permission denied';
      return;
    }

    saveButton.disabled = true;
    message.textContent = 'Saving account...';

    try {
      const csrfToken = await getCsrfToken();
      const data = Object.fromEntries(new FormData(form).entries());

      const response = await fetch('/api/google/accounts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Save failed');

      form.reset();

      if (result.warning) {
        message.textContent = result.warning;
        await loadBankAccounts();
        return;
      }

      dialog.close();
      await loadBankAccounts();
    } catch (error) {
      message.textContent = error.message;
      console.error('Add Account error:', error);
    } finally {
      saveButton.disabled = false;
    }
  });
}

async function loadTrashAccounts() {
  const tbody = document.getElementById('trashAccountsTable');
  if (!tbody) return;

  function showMessage(text) {
    tbody.replaceChildren();
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.textContent = text;
  }

  if (!can('can_restore')) {
    showMessage('Recycle Bin is not available for your account.');
    return;
  }

  showMessage('Loading Recycle Bin...');

  try {
    const response = await fetch('/api/google/trash', {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) {
      let errorMessage = 'Unable to load Recycle Bin: HTTP ' + response.status;
      try {
        const data = await response.json();
        if (data.error) errorMessage = data.error;
      } catch (_) {}
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const records = Array.isArray(data.accounts) ? data.accounts : [];

    tbody.replaceChildren();

    if (!records.length) {
      showMessage('Recycle Bin is empty.');
      return;
    }

    records.forEach(account => {
      const row = tbody.insertRow();

      [
        account.accountHolder,
        account.bankName,
        account.accountLast4 ? '•••• ' + account.accountLast4 : '-',
        account.deletedAt || '-'
      ].forEach(value => {
        row.insertCell().textContent = value || '-';
      });

      const actionCell = row.insertCell();
      const restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.textContent = 'Restore';
      restoreButton.className = 'primary';

      restoreButton.addEventListener('click', async () => {
        if (!can('can_restore')) return;
        if (!confirm(
          'Restore account for ' + account.accountHolder + '?'
        )) return;

        restoreButton.disabled = true;

        try {
          const csrfToken = await getCsrfToken();
          const response = await fetch(
            '/api/google/trash/' +
            encodeURIComponent(account.id) + '/restore',
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'X-CSRF-Token': csrfToken }
            }
          );

          let result;
          try {
            result = await response.json();
          } catch (_) {
            throw new Error(
              'Unexpected server response. Check Google Sheets before retrying.'
            );
          }

          if (!response.ok) {
            throw new Error(result.error || 'Restore failed');
          }

          await loadBankAccounts();
          await loadTrashAccounts();

          alert(result.warning || 'Account restored successfully.');
        } catch (error) {
          alert(error.message);
          console.error('Restore Account error:', error);
        } finally {
          restoreButton.disabled = false;
        }
      });

      actionCell.appendChild(restoreButton);
    });
  } catch (error) {
    showMessage(error.message);
    console.error('Recycle Bin error:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const refresh = document.getElementById('refreshAccountsButton');

  async function refreshDashboard() {
    try {
      await loadMyPermissions();
      await loadBankAccounts();
      await loadTrashAccounts();
    } catch (error) {
      accounts = [];
      permissions = {
        can_view: false,
        can_add: false,
        can_edit: false,
        can_delete: false,
        can_restore: false
      };

      const addButton = document.getElementById('addAccountButton');
      if (addButton) addButton.hidden = true;

      updateStats();
      updateActionHeading();
      renderAccounts();
      setText('connectedAccountsMessage', error.message);
      console.error(error);
    }
  }

  refresh?.addEventListener('click', refreshDashboard);

  document.getElementById('search')
    ?.addEventListener('input', renderAccounts);

  document.getElementById('filter')
    ?.addEventListener('change', renderAccounts);

  document.getElementById('resetFiltersButton')
    ?.addEventListener('click', () => {
      document.getElementById('search').value = '';
      document.getElementById('filter').value = '';
      renderAccounts();
    });

  setupAddAccount();
  setupEditAccount();
  refreshDashboard();
});
