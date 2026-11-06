
(async function showMasterNavigation() {
  try {
    const response = await fetch('/api/google/my-permissions', {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) return;

    const data = await response.json();

    if (data.role === 'MASTER') {
      const link = document.querySelector(
        '.sidebar a[href="/master/users"]'
      );

      if (link) {
        link.style.display = 'block';
      }
    }
  } catch (error) {
    console.error('Unable to load navigation permissions', error);
  }
})();
