self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'New message received', {
    body: payload.body || 'A new anonymous message is waiting in your inbox.',
    icon: '/logo.jpg',
    badge: '/logo.jpg',
    tag: payload.tag || 'new-message',
    data: { url: '/admin/dashboard' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate('/admin/dashboard');
      return client.focus();
    }
    return self.clients.openWindow('/admin/dashboard');
  })());
});