const CACHE_NAME = 'pos-offline-v25';
const PRODUCT_IMAGES_CACHE = 'pos-product-images-v1';
const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './style.css?v=2.1',
    './script.js?v=3.9',
    './convex-config.js',
    './vendor/convex.browser.bundle.js',
    './icon-192.png',
    './icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.all(
                urlsToCache.map(url => cache.add(url).catch(() => undefined))
            ))
            .then(() => self.skipWaiting())
    );
});

async function cacheProductImages(urls) {
    const imageCache = await caches.open(PRODUCT_IMAGES_CACHE);
    const uniqueUrls = [...new Set((Array.isArray(urls) ? urls : []).filter(url =>
        typeof url === 'string' && /^https:\/\//i.test(url)
    ))];
    let nextIndex = 0;

    async function cacheNextImage() {
        while (nextIndex < uniqueUrls.length) {
            const url = uniqueUrls[nextIndex++];
            try {
                if (await imageCache.match(url)) continue;
                const request = new Request(url, { mode: 'no-cors', credentials: 'omit' });
                const response = await fetch(request);
                if (response && (response.ok || response.type === 'opaque')) {
                    await imageCache.put(request, response.clone());
                }
            } catch (error) {
                // تبقى الصورة قابلة للتنزيل في المحاولة التالية عند عودة الاتصال.
            }
        }
    }

    const workerCount = Math.min(4, uniqueUrls.length);
    await Promise.all(Array.from({ length: workerCount }, () => cacheNextImage()));
}

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CACHE_PRODUCT_IMAGES') {
        event.waitUntil(cacheProductImages(event.data.urls));
    }
});

function isRemoteProductImage(request) {
    if (request.method !== 'GET' || request.destination !== 'image') return false;
    const hostname = new URL(request.url).hostname;
    return hostname === 'i.ibb.co' || hostname.endsWith('.i.ibb.co') ||
        hostname.endsWith('.convex.cloud') || hostname.endsWith('.convex.site');
}

function createOfflineImagePlaceholder() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
            <rect width="400" height="400" fill="#2a2a2a"/>
            <path d="M105 285l70-80 50 55 35-40 55 65H105z" fill="#777"/>
            <circle cx="145" cy="135" r="30" fill="#777"/>
        </svg>`;
    return new Response(svg, {
        headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'no-store'
        }
    });
}

async function getCachedProductImage(request) {
    const imageCache = await caches.open(PRODUCT_IMAGES_CACHE);
    const cachedImage = await imageCache.match(request);
    if (cachedImage) return cachedImage;

    try {
        const networkImage = await fetch(request);
        if (networkImage && (networkImage.ok || networkImage.type === 'opaque')) {
            await imageCache.put(request, networkImage.clone());
        }
        return networkImage;
    } catch (error) {
        return createOfflineImagePlaceholder();
    }
}

self.addEventListener('fetch', event => {
    if (isRemoteProductImage(event.request)) {
        event.respondWith(getCachedProductImage(event.request));
        return;
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
                    }
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // If found in cache, return it
                if (response) {
                    return response;
                }
                // Otherwise fetch from network and cache it dynamically
                return fetch(event.request).then(fetchRes => {
                    if (!fetchRes || fetchRes.status !== 200 || fetchRes.type !== 'basic' && fetchRes.type !== 'cors') {
                        return fetchRes;
                    }
                    if (event.request.method === 'GET' && event.request.url.startsWith('http')) {
                        let responseToCache = fetchRes.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return fetchRes;
                }).catch(err => {
                    console.log('Offline fetch failed for: ', event.request.url);
                    return new Response('', { status: 503, statusText: 'Offline' });
                });
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME, PRODUCT_IMAGES_CACHE];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});
