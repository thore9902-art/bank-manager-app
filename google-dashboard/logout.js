
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('logoutButton');

  if (!button) return;

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Logging out...';

    try {
      // Get the CSRF token required by the server
      const tokenResponse = await fetch('/api/auth/csrf-token', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (!tokenResponse.ok) {
        throw new Error('Unable to verify session');
      }

      const { csrfToken } = await tokenResponse.json();

      // Destroy the login session
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': csrfToken
        }
      });

      if (!response.ok) {
        throw new Error('Logout failed');
      }

      // Redirect to login after successful logout
      window.location.replace('/master/login');
    } catch (error) {
      console.error('Logout error:', error);
      alert('Unable to log out. Please try again.');
      button.disabled = false;
      button.textContent = 'Logout';
    }
  });
});
