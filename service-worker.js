// ============================================
// SERVICE WORKER ДЛЯ OFFLINE PWA
// ============================================

const CACHE_NAME = 'well-sampling-v1';
const RUNTIME_CACHE = 'well-sampling-runtime-v1';
const DB_NAME = 'well_sampling_db';

// Список файлов для предварительного кэширования
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/styles/main.css',
  '/styles/responsive.css',
  '/js/app.js',
  '/js/database.js',
  '/js/utils.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ============ УСТАНОВКА ============
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching precache URLs');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        console.log('[SW] Install completed');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[SW] Install error:', error);
      })
  );
});

// ============ АКТИВАЦИЯ ============
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ============ FETCH HANDLER ============
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Игнорируем non-GET и chrome-extension
  if (event.request.method !== 'GET' || 
      url.protocol === 'chrome-extension:' ||
      url.pathname.includes('/api/internal')) {
    return;
  }

  // ===== API ЗАПРОСЫ: Network-first =====
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(event.request));
  }
  // ===== СТАТИЧЕСКИЕ РЕСУРСЫ: Cache-first =====
  else if (url.pathname.match(/\.(js|css|png|jpg|svg|woff|woff2)$/)) {
    event.respondWith(cacheFirstStrategy(event.request));
  }
  // ===== HTML: Stale-while-revalidate =====
  else {
    event.respondWith(staleWhileRevalidateStrategy(event.request));
  }
});

// ===== СТРАТЕГИЯ: Network First =====
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    
    // Кэшируем успешные ответы
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // При ошибке сети возвращаем кэш
    const cachedResponse = await caches.match(request);
    return cachedResponse || createOfflineResponse();
  }
}

// ===== СТРАТЕГИЯ: Cache First =====
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // Возвращаем заглушку для изображений
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#eee" width="200" height="200"/></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    
    return createOfflineResponse();
  }
}

// ===== СТРАТЕГИЯ: Stale-While-Revalidate =====
async function staleWhileRevalidateStrategy(request) {
  const cachedResponse = await caches.match(request);
  
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      const cache = caches.open(RUNTIME_CACHE);
      cache.then(c => c.put(request, response.clone()));
    }
    return response;
  });

  return cachedResponse || fetchPromise;
}

// ===== СОЗДАНИЕ ОФЛАЙН ОТВЕТА =====
function createOfflineResponse() {
  return new Response(
    `<!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Офлайн</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        h1 { color: #333; }
        p { color: #666; }
      </style>
    </head>
    <body>
      <h1>📡 Нет соединения</h1>
      <p>Приложение работает в офлайн режиме.</p>
      <p>Проверьте подключение к интернету.</p>
    </body>
    </html>`,
    {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

// ============ BACKGROUND SYNC ============
self.addEventListener('sync', event => {
  console.log('[SW] Background Sync:', event.tag);
  
  if (event.tag === 'sync-samples') {
    event.waitUntil(syncSamples());
  } else if (event.tag === 'sync-duplicates') {
    event.waitUntil(syncDuplicates());
  }
});

async function syncSamples() {
  try {
    const db = await openDB();
    const unsyncedSamples = await getAllUnsyncedSamples(db);
    
    console.log('[SW] Syncing', unsyncedSamples.length, 'samples');
    
    for (const sample of unsyncedSamples) {
      try {
        const response = await fetch('/api/samples', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sample)
        });
        
        if (response.ok) {
          await markAsSynced(db, sample.well_id);
          console.log('[SW] Synced sample:', sample.well_id);
        }
      } catch (error) {
        console.error('[SW] Failed to sync sample:', error);
      }
    }
    
    // Уведомляем все клиенты об успешной синхронизации
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'sync-complete',
        count: unsyncedSamples.length
      });
    });
    
  } catch (error) {
    console.error('[SW] Sync failed:', error);
    throw error;
  }
}

async function syncDuplicates() {
  try {
    const db = await openDB();
    const unsyncedDuplicates = await getAllUnsyncedDuplicates(db);
    
    console.log('[SW] Syncing', unsyncedDuplicates.length, 'duplicates');
    
    for (const duplicate of unsyncedDuplicates) {
      try {
        const response = await fetch('/api/duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(duplicate)
        });
        
        if (response.ok) {
          await markDuplicateAsSynced(db, duplicate.duplicate_id);
        }
      } catch (error) {
        console.error('[SW] Failed to sync duplicate:', error);
      }
    }
    
  } catch (error) {
    console.error('[SW] Duplicate sync failed:', error);
  }
}

// ============ PUSH NOTIFICATIONS ============
self.addEventListener('push', event => {
  console.log('[SW] Push notification:', event);
  
  const options = {
    body: event.data?.text() || 'Новое уведомление',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [200, 100, 200],
    tag: 'notification',
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification('Паспорт опробования', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then(clientList => {
        // Если окно уже открыто, фокусируемся на нём
        for (let client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        // Если нет, открываем новое окно
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// ============ MESSAGE HANDLERS ============
self.addEventListener('message', event => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ============ DATABASE HELPERS ============
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('wells')) {
        const wellStore = db.createObjectStore('wells', { keyPath: 'well_id' });
        wellStore.createIndex('synced', 'synced', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('duplicates')) {
        const dupStore = db.createObjectStore('duplicates', { keyPath: 'duplicate_id' });
        dupStore.createIndex('synced', 'synced', { unique: false });
      }
    };
  });
}

function getAllUnsyncedSamples(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('wells', 'readonly');
    const store = tx.objectStore('wells');
    const index = store.index('synced');
    const request = index.getAll(0);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function getAllUnsyncedDuplicates(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('duplicates', 'readonly');
    const store = tx.objectStore('duplicates');
    const index = store.index('synced');
    const request = index.getAll(0);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function markAsSynced(db, wellId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('wells', 'readwrite');
    const store = tx.objectStore('wells');
    const request = store.get(wellId);
    
    request.onsuccess = () => {
      const well = request.result;
      well.synced = 1;
      store.put(well);
    };
    
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
  });
}

function markDuplicateAsSynced(db, duplicateId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('duplicates', 'readwrite');
    const store = tx.objectStore('duplicates');
    const request = store.get(duplicateId);
    
    request.onsuccess = () => {
      const duplicate = request.result;
      duplicate.synced = 1;
      store.put(duplicate);
    };
    
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
  });
}

console.log('[SW] Service Worker loaded');
