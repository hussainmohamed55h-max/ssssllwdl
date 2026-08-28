// إعداد قاعدة البيانات IndexedDB ذات المساحة المفتوحة
const APP_VERSION = '4.6.0';
const IDB_NAME = 'POSAppDB_AbuAmir';
const IDB_STORE = 'appStorage';
const IDB_PRODUCTS_STORE = 'products';
const IDB_SYNC_QUEUE_STORE = 'syncQueue';
const IDB_VERSION = 3;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        let request = indexedDB.open(IDB_NAME, IDB_VERSION);
        request.onupgradeneeded = function(e) {
            let db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
            if (!db.objectStoreNames.contains(IDB_PRODUCTS_STORE)) {
                db.createObjectStore(IDB_PRODUCTS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(IDB_SYNC_QUEUE_STORE)) {
                db.createObjectStore(IDB_SYNC_QUEUE_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = function(e) { resolve(e.target.result); };
        request.onerror = function(e) { reject(e.target.error); };
    });
}

async function saveToIndexedDB(key, data) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        let transaction = idb.transaction(IDB_STORE, 'readwrite');
        let store = transaction.objectStore(IDB_STORE);
        let request = store.put(JSON.parse(JSON.stringify(data)), key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getFromIndexedDB(key) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        let transaction = idb.transaction(IDB_STORE, 'readonly');
        let store = transaction.objectStore(IDB_STORE);
        let request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getProductsFromIndexedDB() {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        let transaction = idb.transaction(IDB_PRODUCTS_STORE, 'readonly');
        let request = transaction.objectStore(IDB_PRODUCTS_STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    });
}

function normalizeProductForStorage(product) {
    let storedProduct = { ...product };
    delete storedProduct.img;
    let safeExternalUrl = value => typeof value === 'string' && !value.startsWith('data:') ? value : '';
    storedProduct.imageUrl = safeExternalUrl(storedProduct.imageUrl);
    storedProduct.imageId = storedProduct.imageId || null;
    storedProduct.storageId = typeof storedProduct.storageId === 'string' ? storedProduct.storageId : '';
    storedProduct.thumbUrl = safeExternalUrl(storedProduct.thumbUrl);
    storedProduct.mediumUrl = safeExternalUrl(storedProduct.mediumUrl);
    storedProduct.deleteUrl = safeExternalUrl(storedProduct.deleteUrl);
    storedProduct.localId = storedProduct.localId || createLocalId('product');
    storedProduct.updatedAt = Number(storedProduct.updatedAt || 0);
    storedProduct.allowHalfCarton = storedProduct.allowHalfCarton === true;
    return storedProduct;
}

async function saveProductToIndexedDB(product) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        let transaction = idb.transaction(IDB_PRODUCTS_STORE, 'readwrite');
        let storedProduct = normalizeProductForStorage(product);
        transaction.objectStore(IDB_PRODUCTS_STORE).put(JSON.parse(JSON.stringify(storedProduct)));
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
        transaction.onabort = (e) => reject(e.target.error);
    });
}

async function deleteProductFromIndexedDB(id) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        let transaction = idb.transaction(IDB_PRODUCTS_STORE, 'readwrite');
        transaction.objectStore(IDB_PRODUCTS_STORE).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
        transaction.onabort = (e) => reject(e.target.error);
    });
}

async function replaceProductsInIndexedDB(products) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        let transaction = idb.transaction(IDB_PRODUCTS_STORE, 'readwrite');
        let store = transaction.objectStore(IDB_PRODUCTS_STORE);
        store.clear();
        products.forEach(product => {
            let storedProduct = normalizeProductForStorage(product);
            store.put(JSON.parse(JSON.stringify(storedProduct)));
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
        transaction.onabort = (e) => reject(e.target.error);
    });
}

function getAppDataWithoutProducts() {
    const { products, ...appData } = db;
    return appData;
}

function createSyncQueueItem(type, entityId, action, payload) {
    return {
        id: `${type}:${entityId}:${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        type,
        entityId,
        action,
        payload: JSON.parse(JSON.stringify(payload)),
        createdAt: new Date().toISOString(),
        retryCount: 0,
        status: 'pending'
    };
}

function createLocalId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeCustomerNameKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
}

function normalizeCustomerForStorage(customer) {
    const name = String(customer && customer.name || '').trim().replace(/\s+/g, ' ');
    return {
        localId: String(customer && customer.localId || createLocalId('customer')),
        id: Number(customer && customer.id || Date.now()),
        name,
        nameKey: normalizeCustomerNameKey(name),
        phone: String(customer && customer.phone || ''),
        address: String(customer && customer.address || ''),
        updatedAt: Number(customer && customer.updatedAt || customer && customer.id || 0),
        ...(customer && customer.isDeleted ? { isDeleted: true } : {})
    };
}

async function queueCustomerSyncBatch(customers, action = 'create') {
    if (!Array.isArray(customers) || customers.length === 0) return;
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction([IDB_STORE, IDB_SYNC_QUEUE_STORE], 'readwrite');
        transaction.objectStore(IDB_STORE).put(
            JSON.parse(JSON.stringify(getAppDataWithoutProducts())),
            'pos_db_abu_amir'
        );
        const queueStore = transaction.objectStore(IDB_SYNC_QUEUE_STORE);
        customers.forEach(customer => {
            const normalized = normalizeCustomerForStorage(customer);
            queueStore.put(createSyncQueueItem('customer', normalized.id, action, normalized));
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function createInvoiceLocalId() {
    return createLocalId('invoice');
}

async function saveAppDataAndQueueOperation(type, entityId, action, payload) {
    const idb = await initIndexedDB();
    const queueItem = createSyncQueueItem(type, entityId, action, payload);

    return new Promise((resolve, reject) => {
        let transaction = idb.transaction([IDB_STORE, IDB_SYNC_QUEUE_STORE], 'readwrite');
        transaction.objectStore(IDB_STORE).put(
            JSON.parse(JSON.stringify(getAppDataWithoutProducts())),
            'pos_db_abu_amir'
        );
        transaction.objectStore(IDB_SYNC_QUEUE_STORE).put(queueItem);
        transaction.oncomplete = () => resolve(queueItem);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function saveProductAndQueueOperation(product, action) {
    const idb = await initIndexedDB();
    const storedProduct = normalizeProductForStorage(product);
    const queueItem = createSyncQueueItem('product', storedProduct.id, action, storedProduct);
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction([IDB_PRODUCTS_STORE, IDB_STORE, IDB_SYNC_QUEUE_STORE], 'readwrite');
        transaction.objectStore(IDB_PRODUCTS_STORE).put(JSON.parse(JSON.stringify(storedProduct)));
        transaction.objectStore(IDB_STORE).put(
            JSON.parse(JSON.stringify(getAppDataWithoutProducts())),
            'pos_db_abu_amir'
        );
        transaction.objectStore(IDB_SYNC_QUEUE_STORE).put(queueItem);
        transaction.oncomplete = () => resolve(queueItem);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function deleteProductAndQueueOperation(product) {
    const idb = await initIndexedDB();
    const queueItem = createSyncQueueItem('product', product.id, 'delete', product);
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction(
            [IDB_PRODUCTS_STORE, IDB_STORE, IDB_SYNC_QUEUE_STORE],
            'readwrite'
        );
        transaction.objectStore(IDB_PRODUCTS_STORE).delete(product.id);
        transaction.objectStore(IDB_STORE).put(
            JSON.parse(JSON.stringify(getAppDataWithoutProducts())),
            'pos_db_abu_amir'
        );
        transaction.objectStore(IDB_SYNC_QUEUE_STORE).put(queueItem);
        transaction.oncomplete = () => resolve(queueItem);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

let syncQueueInProgress = false;
let syncRequestedWhileRunning = false;

async function getPendingSyncItems() {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction(IDB_SYNC_QUEUE_STORE, 'readonly');
        const request = transaction.objectStore(IDB_SYNC_QUEUE_STORE).getAll();
        request.onsuccess = () => resolve((request.result || [])
            .filter(item => ['invoice', 'product', 'category', 'customer'].includes(item.type) && item.status === 'pending')
            .sort((a, b) => {
                const customerPriority = Number(b.type === 'customer') - Number(a.type === 'customer');
                return customerPriority || String(a.createdAt).localeCompare(String(b.createdAt));
            }));
        request.onerror = () => reject(request.error);
    });
}

async function removeSyncQueueItem(id) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction(IDB_SYNC_QUEUE_STORE, 'readwrite');
        transaction.objectStore(IDB_SYNC_QUEUE_STORE).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function incrementSyncQueueRetry(id) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction(IDB_SYNC_QUEUE_STORE, 'readwrite');
        const store = transaction.objectStore(IDB_SYNC_QUEUE_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            if (!request.result) return;
            store.put({
                ...request.result,
                retryCount: Number(request.result.retryCount || 0) + 1,
                status: 'pending'
            });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function normalizeInvoiceForConvex(invoice) {
    const optionalString = (target, key, value) => {
        if (typeof value === 'string') target[key] = value;
    };
    return {
        localId: String(invoice.localId),
        id: Number(invoice.id),
        customer: String(invoice.customer || ''),
        phone: String(invoice.phone || ''),
        date: String(invoice.date || ''),
        time: String(invoice.time || ''),
        status: String(invoice.status || ''),
        statusColor: String(invoice.statusColor || ''),
        total: Number(invoice.total || 0),
        items: (Array.isArray(invoice.items) ? invoice.items : []).map(item => {
            const normalizedItem = {
                id: Number(item.id),
                name: String(item.name || ''),
                price: Number(item.price || 0),
                qty: Number(item.qty || 0)
            };
            optionalString(normalizedItem, 'category', item.category);
            optionalString(normalizedItem, 'imageUrl', item.imageUrl);
            if (typeof item.imageId === 'string' || item.imageId === null) normalizedItem.imageId = item.imageId;
            optionalString(normalizedItem, 'storageId', item.storageId);
            optionalString(normalizedItem, 'thumbUrl', item.thumbUrl);
            optionalString(normalizedItem, 'mediumUrl', item.mediumUrl);
            optionalString(normalizedItem, 'deleteUrl', item.deleteUrl);
            if (typeof item.isHidden === 'boolean') normalizedItem.isHidden = item.isHidden;
            optionalString(normalizedItem, 'note', item.note);
            return normalizedItem;
        })
    };
}

async function sendInvoiceSyncItem(client, item) {
    const invoiceApi = convex.anyApi.invoices;
    if (!item.payload || !item.payload.localId) throw new Error('Invoice sync item is missing localId');
    if (item.action === 'create') {
        return client.mutation(invoiceApi.createInvoice, normalizeInvoiceForConvex(item.payload));
    }
    if (item.action === 'update') {
        return client.mutation(invoiceApi.updateInvoice, normalizeInvoiceForConvex(item.payload));
    }
    if (item.action === 'delete') {
        return client.mutation(invoiceApi.deleteInvoice, { localId: String(item.payload.localId) });
    }
    throw new Error(`Unsupported invoice sync action: ${item.action}`);
}

function normalizeProductForConvex(product) {
    return {
        localId: String(product.localId),
        id: Number(product.id),
        name: String(product.name || ''),
        price: Number(product.price || 0),
        category: String(product.category || ''),
        imageUrl: typeof product.imageUrl === 'string' && !product.imageUrl.startsWith('data:') ? product.imageUrl : '',
        imageId: typeof product.imageId === 'string' ? product.imageId : null,
        ...(typeof product.storageId === 'string' && product.storageId ? { storageId: product.storageId } : {}),
        thumbUrl: typeof product.thumbUrl === 'string' && !product.thumbUrl.startsWith('data:') ? product.thumbUrl : '',
        mediumUrl: typeof product.mediumUrl === 'string' && !product.mediumUrl.startsWith('data:') ? product.mediumUrl : '',
        deleteUrl: typeof product.deleteUrl === 'string' && !product.deleteUrl.startsWith('data:') ? product.deleteUrl : '',
        updatedAt: Number(product.updatedAt || Date.now()),
        ...(typeof product.isHidden === 'boolean' ? { isHidden: product.isHidden } : {})
    };
}

async function sendProductSyncItem(client, item) {
    const productApi = convex.anyApi.products;
    if (!item.payload || !item.payload.localId) throw new Error('Product sync item is missing localId');
    if (item.action === 'create') return client.mutation(productApi.createProduct, normalizeProductForConvex(item.payload));
    if (item.action === 'update') return client.mutation(productApi.updateProduct, normalizeProductForConvex(item.payload));
    if (item.action === 'delete') return client.mutation(productApi.deleteProduct, { localId: String(item.payload.localId) });
    throw new Error(`Unsupported product sync action: ${item.action}`);
}

async function sendCategorySyncItem(client, item) {
    const categoryApi = convex.anyApi.categories;
    if (!item.payload || !item.payload.localId) throw new Error('Category sync item is missing localId');
    const payload = {
        localId: String(item.payload.localId),
        id: Number(item.payload.id),
        name: String(item.payload.name || ''),
        updatedAt: Number(item.payload.updatedAt || Date.now())
    };
    if (item.action === 'create') return client.mutation(categoryApi.createCategory, payload);
    if (item.action === 'update') return client.mutation(categoryApi.updateCategory, payload);
    if (item.action === 'delete') return client.mutation(categoryApi.deleteCategory, { localId: payload.localId });
    throw new Error(`Unsupported category sync action: ${item.action}`);
}

function normalizeCustomerForConvex(customer, isDeleted = false) {
    const normalized = normalizeCustomerForStorage(customer);
    return {
        localId: normalized.localId,
        id: normalized.id,
        name: normalized.name,
        nameKey: normalized.nameKey,
        phone: normalized.phone,
        address: normalized.address,
        updatedAt: Number(normalized.updatedAt || Date.now()),
        ...(isDeleted || normalized.isDeleted ? { isDeleted: true } : {})
    };
}

async function sendCustomerSyncItem(client, item) {
    const customerApi = convex.anyApi.customers;
    if (!item.payload || !item.payload.localId) throw new Error('Customer sync item is missing localId');
    const payload = normalizeCustomerForConvex(item.payload, item.action === 'delete');
    if (item.action === 'create' || item.action === 'update') {
        return client.mutation(customerApi.upsertCustomer, payload);
    }
    if (item.action === 'delete') return client.mutation(customerApi.deleteCustomer, payload);
    throw new Error(`Unsupported customer sync action: ${item.action}`);
}

async function sendSyncQueueItem(client, item) {
    if (item.type === 'invoice') return sendInvoiceSyncItem(client, item);
    if (item.type === 'product') return sendProductSyncItem(client, item);
    if (item.type === 'category') return sendCategorySyncItem(client, item);
    if (item.type === 'customer') return sendCustomerSyncItem(client, item);
    throw new Error(`Unsupported sync type: ${item.type}`);
}

async function syncPendingChangesToConvex() {
    if (!navigator.onLine) return;
    if (syncQueueInProgress) {
        syncRequestedWhileRunning = true;
        return;
    }
    syncQueueInProgress = true;
    try {
        if (!globalThis.CONVEX_URL || !globalThis.convex || !convex.ConvexHttpClient) {
            throw new Error('Convex client is not configured');
        }
        const client = new convex.ConvexHttpClient(globalThis.CONVEX_URL);
        const pendingItems = await getPendingSyncItems();
        for (const item of pendingItems) {
            try {
                await sendSyncQueueItem(client, item);
                await removeSyncQueueItem(item.id);
            } catch (error) {
                await incrementSyncQueueRetry(item.id);
                console.error('تعذرت مزامنة العملية، وستتم إعادة المحاولة لاحقًا.', error);
                break;
            }
        }
    } catch (error) {
        console.error('تعذر بدء المزامنة.', error);
    } finally {
        syncQueueInProgress = false;
        if (syncRequestedWhileRunning) {
            syncRequestedWhileRunning = false;
            syncPendingChangesToConvex();
        }
    }
}

function syncChangesIfOnline() {
    if (navigator.onLine) syncPendingChangesToConvex();
}

let catalogDownloadInProgress = false;

function normalizeDownloadedProduct(product) {
    return normalizeProductForStorage({
        localId: String(product.localId),
        id: Number(product.id),
        name: String(product.name || ''),
        price: Number(product.price || 0),
        category: String(product.category || ''),
        imageUrl: product.imageUrl,
        imageId: typeof product.imageId === 'string' ? product.imageId : null,
        storageId: typeof product.storageId === 'string' ? product.storageId : '',
        thumbUrl: product.thumbUrl,
        mediumUrl: product.mediumUrl,
        deleteUrl: product.deleteUrl,
        ...(typeof product.isHidden === 'boolean' ? { isHidden: product.isHidden } : {}),
        updatedAt: Number(product.updatedAt || product._creationTime || 0)
    });
}

function normalizeDownloadedCategory(category) {
    return {
        localId: String(category.localId),
        id: Number(category.id),
        name: String(category.name || ''),
        updatedAt: Number(category.updatedAt || category._creationTime || 0)
    };
}

function normalizeDownloadedInvoice(invoice) {
    return {
        localId: String(invoice.localId),
        id: Number(invoice.id),
        customer: String(invoice.customer || ''),
        phone: String(invoice.phone || ''),
        date: String(invoice.date || ''),
        time: String(invoice.time || ''),
        status: String(invoice.status || ''),
        statusColor: String(invoice.statusColor || ''),
        total: Number(invoice.total || 0),
        items: (Array.isArray(invoice.items) ? invoice.items : []).map(item => ({
            ...item,
            id: Number(item.id),
            name: String(item.name || ''),
            price: Number(item.price || 0),
            qty: Number(item.qty || 0)
        }))
    };
}

function normalizeDownloadedCustomer(customer) {
    return normalizeCustomerForStorage({
        localId: customer.localId,
        id: customer.id,
        name: customer.name,
        nameKey: customer.nameKey,
        phone: customer.phone,
        address: customer.address,
        updatedAt: customer.updatedAt || customer._creationTime,
        isDeleted: customer.isDeleted
    });
}

function addMissingCustomersFromInvoices(invoices, blockedNameKeys = new Set()) {
    const knownNames = new Set(db.customers.map(customer => normalizeCustomerNameKey(customer.name)));
    let nextCustomerId = db.customers.length
        ? Math.max(...db.customers.map(customer => Number(customer.id) || 0)) + 1
        : 1;
    const addedCustomers = [];
    invoices.forEach(invoice => {
        const customerName = String(invoice.customer || '').trim();
        const customerNameKey = normalizeCustomerNameKey(customerName);
        if (!customerName || customerName === 'زبون نقدي' || knownNames.has(customerNameKey) || blockedNameKeys.has(customerNameKey)) return;
        const customer = normalizeCustomerForStorage({
            id: nextCustomerId++,
            name: customerName,
            phone: String(invoice.phone || ''),
            address: '',
            updatedAt: Number(invoice.id || 0)
        });
        db.customers.push(customer);
        addedCustomers.push(customer);
        knownNames.add(customerNameKey);
    });
    return addedCustomers;
}

function mergeDownloadedCustomers(remoteCustomers, pendingItems) {
    const pendingLocalIds = new Set(
        pendingItems
            .filter(item => item.status === 'pending' && item.type === 'customer')
            .map(item => String(item.payload && item.payload.localId || ''))
    );
    const pendingNameKeys = new Set(
        pendingItems
            .filter(item => item.status === 'pending' && item.type === 'customer')
            .map(item => normalizeCustomerNameKey(item.payload && item.payload.name))
    );
    const byLocalId = new Map(db.customers.map(customer => [customer.localId, customer]));
    const byNameKey = new Map(db.customers.map(customer => [normalizeCustomerNameKey(customer.name), customer]));

    remoteCustomers.forEach(remoteValue => {
        if (!remoteValue || typeof remoteValue.localId !== 'string') return;
        const remote = normalizeDownloadedCustomer(remoteValue);
        const local = byLocalId.get(remote.localId) || byNameKey.get(remote.nameKey);
        const hasPendingChange = Boolean(local && pendingLocalIds.has(local.localId)) || pendingNameKeys.has(remote.nameKey);

        if (remote.isDeleted) {
            if (local && !hasPendingChange && remote.updatedAt >= Number(local.updatedAt || 0)) {
                db.customers = db.customers.filter(customer => customer !== local);
                byLocalId.delete(local.localId);
                byNameKey.delete(remote.nameKey);
            }
            return;
        }

        if (!local) {
            if (hasPendingChange) return;
            db.customers.push(remote);
            byLocalId.set(remote.localId, remote);
            byNameKey.set(remote.nameKey, remote);
            return;
        }

        if (!hasPendingChange && remote.updatedAt >= Number(local.updatedAt || 0)) {
            const previousLocalId = local.localId;
            Object.assign(local, remote);
            byLocalId.delete(previousLocalId);
            byLocalId.set(local.localId, local);
        } else if (local.localId !== remote.localId) {
            byLocalId.delete(local.localId);
            local.localId = remote.localId;
            byLocalId.set(local.localId, local);
        }
    });

    const newestByName = new Map();
    db.customers.forEach(customer => {
        const key = normalizeCustomerNameKey(customer.name);
        const existing = newestByName.get(key);
        if (!existing || Number(customer.updatedAt || 0) >= Number(existing.updatedAt || 0)) newestByName.set(key, customer);
    });
    db.customers = [...newestByName.values()];
}

async function persistDownloadedCatalog(changedProducts) {
    const idb = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = idb.transaction([IDB_PRODUCTS_STORE, IDB_STORE], 'readwrite');
        const productStore = transaction.objectStore(IDB_PRODUCTS_STORE);
        changedProducts.forEach(product => {
            productStore.put(JSON.parse(JSON.stringify(normalizeProductForStorage(product))));
        });
        transaction.objectStore(IDB_STORE).put(
            JSON.parse(JSON.stringify(getAppDataWithoutProducts())),
            'pos_db_abu_amir'
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function mergeDownloadedCatalog(remoteProducts, remoteCategories, remoteInvoices, remoteCustomers, pendingItems) {
    const pendingLocalIds = new Set(
        pendingItems
            .filter(item => item.status === 'pending' && ['product', 'category', 'invoice', 'customer'].includes(item.type))
            .map(item => `${item.type}:${item.payload && item.payload.localId}`)
    );
    const previousProducts = JSON.parse(JSON.stringify(db.products));
    const previousCategories = JSON.parse(JSON.stringify(db.categories));
    const previousInvoices = JSON.parse(JSON.stringify(db.invoices));
    const previousCustomers = JSON.parse(JSON.stringify(db.customers));
    const productsByLocalId = new Map(db.products.map(product => [product.localId, product]));
    const categoriesByLocalId = new Map(db.categories.map(category => [category.localId, category]));
    const invoicesByLocalId = new Map(db.invoices.map(invoice => [invoice.localId, invoice]));
    const changedProducts = [];
    const seenProductIds = new Set();
    const seenCategoryIds = new Set();
    const seenInvoiceIds = new Set();

    remoteProducts.forEach(remote => {
        if (!remote || typeof remote.localId !== 'string' || typeof remote.id !== 'number' || seenProductIds.has(remote.localId)) return;
        seenProductIds.add(remote.localId);
        if (pendingLocalIds.has(`product:${remote.localId}`)) return;
        const downloaded = normalizeDownloadedProduct(remote);
        const local = productsByLocalId.get(downloaded.localId);
        if (!local) {
            if (db.products.some(product => product.id === downloaded.id && product.localId !== downloaded.localId)) return;
            db.products.push(downloaded);
            productsByLocalId.set(downloaded.localId, downloaded);
            changedProducts.push(downloaded);
        } else if (downloaded.updatedAt > Number(local.updatedAt || 0)) {
            Object.assign(local, downloaded);
            changedProducts.push(local);
        }
    });

    remoteCategories.forEach(remote => {
        if (!remote || typeof remote.localId !== 'string' || typeof remote.id !== 'number' || seenCategoryIds.has(remote.localId)) return;
        seenCategoryIds.add(remote.localId);
        if (pendingLocalIds.has(`category:${remote.localId}`)) return;
        const downloaded = normalizeDownloadedCategory(remote);
        const local = categoriesByLocalId.get(downloaded.localId);
        if (!local) {
            if (db.categories.some(category => category.id === downloaded.id && category.localId !== downloaded.localId)) return;
            db.categories.push(downloaded);
            categoriesByLocalId.set(downloaded.localId, downloaded);
        } else if (downloaded.updatedAt > Number(local.updatedAt || 0)) {
            Object.assign(local, downloaded);
        }
    });

    remoteInvoices.forEach(remote => {
        if (!remote || typeof remote.localId !== 'string' || typeof remote.id !== 'number' || seenInvoiceIds.has(remote.localId)) return;
        seenInvoiceIds.add(remote.localId);
        if (pendingLocalIds.has(`invoice:${remote.localId}`)) return;
        const downloaded = normalizeDownloadedInvoice(remote);
        const local = invoicesByLocalId.get(downloaded.localId);
        if (!local) {
            if (db.invoices.some(invoice => invoice.id === downloaded.id && invoice.localId !== downloaded.localId)) return;
            db.invoices.push(downloaded);
            invoicesByLocalId.set(downloaded.localId, downloaded);
        } else {
            Object.assign(local, downloaded);
        }
    });

    mergeDownloadedCustomers(remoteCustomers, pendingItems);
    const blockedCustomerNameKeys = new Set([
        ...remoteCustomers
            .filter(customer => customer && customer.isDeleted)
            .map(customer => normalizeCustomerNameKey(customer.name)),
        ...pendingItems
            .filter(item => item.status === 'pending' && item.type === 'customer' && item.action === 'delete')
            .map(item => normalizeCustomerNameKey(item.payload && item.payload.name))
    ]);
    const hasSharedCustomers = remoteCustomers.some(customer => customer && !customer.isDeleted);
    const inferredCustomers = !hasSharedCustomers && db.customers.length === 0
        ? addMissingCustomersFromInvoices(db.invoices, blockedCustomerNameKeys)
        : [];

    try {
        await persistDownloadedCatalog(changedProducts);
        await queueCustomerSyncBatch(inferredCustomers, 'create');
    } catch (error) {
        db.products = previousProducts;
        db.categories = previousCategories;
        db.invoices = previousInvoices;
        db.customers = previousCustomers;
        throw error;
    }
}

async function downloadCatalogFromConvex() {
    if (!navigator.onLine || catalogDownloadInProgress) return false;
    catalogDownloadInProgress = true;
    try {
        if (!globalThis.CONVEX_URL || !globalThis.convex || !convex.ConvexHttpClient) return false;
        const client = new convex.ConvexHttpClient(globalThis.CONVEX_URL);
        const [remoteProducts, remoteCategories, remoteInvoices, remoteCustomers] = await Promise.all([
            client.query(convex.anyApi.products.getProducts, { limit: 5000 }),
            client.query(convex.anyApi.categories.getCategories, { limit: 5000 }),
            client.query(convex.anyApi.invoices.getInvoices, { limit: 5000 }),
            client.query(convex.anyApi.customers.getCustomers, { limit: 5000 })
        ]);
        if (![remoteProducts, remoteCategories, remoteInvoices, remoteCustomers].every(Array.isArray)) return false;
        const pendingItems = await getPendingSyncItems();
        await mergeDownloadedCatalog(remoteProducts, remoteCategories, remoteInvoices, remoteCustomers, pendingItems);
        return true;
    } catch (error) {
        console.warn('تعذر تنزيل بيانات Convex، وسيستمر استخدام البيانات المحلية.', error);
        return false;
    } finally {
        catalogDownloadInProgress = false;
    }
}

// قاعدة بيانات تتضمن الفئات الآن
let db = { products: [], customers: [], cart: [], invoices: [], categories: [], posProductOrder: [] };

// استرجاع البيانات من التخزين المحلي (التحديث لاستخدام IndexedDB مع دعم نقل القديم)
async function loadAppDatabase() {
    try {
        let savedDb = await getFromIndexedDB('pos_db_abu_amir');
        
        // التوافقية الرجعية: استيراد البيانات القديمة من localStorage إن وجدت ولم يتم نقلها بعد
        if (!savedDb && localStorage.getItem('pos_db_abu_amir')) {
            savedDb = JSON.parse(localStorage.getItem('pos_db_abu_amir'));
        }

        let customersNeedMetadata = false;
        if(savedDb) {
            const savedCustomers = Array.isArray(savedDb.customers) ? savedDb.customers : [];
            customersNeedMetadata = savedCustomers.some(customer =>
                !customer.localId || !customer.nameKey || typeof customer.updatedAt !== 'number'
            );
            db.customers = savedCustomers
                .map(normalizeCustomerForStorage)
                .filter(customer => customer.name);
            db.cart = savedDb.cart || [];
            db.invoices = savedDb.invoices || [];
            db.posProductOrder = Array.isArray(savedDb.posProductOrder) ? savedDb.posProductOrder : [];
            db.categories = (savedDb.categories || []).map(category => ({
                ...category,
                localId: category.localId || createLocalId('category'),
                updatedAt: Number(category.updatedAt || 0)
            }));
        }

        let storedProducts = await getProductsFromIndexedDB();
        let legacyProducts = savedDb && Array.isArray(savedDb.products) ? savedDb.products : [];

        const productsNeedMetadata = storedProducts.some(product => !product.localId || typeof product.updatedAt !== 'number');
        if (storedProducts.length > 0) {
            db.products = storedProducts.map(normalizeProductForStorage);
            if (productsNeedMetadata) await replaceProductsInIndexedDB(db.products);
        } else if (legacyProducts.length > 0) {
            db.products = legacyProducts.map(normalizeProductForStorage);
            await replaceProductsInIndexedDB(db.products);
        }

        const categoriesNeedMetadata = savedDb && (savedDb.categories || []).some(category => !category.localId || typeof category.updatedAt !== 'number');
        if (savedDb && (Object.prototype.hasOwnProperty.call(savedDb, 'products') || categoriesNeedMetadata)) {
            await saveToIndexedDB('pos_db_abu_amir', getAppDataWithoutProducts());
        }
        if (customersNeedMetadata) await queueCustomerSyncBatch(db.customers, 'create');

        if (navigator.onLine) await downloadCatalogFromConvex();
    } catch(e) { console.error("خطأ في قراءة البيانات", e); }

    // التشغيل المبدئي للواجهة بعد اكتمال تحميل البيانات
    renderCategories(); renderProducts(); renderCustomers(); updateCartCustomerSelect(); updateCartUI();
}

// دالة لحفظ أي تغيير جديد محلياً فوراً (تم التحديث لـ IndexedDB)
let saveLocalTimeout = null;
function saveLocal() {
    if (saveLocalTimeout) {
        clearTimeout(saveLocalTimeout);
    }
    saveLocalTimeout = setTimeout(() => {
        saveToIndexedDB('pos_db_abu_amir', getAppDataWithoutProducts()).catch(e => {
            console.error("خطأ في الحفظ", e);
            customAlert("حدث خطأ أثناء الحفظ. يرجى التأكد من مساحة الجهاز.");
        });
    }, 150); // تأخير بسيط لمنع التكرار المستمر
}

let activeCategoryFilter = 'الكل'; // متغير لتتبع الفئة المحددة
let editingInvoiceId = null; // متغير لتتبع الفاتورة قيد التعديل

// ==========================================
// 1. المظهر
// ==========================================
let isLightMode = true;
function toggleTheme() {
    isLightMode = !isLightMode;
    document.body.classList.toggle('light-mode', isLightMode);
    document.getElementById('themeToggleBtn').innerHTML = isLightMode ? '<i class="fas fa-sun"></i> المظهر: نهاري (أساسي)' : '<i class="fas fa-moon"></i> المظهر: ليلي';
}

// ==========================================
// 2. التحكم بالنوافذ والتنقل
// ==========================================
function switchTab(tabId, navElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if(navElement) navElement.classList.add('active');
    if (tabId === 'tab-customers') renderCustomers();
    if (tabId === 'tab-settings') checkForAppUpdate(true);
}
function triggerFlip(btn, callback) {
    btn.classList.add('flip-animate');
    setTimeout(() => { btn.classList.remove('flip-animate'); if(callback) callback(); }, 400);
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) {
    if (id === 'addProductModal') {
        productImageUploadSequence++;
        cleanupTemporaryProductImage();
    }
    document.getElementById(id).style.display = 'none';
}

// ==========================================
// 3. إدارة الفئات
// ==========================================
async function saveCategory() {
    let name = document.getElementById('newCategoryName').value;
    if(!name) { customAlert('يرجى إدخال اسم الفئة'); return; }
    const category = { localId: createLocalId('category'), id: Date.now(), name: name, updatedAt: Date.now() };
    db.categories.push(category);
    try {
        await saveAppDataAndQueueOperation('category', category.id, 'create', category);
        syncChangesIfOnline();
    } catch (error) {
        db.categories = db.categories.filter(item => item.id !== category.id);
        customAlert('تعذر حفظ الفئة محليًا.');
        return;
    }
    document.getElementById('newCategoryName').value = '';
    renderCategories();
}

async function deleteCategory(id) {
    const category = db.categories.find(c => c.id === id);
    if (!category) return;
    const previousCategories = JSON.parse(JSON.stringify(db.categories));
    const previousCategoryFilter = activeCategoryFilter;
    db.categories = db.categories.filter(c => c.id !== id);
    if(activeCategoryFilter !== 'الكل' && !db.categories.find(c => c.name === activeCategoryFilter)) {
        activeCategoryFilter = 'الكل';
    }
    try {
        await saveAppDataAndQueueOperation('category', category.id, 'delete', category);
        syncChangesIfOnline();
    } catch (error) {
        db.categories = previousCategories;
        activeCategoryFilter = previousCategoryFilter;
        customAlert('تعذر حفظ حذف الفئة محليًا.');
        return;
    }
    renderCategories();
    renderProducts();
}

function editCategory(id) {
    const cat = db.categories.find(c => c.id == id);
    if (!cat) return;
    customPrompt('تعديل اسم الفئة:', cat.name, async function(newVal) {
        if (!newVal) return;
        const previousName = cat.name;
        const previousUpdatedAt = cat.updatedAt;
        cat.localId = cat.localId || createLocalId('category');
        if (activeCategoryFilter === previousName) activeCategoryFilter = newVal;
        cat.name = newVal;
        cat.updatedAt = Date.now();
        try {
            await saveAppDataAndQueueOperation('category', cat.id, 'update', cat);
            syncChangesIfOnline();
        } catch (error) {
            cat.name = previousName;
            cat.updatedAt = previousUpdatedAt;
            if (activeCategoryFilter === newVal) activeCategoryFilter = previousName;
            customAlert('تعذر حفظ تعديل الفئة محليًا.');
            return;
        }
        renderCategories();
        renderProducts();
    });
}

const PRODUCTS_ADMIN_CODE = '1001';
const DEFAULT_APP_LOCK_CODE = '121';
const APP_LOCK_STORAGE_KEY = 'pos_app_locked';
const APP_LOCK_CODE_STORAGE_KEY = 'pos_app_lock_code';
let productsAdminNavElement = null;

function getApplicationLockCode() {
    return localStorage.getItem(APP_LOCK_CODE_STORAGE_KEY) || DEFAULT_APP_LOCK_CODE;
}

function showApplicationLock() {
    const modal = document.getElementById('applicationLockModal');
    const input = document.getElementById('applicationUnlockCode');
    const error = document.getElementById('applicationUnlockError');
    modal.style.display = 'flex';
    input.value = '';
    error.textContent = '';
    setTimeout(() => input.focus(), 100);
}

function lockApplication() {
    const salesNavElement = document.querySelectorAll('.nav-item')[0];
    switchTab('tab-pos', salesNavElement);
    localStorage.setItem(APP_LOCK_STORAGE_KEY, '1');
    document.querySelectorAll('.modal').forEach(modal => {
        if (modal.id !== 'applicationLockModal') modal.style.display = 'none';
    });
    showApplicationLock();
}

function unlockApplication() {
    const input = document.getElementById('applicationUnlockCode');
    const error = document.getElementById('applicationUnlockError');
    const card = document.getElementById('applicationLockCard');
    if (input.value === getApplicationLockCode()) {
        localStorage.removeItem(APP_LOCK_STORAGE_KEY);
        document.getElementById('applicationLockModal').style.display = 'none';
        input.value = '';
        error.textContent = '';
        return;
    }
    error.textContent = 'الرمز غير صحيح، حاول مرة أخرى.';
    input.value = '';
    card.classList.remove('unlock-error');
    void card.offsetWidth;
    card.classList.add('unlock-error');
    input.focus();
}

function changeApplicationLockCode() {
    customPrompt('أدخل رمزًا محليًا جديدًا من 3 أرقام:', '', value => {
        const newCode = String(value || '').trim();
        if (!/^\d{3}$/.test(newCode)) {
            customAlert('يجب أن يتكون الرمز المحلي من 3 أرقام.');
            return;
        }
        localStorage.setItem(APP_LOCK_CODE_STORAGE_KEY, newCode);
        customAlert('تم تغيير رمز قفل التطبيق بنجاح.');
    });
}

document.getElementById('applicationUnlockCode').addEventListener('keydown', event => {
    if (event.key === 'Enter') unlockApplication();
});

if (localStorage.getItem(APP_LOCK_STORAGE_KEY) === '1') showApplicationLock();

function requestProductsAdminAccess(navElement) {
    productsAdminNavElement = navElement;
    const modal = document.getElementById('productsAdminModal');
    const card = document.getElementById('productsAdminCard');
    const input = document.getElementById('productsAdminCode');
    document.getElementById('productsAdminError').textContent = '';
    input.value = '';
    card.classList.remove('admin-code-error');
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 250);
}

function closeProductsAdminAccess() {
    document.getElementById('productsAdminModal').style.display = 'none';
    document.getElementById('productsAdminCode').value = '';
    document.getElementById('productsAdminError').textContent = '';
    productsAdminNavElement = null;
}

function confirmProductsAdminAccess() {
    const input = document.getElementById('productsAdminCode');
    const error = document.getElementById('productsAdminError');
    const card = document.getElementById('productsAdminCard');
    if (input.value === PRODUCTS_ADMIN_CODE) {
        const navElement = productsAdminNavElement;
        closeProductsAdminAccess();
        switchTab('tab-products', navElement);
        return;
    }
    error.textContent = 'الرمز غير صحيح، حاول مرة أخرى.';
    input.value = '';
    card.classList.remove('admin-code-error');
    void card.offsetWidth;
    card.classList.add('admin-code-error');
    input.focus();
}

document.getElementById('productsAdminCode').addEventListener('keydown', event => {
    if (event.key === 'Enter') confirmProductsAdminAccess();
});

function filterProducts(category, element) {
    activeCategoryFilter = category;
    document.querySelectorAll('#pos-categories-pills .pill').forEach(p => p.classList.remove('active'));
    if(element) element.classList.add('active');
    renderProducts();
}

function getOrderedCategories() {
    return [...db.categories].sort((first, second) => {
        const firstOrder = Number(first.updatedAt || first.id || 0);
        const secondOrder = Number(second.updatedAt || second.id || 0);
        if (secondOrder !== firstOrder) return secondOrder - firstOrder;
        return String(first.name || '').localeCompare(String(second.name || ''), 'ar');
    });
}

function renderCategories() {
    const listModal = document.getElementById('categories-list-modal');
    listModal.innerHTML = '';
    if(db.categories.length === 0) {
        listModal.innerHTML = '<p style="text-align:center; color:var(--text-muted);">لا توجد فئات.</p>';
    } else {
        let listHtml = '';
        getOrderedCategories().forEach(c => {
            listHtml += `
                <div class="category-row">
                    <strong>${c.name}</strong>
                    <div class="action-btns" style="margin:0;">
                        <button class="btn-3d btn-blue" style="padding:6px 12px;" onclick="triggerFlip(this, () => editCategory(${c.id}))"><i class="fas fa-pen"></i></button>
                        <button class="btn-3d btn-red" style="padding:6px 12px;" onclick="triggerFlip(this, () => deleteCategory(${c.id}))"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
        });
        listModal.innerHTML = listHtml;
    }

    const select = document.getElementById('newProdCategory');
    let selectHtml = '<option value="">اختر الفئة...</option>';
    getOrderedCategories().forEach(c => { selectHtml += `<option value="${c.name}">${c.name}</option>`; });
    select.innerHTML = selectHtml;

    const pills = document.getElementById('pos-categories-pills');
    let pillsHtml = `<div class="pill ${activeCategoryFilter === 'الكل' ? 'active' : ''}" onclick="filterProducts('الكل', this)">الكل</div>`;
    getOrderedCategories().forEach(c => {
        pillsHtml += `<div class="pill ${activeCategoryFilter === c.name ? 'active' : ''}" onclick="filterProducts('${c.name}', this)">${c.name}</div>`; 
    });
    pills.innerHTML = pillsHtml;
}

// ==========================================
// 4. إدارة المنتجات 
// ==========================================
let currentUploadImage = null; // الصورة الأصلية
let selectedProductImageFile = null;
let currentPreviewObjectUrl = '';
let tempProductImageUrl = '';
let tempProductImageId = null;
let tempProductStorageId = '';
let tempProductThumbUrl = '';
let tempProductMediumUrl = '';
let tempProductDeleteUrl = '';
let isProductImageUploading = false;
let productImageUploadFailed = false;
let productImageUploadSequence = 0;
let imgScale = 1;
let imgPanX = 0;
let imgPanY = 0;

const PRODUCT_IMAGE_PLACEHOLDER = 'https://placehold.co/400x400/2a2a2a/ffffff/png?text=No+Image';
const PRODUCT_IMAGE_MAX_DIMENSION = 800;
const PRODUCT_IMAGE_WEBP_QUALITY = 0.86;

function getProductImageUrl(product) {
    let imageUrl = product.thumbUrl && typeof product.thumbUrl === 'string' && !product.thumbUrl.startsWith('data:')
        ? product.thumbUrl
        : product.imageUrl && typeof product.imageUrl === 'string' && !product.imageUrl.startsWith('data:')
            ? product.imageUrl
            : '';
    return imageUrl || PRODUCT_IMAGE_PLACEHOLDER;
}

function getProductMediumImageUrl(product) {
    let imageUrl = product.mediumUrl && typeof product.mediumUrl === 'string' && !product.mediumUrl.startsWith('data:')
        ? product.mediumUrl
        : product.imageUrl && typeof product.imageUrl === 'string' && !product.imageUrl.startsWith('data:')
            ? product.imageUrl
        : '';
    return imageUrl || PRODUCT_IMAGE_PLACEHOLDER;
}

function setProductImageUploadStatus(message, isError = false) {
    let status = document.getElementById('productImageUploadStatus');
    status.textContent = message;
    status.style.display = message ? 'block' : 'none';
    status.style.color = isError ? '#dc3545' : 'var(--text-muted)';
}

function setProductSaveDisabled(disabled) {
    let button = document.getElementById('saveProductBtn');
    button.disabled = disabled;
    button.style.opacity = disabled ? '0.6' : '';
    button.style.cursor = disabled ? 'not-allowed' : '';
}

function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function cleanupUnusedProductImage(storageId) {
    if (!storageId || !globalThis.CONVEX_URL || !globalThis.convex || !convex.ConvexHttpClient) return false;
    try {
        const client = new convex.ConvexHttpClient(globalThis.CONVEX_URL);
        return await client.mutation(convex.anyApi.files.deleteUnusedProductImage, { storageId });
    } catch (error) {
        console.warn('تعذر تنظيف صورة غير مستخدمة.', error);
        return false;
    }
}

function cleanupTemporaryProductImage() {
    const storageId = tempProductStorageId;
    if (!storageId) return;
    const editId = document.getElementById('editProdId').value;
    const persistedProduct = editId ? db.products.find(product => product.id == editId) : null;
    tempProductStorageId = '';
    if (!persistedProduct || persistedProduct.storageId !== storageId) {
        cleanupUnusedProductImage(storageId);
    }
}

async function optimizeProductImage(file) {
    if (!file || !String(file.type || '').startsWith('image/')) {
        throw new Error('الملف المختار ليس صورة صالحة.');
    }

    const objectUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const source = new Image();
            source.onload = () => resolve(source);
            source.onerror = () => reject(new Error('تعذر قراءة الصورة المختارة.'));
            source.src = objectUrl;
        });
        const largestDimension = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / largestDimension);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('تعذر تجهيز الصورة للرفع.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        let optimized = await canvasToBlob(canvas, 'image/webp', PRODUCT_IMAGE_WEBP_QUALITY);
        if (!optimized) optimized = await canvasToBlob(canvas, 'image/jpeg', 0.9);
        if (!optimized) throw new Error('تعذر ضغط الصورة.');
        return optimized;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function uploadProductImageToConvex(file, uploadSequence) {
    if (!globalThis.CONVEX_URL || !globalThis.convex || !convex.ConvexHttpClient) {
        throw new Error('خدمة مزامنة الصور غير مهيأة.');
    }

    const optimizedImage = await optimizeProductImage(file);
    if (uploadSequence !== productImageUploadSequence) return;

    const client = new convex.ConvexHttpClient(globalThis.CONVEX_URL);
    const filesApi = convex.anyApi.files;
    const uploadUrl = await client.mutation(filesApi.generateProductImageUploadUrl, {});
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': optimizedImage.type || 'image/webp' },
        body: optimizedImage
    });
    if (!response.ok) throw new Error('رفضت خدمة التخزين رفع الصورة.');

    const result = await response.json();
    if (!result || !result.storageId) throw new Error('لم تُرجع خدمة التخزين معرّف الصورة.');
    if (uploadSequence !== productImageUploadSequence) {
        cleanupUnusedProductImage(String(result.storageId));
        return;
    }
    tempProductStorageId = String(result.storageId);
    const imageUrl = await client.query(filesApi.getProductImageUrl, { storageId: result.storageId });
    if (!imageUrl) throw new Error('تعذر إنشاء رابط الصورة.');
    if (uploadSequence !== productImageUploadSequence) {
        cleanupUnusedProductImage(tempProductStorageId);
        tempProductStorageId = '';
        return;
    }

    tempProductImageId = null;
    tempProductImageUrl = imageUrl;
    tempProductThumbUrl = imageUrl;
    tempProductMediumUrl = imageUrl;
    tempProductDeleteUrl = '';
}

function clearProductImagePreviewObjectUrl() {
    if (currentPreviewObjectUrl) {
        URL.revokeObjectURL(currentPreviewObjectUrl);
        currentPreviewObjectUrl = '';
    }
}

document.getElementById('newProdImg').addEventListener('change', async function(e) {
    let file = e.target.files[0];
    if(file) {
        let uploadSequence = ++productImageUploadSequence;
        cleanupUnusedProductImage(tempProductStorageId);
        clearProductImagePreviewObjectUrl();
        selectedProductImageFile = file;
        tempProductImageUrl = '';
        tempProductImageId = null;
        tempProductStorageId = '';
        tempProductThumbUrl = '';
        tempProductMediumUrl = '';
        tempProductDeleteUrl = '';
        isProductImageUploading = true;
        productImageUploadFailed = false;
        setProductSaveDisabled(true);
        setProductImageUploadStatus('جاري تحسين ورفع الصورة');
        currentPreviewObjectUrl = URL.createObjectURL(file);
        let img = new Image();
        img.onload = function() {
            currentUploadImage = img;
            imgScale = 1;
            imgPanX = 0;
            imgPanY = 0;
            document.getElementById('imageZoomContainer').style.display = 'flex';
            document.getElementById('imgZoomSlider').value = 1;
            updateImagePreview();
        };
        img.src = currentPreviewObjectUrl;

        try {
            await uploadProductImageToConvex(file, uploadSequence);
            if (uploadSequence !== productImageUploadSequence) return;
            setProductImageUploadStatus('تم رفع الصورة بنجاح');
        } catch (error) {
            if (uploadSequence !== productImageUploadSequence) return;
            productImageUploadFailed = true;
            cleanupUnusedProductImage(tempProductStorageId);
            tempProductImageUrl = '';
            tempProductImageId = null;
            tempProductStorageId = '';
            tempProductThumbUrl = '';
            tempProductMediumUrl = '';
            tempProductDeleteUrl = '';
            document.getElementById('newProdImg').value = '';
            setProductImageUploadStatus(`فشل رفع الصورة: ${error.message}`, true);
            customAlert(`فشل رفع الصورة: ${error.message}`);
        } finally {
            if (uploadSequence === productImageUploadSequence) {
                isProductImageUploading = false;
                setProductSaveDisabled(false);
            }
        }
    }
});

let isDraggingImg = false;
let startDragX = 0, startDragY = 0;

function updateImagePreview() {
    if(!currentUploadImage) return;
    let preview = document.getElementById('prodImgPreview');
    let baseScale = Math.max(100 / currentUploadImage.width, 100 / currentUploadImage.height);
    
    let finalWidth = currentUploadImage.width * baseScale * imgScale;
    let finalHeight = currentUploadImage.height * baseScale * imgScale;
    
    let maxPanX = Math.max(0, (finalWidth - 100) / 2);
    let maxPanY = Math.max(0, (finalHeight - 100) / 2);
    if(imgPanX > maxPanX) imgPanX = maxPanX;
    if(imgPanX < -maxPanX) imgPanX = -maxPanX;
    if(imgPanY > maxPanY) imgPanY = maxPanY;
    if(imgPanY < -maxPanY) imgPanY = -maxPanY;

    preview.innerHTML = `<img src="${currentUploadImage.src}" style="position: absolute; width: ${finalWidth}px; height: ${finalHeight}px; transform: translate(${imgPanX}px, ${imgPanY}px); max-width: none; pointer-events: none;">`;
}

document.getElementById('imgZoomSlider').addEventListener('input', (e) => {
    imgScale = parseFloat(e.target.value);
    updateImagePreview();
});

function adjustZoom(amt) {
    let s = document.getElementById('imgZoomSlider');
    let v = parseFloat(s.value) + amt;
    if(v < 1) v = 1;
    if(v > 5) v = 5;
    s.value = v;
    imgScale = v;
    updateImagePreview();
}

let previewBox = document.getElementById('prodImgPreview');
function startDrag(clientX, clientY) {
    if(!currentUploadImage) return;
    isDraggingImg = true;
    startDragX = clientX - imgPanX;
    startDragY = clientY - imgPanY;
}
function doDrag(clientX, clientY) {
    if(!isDraggingImg) return;
    imgPanX = clientX - startDragX;
    imgPanY = clientY - startDragY;
    updateImagePreview();
}
function endDrag() { isDraggingImg = false; }

previewBox.addEventListener('mousedown', e => startDrag(e.clientX, e.clientY));
document.addEventListener('mousemove', e => doDrag(e.clientX, e.clientY));
document.addEventListener('mouseup', endDrag);

previewBox.addEventListener('touchstart', e => {
    if(currentUploadImage && e.touches.length === 1) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault(); 
    }
}, {passive: false});
document.addEventListener('touchmove', e => {
    if(isDraggingImg && e.touches.length === 1) {
        doDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
}, {passive: false});
document.addEventListener('touchend', endDrag);

function openAddProductModal() {
    productImageUploadSequence++;
    clearProductImagePreviewObjectUrl();
    currentUploadImage = null;
    selectedProductImageFile = null;
    document.getElementById('imageZoomContainer').style.display = 'none';
    document.getElementById('productModalTitle').innerText = 'إضافة منتج';
    document.getElementById('editProdId').value = '';
    document.getElementById('newProdName').value = '';
    document.getElementById('newProdPrice').value = '';
    document.getElementById('newProdCategory').value = '';
    document.getElementById('newProdAllowHalfCarton').checked = false;
    tempProductImageUrl = '';
    tempProductImageId = null;
    tempProductStorageId = '';
    tempProductThumbUrl = '';
    tempProductMediumUrl = '';
    tempProductDeleteUrl = '';
    isProductImageUploading = false;
    productImageUploadFailed = false;
    setProductSaveDisabled(false);
    setProductImageUploadStatus('');
    document.getElementById('newProdImg').value = '';
    document.getElementById('prodImgPreview').innerHTML = '<i class="fas fa-camera"></i>';
    openModal('addProductModal');
}

function openEditProduct(id) {
    productImageUploadSequence++;
    clearProductImagePreviewObjectUrl();
    currentUploadImage = null;
    selectedProductImageFile = null;
    document.getElementById('imageZoomContainer').style.display = 'none';
    let p = db.products.find(x => x.id == id);
    document.getElementById('productModalTitle').innerText = 'تعديل منتج';
    document.getElementById('editProdId').value = p.id;
    document.getElementById('newProdName').value = p.name;
    document.getElementById('newProdPrice').value = p.price;
    document.getElementById('newProdCategory').value = p.category || '';
    document.getElementById('newProdAllowHalfCarton').checked = p.allowHalfCarton === true;
    
    tempProductImageUrl = p.imageUrl || '';
    tempProductImageId = p.imageId || null;
    tempProductStorageId = p.storageId || '';
    tempProductThumbUrl = p.thumbUrl || '';
    tempProductMediumUrl = p.mediumUrl || '';
    tempProductDeleteUrl = p.deleteUrl || '';
    isProductImageUploading = false;
    productImageUploadFailed = false;
    setProductSaveDisabled(false);
    setProductImageUploadStatus('');
    document.getElementById('newProdImg').value = '';
    if(tempProductImageUrl) {
        let img = new Image();
        img.onload = function() {
            currentUploadImage = img;
            imgScale = 1;
            imgPanX = 0;
            imgPanY = 0;
            document.getElementById('imageZoomContainer').style.display = 'flex';
            document.getElementById('imgZoomSlider').value = 1;
            updateImagePreview();
        };
        img.src = getProductMediumImageUrl(p);
    } else {
        document.getElementById('prodImgPreview').innerHTML = '<i class="fas fa-camera"></i>';
    }
    openModal('addProductModal');
}

async function saveProduct() {
    let name = document.getElementById('newProdName').value;
    let price = parseFloat(document.getElementById('newProdPrice').value);
    let category = document.getElementById('newProdCategory').value;
    let allowHalfCarton = document.getElementById('newProdAllowHalfCarton').checked;
    let editId = document.getElementById('editProdId').value;

    if(!name || isNaN(price)) { customAlert('يرجى إدخال اسم وسعر المنتج بشكل صحيح.'); return; }
    if(isProductImageUploading) { customAlert('يرجى انتظار اكتمال رفع الصورة.'); return; }
    if(productImageUploadFailed) { customAlert('تعذر حفظ المنتج لأن رفع الصورة فشل. يرجى اختيار الصورة من جديد.'); return; }
    
    if(editId) {
        let p = db.products.find(x => x.id == editId);
        const previousProduct = JSON.parse(JSON.stringify(p));
        const previousCartItem = db.cart.find(x => x.id == editId);
        const previousCartItemData = previousCartItem ? JSON.parse(JSON.stringify(previousCartItem)) : null;
        p.localId = p.localId || createLocalId('product');
        p.name = name;
        p.price = price;
        p.category = category;
        p.allowHalfCarton = allowHalfCarton;
        p.imageUrl = tempProductImageUrl;
        p.imageId = tempProductImageId;
        p.storageId = tempProductStorageId;
        p.thumbUrl = tempProductThumbUrl;
        p.mediumUrl = tempProductMediumUrl;
        p.deleteUrl = tempProductDeleteUrl;
        p.updatedAt = Date.now();
        delete p.img;
        
        let c = db.cart.find(x => x.id == editId);
        if(c) {
            c.name = name;
            c.price = price;
            c.allowHalfCarton = allowHalfCarton;
            if (!allowHalfCarton) {
                c.halfDecrementEnabled = false;
                c.isHalfCarton = false;
            }
            updateCartUI();
        }

        try {
            await saveProductAndQueueOperation(p, 'update');
            syncChangesIfOnline();
        } catch (error) {
            Object.assign(p, previousProduct);
            if (previousCartItem && previousCartItemData) Object.assign(previousCartItem, previousCartItemData);
            customAlert('تعذر حفظ تعديل المنتج محليًا.');
            return;
        }
        
        customAlert('تم تعديل المنتج بنجاح!');
    } else {
        let product = {
            localId: createLocalId('product'),
            id: Date.now(),
            name: name,
            price: price,
            category: category,
            allowHalfCarton: allowHalfCarton,
            imageUrl: tempProductImageUrl,
            imageId: tempProductImageId,
            storageId: tempProductStorageId,
            thumbUrl: tempProductThumbUrl,
            mediumUrl: tempProductMediumUrl,
            deleteUrl: tempProductDeleteUrl,
            updatedAt: Date.now()
        };
        db.products.push(product);
        try {
            await saveProductAndQueueOperation(product, 'create');
            syncChangesIfOnline();
        } catch (error) {
            db.products = db.products.filter(item => item.id !== product.id);
            customAlert('تعذر حفظ المنتج محليًا.');
            return;
        }
        customAlert('تم إضافة المنتج بنجاح!');
    }
    
    clearProductImagePreviewObjectUrl();
    selectedProductImageFile = null;
    currentUploadImage = null;
    tempProductStorageId = '';
    renderProducts(); closeModal('addProductModal');
}

async function deleteProduct(id) {
    const product = db.products.find(p => p.id == id);
    if (!product) return;
    customConfirm(`هل أنت متأكد من حذف المنتج «${product.name}»؟`, () => confirmDeleteProduct(id));
}

async function confirmDeleteProduct(id) {
    const product = db.products.find(p => p.id == id);
    if (!product) return;
    const previousProducts = JSON.parse(JSON.stringify(db.products));
    const previousCart = JSON.parse(JSON.stringify(db.cart));
    db.products = db.products.filter(p => p.id != id);
    db.cart = db.cart.filter(c => c.id != id);
    try {
        await deleteProductAndQueueOperation(product);
        syncChangesIfOnline();
    } catch (error) {
        db.products = previousProducts;
        db.cart = previousCart;
        customAlert('تعذر حفظ حذف المنتج محليًا.');
        return;
    }
    renderProducts(); updateCartUI(); customAlert('تم حذف المنتج بنجاح!');
}

async function toggleProductLock(id) {
    let p = db.products.find(x => x.id == id);
    if(p) {
        p.localId = p.localId || createLocalId('product');
        p.isHidden = !p.isHidden;
        p.updatedAt = Date.now();
        await saveProductAndQueueOperation(p, 'update');
        syncChangesIfOnline();
        renderProducts();
    }
}

function getOrderedPosProducts() {
    const savedOrder = Array.isArray(db.posProductOrder) ? db.posProductOrder.map(String) : [];
    const orderIndex = new Map(savedOrder.map((id, index) => [id, index]));
    return [...db.products].sort((first, second) => {
        const firstOrder = orderIndex.has(String(first.id)) ? orderIndex.get(String(first.id)) : Number.MAX_SAFE_INTEGER;
        const secondOrder = orderIndex.has(String(second.id)) ? orderIndex.get(String(second.id)) : Number.MAX_SAFE_INTEGER;
        if (firstOrder !== secondOrder) return firstOrder - secondOrder;
        return db.products.indexOf(first) - db.products.indexOf(second);
    });
}

let adminProductDragState = null;

function applyProductOrderToSalesGrid() {
    const posGrid = document.getElementById('pos-products-grid');
    if (!posGrid) return;
    const cardsById = new Map(
        [...posGrid.querySelectorAll('.pos-product-card')].map(card => [String(card.dataset.productId), card])
    );
    getOrderedPosProducts().forEach(product => {
        const card = cardsById.get(String(product.id));
        if (card) posGrid.appendChild(card);
    });
}

function saveAdminProductOrder() {
    const adminGrid = document.getElementById('admin-products-grid');
    if (!adminGrid) return;
    const orderedIds = [...adminGrid.querySelectorAll('.admin-product-card')]
        .map(card => String(card.dataset.productId));
    const orderedSet = new Set(orderedIds);
    const missingIds = getOrderedPosProducts()
        .map(product => String(product.id))
        .filter(id => !orderedSet.has(id));
    db.posProductOrder = [...orderedIds, ...missingIds];
    saveLocal();
    applyProductOrderToSalesGrid();
}

function moveAdminProductCard(event) {
    if (!adminProductDragState || event.pointerId !== adminProductDragState.pointerId) return;
    event.preventDefault();

    if (event.clientY < 100) window.scrollBy(0, -20);
    if (event.clientY > window.innerHeight - 110) window.scrollBy(0, 20);

    const dragged = adminProductDragState.card;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.admin-product-card');
    if (!target || target === dragged || target.parentElement !== dragged.parentElement) return;

    const cards = [...dragged.parentElement.querySelectorAll('.admin-product-card')];
    if (cards.indexOf(dragged) < cards.indexOf(target)) target.after(dragged);
    else target.before(dragged);
    adminProductDragState.moved = true;
}

function finishAdminProductDrag(event) {
    if (!adminProductDragState || event.pointerId !== adminProductDragState.pointerId) return;
    const { card, handle, moved } = adminProductDragState;
    try {
        if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    } catch (error) {
        // قد ينتهي التقاط المؤشر تلقائياً في بعض الأجهزة.
    }
    window.removeEventListener('pointermove', moveAdminProductCard);
    window.removeEventListener('pointerup', finishAdminProductDrag);
    window.removeEventListener('pointercancel', finishAdminProductDrag);
    card.classList.remove('admin-product-dragging');
    document.body.classList.remove('admin-product-reordering');
    adminProductDragState = null;
    if (moved) saveAdminProductOrder();
}

function startAdminProductDrag(event, productId) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget;
    const card = handle.closest('.admin-product-card');
    if (!card) return;

    event.preventDefault();
    event.stopPropagation();
    adminProductDragState = {
        pointerId: event.pointerId,
        productId: String(productId),
        card,
        handle,
        moved: false
    };
    try {
        handle.setPointerCapture?.(event.pointerId);
    } catch (error) {
        // تستمر مستمعات النافذة بالسحب حتى دون التقاط المؤشر.
    }
    card.classList.add('admin-product-dragging');
    document.body.classList.add('admin-product-reordering');
    window.addEventListener('pointermove', moveAdminProductCard, { passive: false });
    window.addEventListener('pointerup', finishAdminProductDrag);
    window.addEventListener('pointercancel', finishAdminProductDrag);
}

let lastOfflineImageCacheSignature = '';

function cacheProductImagesForOffline() {
    if (!navigator.onLine || !('serviceWorker' in navigator) || db.products.length === 0) return;
    const imageUrls = [...new Set(db.products.flatMap(product => [
        getProductImageUrl(product),
        getProductMediumImageUrl(product)
    ]).filter(url => url && url !== PRODUCT_IMAGE_PLACEHOLDER))];
    const signature = imageUrls.join('|');
    if (!signature || signature === lastOfflineImageCacheSignature) return;

    navigator.serviceWorker.ready.then(registration => {
        const worker = registration.active || navigator.serviceWorker.controller;
        if (!worker) return;
        worker.postMessage({ type: 'CACHE_PRODUCT_IMAGES', urls: imageUrls });
        lastOfflineImageCacheSignature = signature;
    }).catch(error => console.warn('تعذر تجهيز صور المنتجات للعمل دون إنترنت.', error));
}

function renderProducts() {
    const posGrid = document.getElementById('pos-products-grid');
    const adminGrid = document.getElementById('admin-products-grid');
    const lockedProductsCount = db.products.filter(product => product.isHidden === true).length;
    const availableProductsCount = db.products.length - lockedProductsCount;
    const lockedProductsCountElement = document.getElementById('adminLockedProductsCount');
    const availableProductsCountElement = document.getElementById('adminAvailableProductsCount');

    if (lockedProductsCountElement) lockedProductsCountElement.textContent = lockedProductsCount.toLocaleString();
    if (availableProductsCountElement) availableProductsCountElement.textContent = availableProductsCount.toLocaleString();
    
    // Force grid-3 to avoid browser caching old grid-2 class in HTML
    if (posGrid) {
        posGrid.className = 'grid-3';
        posGrid.style.display = 'grid';
        posGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    }
    if (adminGrid) {
        adminGrid.className = 'grid-3';
        adminGrid.style.display = 'grid';
        adminGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    }

    posGrid.innerHTML = ''; adminGrid.innerHTML = '';

    if(db.products.length === 0) {
        posGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: var(--text-muted);">لا توجد منتجات حالياً.</p>';
        adminGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: var(--text-muted);">لا توجد منتجات حالياً.</p>';
        return;
    }

    let posGridHtml = '';
    let adminGridHtml = '';
    const orderedPosProducts = getOrderedPosProducts();
    const filteredPosProducts = orderedPosProducts.filter(p => !p.isHidden && (activeCategoryFilter === 'الكل' || p.category === activeCategoryFilter));
    let posHasProducts = filteredPosProducts.length > 0;

    orderedPosProducts.forEach(p => {
        let catBadge = p.category ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:5px;">${p.category}</div>` : '';
        let halfCartonBadge = p.allowHalfCarton ? '<div class="half-carton-badge"><i class="fas fa-box-open"></i> تنقيص النصف مفعّل</div>' : '';
        let isLocked = p.isHidden ? true : false;
        let imgOpacity = isLocked ? "0.4" : "1";
        let lockIcon = isLocked ? "fa-lock" : "fa-unlock";
        let lockColor = isLocked ? "var(--text-muted)" : "var(--primary-green)";
        
        adminGridHtml += `
            <div class="card admin-product-card" data-product-id="${p.id}" style="position: relative; padding: 8px;">
                <div style="position: absolute; top: 12px; left: 12px; z-index: 2; background: rgba(0,0,0,0.5); border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${lockColor}; font-size: 12px;" onclick="toggleProductLock(${p.id})">
                    <i class="fas ${lockIcon}"></i>
                </div>
                <img src="${getProductImageUrl(p)}" alt="صورة" loading="lazy" style="width: 100%; height: auto; aspect-ratio: 1/1; object-fit: cover; border-radius: 8px; opacity: ${imgOpacity}; transition: opacity 0.3s;">
                <h3 style="font-size: 13px; margin: 5px 0; opacity: ${imgOpacity}; transition: opacity 0.3s;">${p.name}</h3>
                <div style="opacity: ${imgOpacity}; transition: opacity 0.3s;">${catBadge}</div>
                <div style="opacity: ${imgOpacity}; transition: opacity 0.3s;">${halfCartonBadge}</div>
                <div class="price" style="font-size: 13px; margin-bottom: 6px; opacity: ${imgOpacity}; transition: opacity 0.3s;">${p.price.toLocaleString()} د.ع</div>
                <div class="action-btns" style="margin-top: auto; display: flex; gap: 4px;">
                    <button class="btn-3d btn-blue" style="flex: 1; padding: 6px; font-size: 12px;" onclick="triggerFlip(this, () => openEditProduct(${p.id}))"><i class="fas fa-pen"></i></button>
                    <button class="btn-3d btn-red" style="flex: 1; padding: 6px; font-size: 12px;" onclick="triggerFlip(this, () => deleteProduct(${p.id}))"><i class="fas fa-trash"></i></button>
                </div>
                <button type="button" class="admin-order-handle" aria-label="اسحب لترتيب المنتج" onpointerdown="startAdminProductDrag(event, '${p.id}')">
                    <i class="fas fa-grip-lines"></i><span>اسحب للترتيب</span>
                </button>
            </div>`;

    });

    orderedPosProducts.forEach(p => {
        if (!p.isHidden && (activeCategoryFilter === 'الكل' || p.category === activeCategoryFilter)) {
            let catBadge = p.category ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:5px;">${p.category}</div>` : '';
            let halfCartonBadge = p.allowHalfCarton ? '<div class="half-carton-badge"><i class="fas fa-box-open"></i> يدعم تنقيص النصف</div>' : '';
            let posActionHtml = getProductCartActionsHtml(p);
            let halfCartonToggleHtml = getHalfCartonToggleHtml(p, db.cart.find(item => item.id == p.id));

            posGridHtml += `
                <div class="card pos-product-card" data-product-id="${p.id}" style="position:relative; display:flex; flex-direction:column; justify-content:space-between; padding:8px;">
                    <div style="background: transparent; border: none; padding: 0; margin: 0; width: 100%; text-align: right; color: inherit; flex: 1; user-select: none; display: block;">
                        <img src="${getProductImageUrl(p)}" alt="صورة" loading="lazy" style="pointer-events: none; width: 100%; height: auto; aspect-ratio: 1/1; object-fit: cover; border-radius: 8px;">
                        <div class="pos-product-title-row">
                            <h3 style="pointer-events: none; font-size: 13px; margin: 5px 0;">${p.name}</h3>
                            <span class="product-half-toggle-slot">${halfCartonToggleHtml}</span>
                        </div>
                        <div style="pointer-events: none;">${catBadge}</div>
                        <div style="pointer-events: none;">${halfCartonBadge}</div>
                        <div class="price" style="pointer-events: none; font-size: 13px; margin-bottom: 6px;">${p.price.toLocaleString()} د.ع</div>
                    </div>
                    <div class="product-cart-actions">${posActionHtml}</div>
                </div>`;
        }
    });

    if (!posHasProducts && db.products.length > 0) {
        posGridHtml = '<p style="grid-column: span 3; text-align: center; color: var(--text-muted); margin-top: 20px;">لا توجد منتجات مسجلة في هذه الفئة.</p>';
    }

    posGrid.innerHTML = posGridHtml;
    adminGrid.innerHTML = adminGridHtml;
    cacheProductImagesForOffline();
}

function getProductCartActionsHtml(product) {
    const cartItem = db.cart.find(item => item.id == product.id);
    if (!cartItem) {
        return `<button class="btn-3d btn-green" style="margin-top: 10px; width: 100%;" onclick="triggerFlip(this, () => addToCart(${product.id}))"><i class="fas fa-cart-plus"></i> أضف للسلة</button>`;
    }
    return `
        <div style="font-size: 12px; color: var(--primary-green); margin-top: 5px; font-weight: bold;">الإجمالي: ${(cartItem.price * cartItem.qty).toLocaleString()} د.ع</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px; gap: 5px;">
            <button class="btn-3d btn-red" style="width: 40px; padding: 5px;" onclick="changeQtyById(${product.id}, -1)">-</button>
            <span class="cart-qty-value" onclick="editQtyById(${product.id})">${cartItem.qty}</span>
            <button class="btn-3d btn-blue" style="width: 40px; padding: 5px;" onclick="changeQtyById(${product.id}, 1)">+</button>
        </div>
        <input type="text" placeholder="ملاحظة (اختياري)..." value="${cartItem.note || ''}" onchange="updateItemNote(${product.id}, this.value)" style="width: 100%; margin-top: 8px; padding: 6px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-light); text-align: center; font-size: 12px; outline: none; transition: 0.3s;" onfocus="this.style.borderColor='var(--primary-green)'" onblur="this.style.borderColor='var(--border-color)'">`;
}

function getHalfCartonToggleHtml(product, cartItem) {
    if (!product || product.allowHalfCarton !== true || !cartItem) return '';
    const isSelected = isHalfDecrementEnabled(cartItem);
    return `<label class="half-carton-toggle${isSelected ? ' selected' : ''}" title="تنقيص نصف كارتون">
        <input type="checkbox" aria-label="تنقيص نصف كارتون" ${isSelected ? 'checked' : ''} onchange="toggleHalfCartonById(${product.id}, this.checked)">
    </label>`;
}

function refreshProductCartActions() {
    document.querySelectorAll('.pos-product-card').forEach(card => {
        const product = db.products.find(item => String(item.id) === String(card.dataset.productId));
        const actions = card.querySelector('.product-cart-actions');
        if (product && actions) actions.innerHTML = getProductCartActionsHtml(product);
        const halfToggleSlot = card.querySelector('.product-half-toggle-slot');
        const cartItem = db.cart.find(item => String(item.id) === String(card.dataset.productId));
        if (product && halfToggleSlot) halfToggleSlot.innerHTML = getHalfCartonToggleHtml(product, cartItem);
    });
}

// ==========================================
// 5. إدارة الزبائن
// ==========================================
function openAddCustomerModal() {
    document.getElementById('customerModalTitle').innerText = 'إضافة زبون';
    document.getElementById('editCustId').value = '';
    document.getElementById('newCustName').value = '';
    document.getElementById('newCustPhone').value = '';
    document.getElementById('newCustAddress').value = '';
    openModal('addCustomerModal');
}

function editCustomer(id, event) {
    event.stopPropagation();
    let c = db.customers.find(x => x.id == id);
    if (!c) return;
    document.getElementById('customerModalTitle').innerText = 'تعديل زبون';
    document.getElementById('editCustId').value = c.id;
    document.getElementById('newCustName').value = c.name;
    document.getElementById('newCustPhone').value = c.phone || '';
    document.getElementById('newCustAddress').value = c.address || '';
    openModal('addCustomerModal');
}

function deleteCustomer(id, event) {
    event.stopPropagation();
    customPrompt("هل أنت متأكد من حذف هذا الزبون؟ اكتب 'نعم' للتأكيد", "", async function(val) {
        if(val === 'نعم') {
            const customer = db.customers.find(c => c.id == id);
            if (!customer) return;
            const previousCustomers = JSON.parse(JSON.stringify(db.customers));
            db.customers = db.customers.filter(c => c.id != id);
            const deletedCustomer = normalizeCustomerForStorage({
                ...customer,
                updatedAt: Date.now(),
                isDeleted: true
            });
            try {
                await saveAppDataAndQueueOperation('customer', customer.id, 'delete', deletedCustomer);
                syncChangesIfOnline();
            } catch (error) {
                db.customers = previousCustomers;
                customAlert('تعذر حفظ حذف الزبون محلياً. لم يتم حذف الزبون.');
                return;
            }
            renderCustomers(); updateCartCustomerSelect();
            customAlert('تم حذف الزبون بنجاح!');
        }
    });
}

async function saveCustomer() {
    let name = document.getElementById('newCustName').value.trim().replace(/\s+/g, ' ');
    let phone = document.getElementById('newCustPhone').value.trim();
    let address = document.getElementById('newCustAddress').value.trim();
    if(!name) { customAlert('يرجى إدخال اسم الزبون.'); return; }
    const previousCustomers = JSON.parse(JSON.stringify(db.customers));
    let editId = document.getElementById('editCustId').value;
    let customer;
    let action;
    if (editId) {
        customer = db.customers.find(x => x.id == editId);
        if (!customer) return;
        Object.assign(customer, normalizeCustomerForStorage({
            ...customer,
            name,
            phone,
            address,
            updatedAt: Date.now()
        }));
        action = 'update';
    } else {
        customer = normalizeCustomerForStorage({
            id: Date.now(),
            name,
            phone,
            address,
            updatedAt: Date.now()
        });
        db.customers.push(customer);
        action = 'create';
    }

    try {
        await saveAppDataAndQueueOperation('customer', customer.id, action, customer);
        syncChangesIfOnline();
    } catch (error) {
        db.customers = previousCustomers;
        customAlert('تعذر حفظ بيانات الزبون محلياً. لم يتم فقدان البيانات السابقة.');
        return;
    }

    customAlert(action === 'update' ? 'تم تعديل الزبون بنجاح!' : 'تم حفظ الزبون بنجاح!');
    renderCustomers(); updateCartCustomerSelect(); closeModal('addCustomerModal'); 
    document.getElementById('newCustName').value = ''; 
    document.getElementById('newCustPhone').value = '';
    document.getElementById('newCustAddress').value = '';
    document.getElementById('editCustId').value = '';
}

function renderCustomers() {
    const list = document.getElementById('customers-list'); 
    
    if(db.customers.length === 0) { 
        list.innerHTML = '<p style="text-align: center; color: var(--text-muted);">لا يوجد زبائن حالياً.</p>'; 
        return; 
    }

    const latestInvoiceByCustomer = new Map();
    db.invoices.forEach((invoice, index) => {
        const invoiceOrder = Number(invoice.id || index);
        const currentOrder = latestInvoiceByCustomer.get(invoice.customer) ?? -1;
        if (invoiceOrder > currentOrder) latestInvoiceByCustomer.set(invoice.customer, invoiceOrder);
    });

    const orderedCustomers = [...db.customers].sort((first, second) => {
        const firstSaleOrder = latestInvoiceByCustomer.get(first.name) ?? -1;
        const secondSaleOrder = latestInvoiceByCustomer.get(second.name) ?? -1;
        if (secondSaleOrder !== firstSaleOrder) return secondSaleOrder - firstSaleOrder;
        const creationOrder = Number(second.id || 0) - Number(first.id || 0);
        if (creationOrder !== 0) return creationOrder;
        return String(first.name || '').localeCompare(String(second.name || ''), 'ar');
    });

    let listHtml = '';
    orderedCustomers.forEach((c, index) => {
        let addressText = c.address ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;"><i class="fas fa-map-marker-alt"></i> ${c.address}</div>` : '';
        listHtml += `
            <div class="card" style="text-align: right; display: flex; flex-direction: row; justify-content: space-between; align-items: center; margin-bottom: 10px; cursor: pointer;" onclick="openLedger('${c.name}', ${c.id})">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                    <span style="flex:0 0 30px; height:30px; display:grid; place-items:center; border-radius:10px; background:var(--primary-green); color:#000; font-weight:900; box-shadow:0 4px 0 var(--green-shadow);">${index + 1}</span>
                    <div style="min-width:0;">
                    <h3 class="customer-name" style="margin: 0; color: var(--primary-green);"><i class="fas fa-user"></i> ${c.name}</h3>
                    <span style="font-size: 12px; color: var(--text-muted);">${c.phone || ''}</span>
                    ${addressText}
                    </div>
                </div>
                <div class="action-btns" style="margin: 0; display: flex; gap: 5px;">
                    <button class="btn-3d btn-blue" style="padding: 6px 10px;" onclick="editCustomer(${c.id}, event)"><i class="fas fa-pen"></i></button>
                    <button class="btn-3d btn-red" style="padding: 6px 10px;" onclick="deleteCustomer(${c.id}, event)"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    });
    list.innerHTML = listHtml;
}

function updateCartCustomerSelect() {
    let datalist = document.getElementById('cart-customers-list');
    let html = '';
    db.customers.forEach(c => { html += `<option value="${c.name}"></option>`; });
    if(datalist) datalist.innerHTML = html;
}


// ==========================================
// 6. نظام السلة والحفظ والتصدير
// ==========================================
function isHalfDecrementEnabled(item) {
    if (!item) return false;
    const currentProduct = db.products.find(product => product.id == item.id);
    const halfCartonAllowed = (currentProduct || item).allowHalfCarton === true;
    return halfCartonAllowed && (item.halfDecrementEnabled === true || item.isHalfCarton === true);
}

function isInvoiceItemHalfCarton(item) {
    if (!item) return false;
    const quantity = Number(item.qty);
    return Number.isFinite(quantity) && Math.abs(quantity % 1) === 0.5;
}

function roundCartQuantity(quantity) {
    return Math.round((Number(quantity) + Number.EPSILON) * 100) / 100;
}

function addToCart(productId) {
    let product = db.products.find(p => p.id == productId);
    if (!product) return;
    let existing = db.cart.find(c => c.id == productId);
    if(existing) {
        existing.allowHalfCarton = product.allowHalfCarton === true;
        existing.qty = roundCartQuantity(existing.qty + 1);
    } else {
        db.cart.push({ ...product, qty: 1, halfDecrementEnabled: false, isHalfCarton: false });
    }
    saveLocal();
    updateCartUI();
}

function toggleHalfCartonById(productId, isSelected) {
    const product = db.products.find(item => item.id == productId);
    if (!product || product.allowHalfCarton !== true) return;
    let cartItem = db.cart.find(item => item.id == productId);
    if (!cartItem) return;
    cartItem.halfDecrementEnabled = isSelected === true;
    cartItem.isHalfCarton = false;
    cartItem.allowHalfCarton = true;

    saveLocal();
    updateCartUI();
}

function changeQtyById(productId, change) {
    let index = db.cart.findIndex(c => c.id == productId);
    if (index !== -1) {
        changeQty(index, change);
    }
}

function updateItemNote(productId, note) {
    let item = db.cart.find(c => c.id == productId);
    if(item) {
        item.note = note;
        saveLocal();
        updateCartUI();
    }
}

function parseArabicLocaleNumber(str) {
    if (!str) return NaN;
    let converted = str.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    converted = converted.replace(/,/g, '.');
    return parseFloat(converted);
}

function editQtyById(productId) {
    let index = db.cart.findIndex(c => c.id == productId);
    if (index !== -1) {
        customPrompt("أدخل الكمية الجديدة لـ " + db.cart[index].name + ":", db.cart[index].qty, function(newQty) {
            let parsedQty = parseArabicLocaleNumber(newQty);
            if(!isNaN(parsedQty)) { 
                if (parsedQty > 0) {
                    db.cart[index].qty = parsedQty;
                } else {
                    db.cart.splice(index, 1);
                }
                saveLocal();
                updateCartUI();
            }
        });
    }
}

function updateCartUI() {
    let totalQty = db.cart.reduce((sum, item) => sum + item.qty, 0);
    let totalPrice = db.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    
    document.getElementById('cart-count').innerText = totalQty; document.getElementById('cart-modal-count').innerText = totalQty;
    document.getElementById('cart-total').innerText = totalPrice.toLocaleString() + ' د.ع';

    let banner = document.getElementById('editing-invoice-banner');
    if (banner) {
        banner.style.display = editingInvoiceId ? 'block' : 'none';
    }

    let container = document.getElementById('cart-items-container');
    let cartHtml = '';
    
    db.cart.forEach((item, index) => {
        cartHtml += `
            <div class="cart-item">
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 15px; margin-bottom: 2px;">${item.name}</div>
                    ${item.note ? `<div style="font-size: 11px; color: var(--primary-green); margin-bottom: 3px;">ملاحظة: ${item.note}</div>` : ''}
                    <div style="font-size: 13px; color: var(--text-muted);">السعر: <span class="editable-price" onclick="editPrice(${index})">${item.price.toLocaleString()}</span></div>
                </div>
                <div class="cart-item-controls">
                    <button onclick="changeQty(${index}, -1)">-</button>
                    <span class="cart-qty-value" onclick="editQtyById(${item.id})">${item.qty}</span>
                    <button onclick="changeQty(${index}, 1)">+</button>
                    <i class="fas fa-trash" style="color: #ff4d4d; margin-right: 10px; cursor: pointer; font-size: 18px;" onclick="removeFromCart(${index})"></i>
                </div>
            </div>`;
    });
    
    container.innerHTML = cartHtml;
    refreshProductCartActions();
}

function changeQty(index, change) {
    if (!db.cart[index]) return;
    const cartItem = db.cart[index];
    const appliedChange = change < 0 && isHalfDecrementEnabled(cartItem) ? -0.5 : change;
    cartItem.qty = roundCartQuantity(cartItem.qty + appliedChange);
    if(cartItem.qty <= 0) db.cart.splice(index, 1);
    saveLocal();
    updateCartUI();
}
function removeFromCart(index) { db.cart.splice(index, 1); saveLocal(); updateCartUI(); }
function editPrice(index) {
    customPrompt("أدخل السعر الجديد لـ " + db.cart[index].name + ":", db.cart[index].price, function(newPrice) {
        let parsedPrice = parseArabicLocaleNumber(newPrice);
        if(!isNaN(parsedPrice) && parsedPrice >= 0) { 
            db.cart[index].price = parsedPrice; 
            saveLocal(); 
            updateCartUI();
        }
    });
}

function selectPayment(btn) {
    document.querySelectorAll('.payment-btn').forEach(b => { b.classList.remove('active'); b.style.background = 'var(--input-bg)'; b.style.color = 'var(--text-light)'; });
    btn.classList.add('active'); btn.style.background = btn.getAttribute('data-color'); btn.style.color = (btn.getAttribute('data-status') === 'واصل') ? '#000' : '#fff';
}

function cancelEditInvoice() {
    editingInvoiceId = null;
    db.cart = [];
    document.getElementById('cart-customer-input').value = '';
    clearCustomerNameWarning();
    
    // Reset payment button
    document.querySelectorAll('.payment-btn').forEach(b => { 
        b.classList.remove('active'); 
        b.style.background = 'var(--input-bg)'; 
        b.style.color = 'var(--text-light)'; 
        if (b.getAttribute('data-status') === 'واصل') {
            b.classList.add('active');
            b.style.background = b.getAttribute('data-color');
            b.style.color = '#000';
        }
    });

    saveLocal();
    updateCartUI();
    closeModal('cartModal');
    customAlert("تم إلغاء التعديل وتفريغ السلة.");
}

function clearCustomerNameWarning() {
    const input = document.getElementById('cart-customer-input');
    const group = document.getElementById('cart-customer-group');
    const saveButton = document.getElementById('saveOrderBtn');
    const hasCustomerName = Boolean(input && input.value.trim());
    if (group && hasCustomerName) group.classList.remove('customer-name-missing');
    if (input) input.setAttribute('aria-invalid', hasCustomerName ? 'false' : 'true');
    if (saveButton) {
        saveButton.classList.toggle('customer-save-waiting', !hasCustomerName);
        saveButton.dataset.customerReady = hasCustomerName ? 'true' : 'false';
    }
}

function warnMissingCustomerName() {
    const input = document.getElementById('cart-customer-input');
    const group = document.getElementById('cart-customer-group');
    if (!input || !group) return;
    group.classList.remove('customer-name-missing');
    void group.offsetWidth;
    group.classList.add('customer-name-missing');
    input.setAttribute('aria-invalid', 'true');
    input.focus({ preventScroll: true });
    group.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveOrderAndShowDetails() {
    if(db.cart.length === 0) { customAlert("السلة فارغة!"); return; }

    const customerInput = document.getElementById('cart-customer-input');
    if (!customerInput.value.trim()) {
        warnMissingCustomerName();
        return;
    }

    let previousInvoices = JSON.parse(JSON.stringify(db.invoices));
    let previousCart = JSON.parse(JSON.stringify(db.cart));
    let previousEditingInvoiceId = editingInvoiceId;
    
    let custInput = customerInput.value.trim();
    let custName = custInput;
    let custPhone = "";
    if(custInput !== "") { 
        let c = db.customers.find(x => x.name === custName); 
        if(c) custPhone = c.phone; 
    }

    let statusBtn = document.querySelector('.payment-btn.active');
    let status = statusBtn ? statusBtn.getAttribute('data-status') : "واصل";
    let statusColor = statusBtn ? statusBtn.getAttribute('data-color') : "var(--primary-green)";
    
    let total = db.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    
    let date = new Date();
    let dateString = date.toLocaleDateString('ar-IQ');
    let timeString = date.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });

    let order;
    let queueAction = 'create';
    if (editingInvoiceId) {
        let existingIndex = db.invoices.findIndex(i => i.id === editingInvoiceId);
        if (existingIndex !== -1) {
            queueAction = 'update';
            order = db.invoices[existingIndex];
            order.localId = order.localId || createInvoiceLocalId();
            order.customer = custName;
            order.phone = custPhone;
            order.status = status;
            order.statusColor = statusColor;
            order.total = total;
            order.items = [...db.cart];
        } else {
            let orderId = db.invoices.length > 0 ? Math.max(...db.invoices.map(i => parseInt(i.id) || 1000)) + 1 : 1000;
            order = { localId: createInvoiceLocalId(), id: orderId, customer: custName, phone: custPhone, date: dateString, time: timeString, status: status, statusColor: statusColor, total: total, items: [...db.cart] };
            db.invoices.push(order);
        }
        editingInvoiceId = null;
    } else {
        let orderId = db.invoices.length > 0 ? Math.max(...db.invoices.map(i => parseInt(i.id) || 1000)) + 1 : 1000;
        order = { localId: createInvoiceLocalId(), id: orderId, customer: custName, phone: custPhone, date: dateString, time: timeString, status: status, statusColor: statusColor, total: total, items: [...db.cart] };
        db.invoices.push(order);
    }
    
    db.cart = [];

    try {
        await saveAppDataAndQueueOperation('invoice', order.id, queueAction, order);
    } catch (error) {
        db.invoices = previousInvoices;
        db.cart = previousCart;
        editingInvoiceId = previousEditingInvoiceId;
        updateCartUI();
        customAlert('تعذر حفظ الطلب محليًا. لم يتم فقدان بيانات السلة.');
        return;
    }

    updateCartUI();
    document.getElementById('cart-customer-input').value = '';
    clearCustomerNameWarning();
    closeModal('cartModal');
    showOrderDetails(order);
    if (!navigator.onLine) {
        customAlert('تم حفظ العملية محليًا وستتم مزامنتها لاحقًا.');
    }
}

function showOrderDetails(order) {
    document.getElementById('od-id').innerText = "طلب #" + order.id;
    document.getElementById('od-status').innerText = order.status; document.getElementById('od-status').style.background = order.statusColor;
    document.getElementById('od-cust').innerText = order.customer;
    document.getElementById('od-datetime').innerText = order.date + " | " + order.time;
    document.getElementById('od-total').innerText = order.total.toLocaleString() + " د.ع";
    document.getElementById('od-grand-total').innerText = order.total.toLocaleString() + " د.ع";

    let itemsHtml = "";
    order.items.forEach(item => {
        let itemTotal = item.price * item.qty;
        itemsHtml += `<div class="order-item-row"><span>${item.name} ${isInvoiceItemHalfCarton(item) ? '<span class="invoice-half-carton-label">(نصف كارتون)</span>' : ''} ${item.note ? `<span style="font-size:11px; color:var(--primary-green);">(${item.note})</span>` : ''} <span style="color:var(--text-muted); font-size:11px;">x${item.qty}</span></span><span>${itemTotal.toLocaleString()} د.ع</span></div>`;
    });
    document.getElementById('od-items-list').innerHTML = itemsHtml;

    document.getElementById('btn-export-pdf').onclick = () => { triggerFlip(document.getElementById('btn-export-pdf'), () => exportToPDF(order)); };
    document.getElementById('btn-share-wa').onclick = () => { triggerFlip(document.getElementById('btn-share-wa'), () => shareWhatsApp(order)); };
    document.getElementById('btn-delete-order').onclick = () => { triggerFlip(document.getElementById('btn-delete-order'), () => deleteOrderFromDetails(order)); };

    openModal('orderDetailsModal');
}

async function deleteOrderFromDetails(order) {
    let previousInvoices = JSON.parse(JSON.stringify(db.invoices));
    db.invoices = db.invoices.filter(i => i.id != order.id);

    try {
        await saveAppDataAndQueueOperation('invoice', order.id, 'delete', order);
        closeModal('orderDetailsModal');
        customAlert(navigator.onLine
            ? 'تم حذف الطلب نهائياً!'
            : 'تم حفظ العملية محليًا وستتم مزامنتها لاحقًا.');
    } catch (error) {
        db.invoices = previousInvoices;
        customAlert('تعذر حفظ حذف الطلب محليًا. لم يتم حذف الطلب.');
    }
}

function exportToPDF(order) {
    let printWindow = window.open('', '_blank'); let itemsRows = "";
    order.items.forEach((item, i) => { itemsRows += `<tr><td style="border:1px solid #ddd; padding:8px;">${i+1}</td><td style="border:1px solid #ddd; padding:8px;">${item.name}${isInvoiceItemHalfCarton(item) ? '<br><strong>نصف كارتون</strong>' : ''}${item.note ? `<br><span style="font-size:11px; color:#555;">${item.note}</span>` : ''}</td><td style="border:1px solid #ddd; padding:8px;">${item.qty}</td><td style="border:1px solid #ddd; padding:8px;">${item.price.toLocaleString()}</td><td style="border:1px solid #ddd; padding:8px;">${(item.price * item.qty).toLocaleString()}</td></tr>`; });

    let html = `
    <html dir="rtl" lang="ar">
    <head>
        <title>فاتورة #${order.id}</title>
        <style> 
            body{font-family: Arial, sans-serif; padding:20px; font-size: 14px;} 
            .header-info { text-align: center; margin-bottom: 20px; }
            .header-info h1 { margin: 0; font-size: 24px; }
            .header-info p { margin: 5px 0; }
            table{width:100%; border-collapse:collapse; margin-top:20px; text-align:center;} 
            th{background:#f2f2f2; border:1px solid #ddd; padding:10px;} 
            td{border:1px solid #ddd; padding:8px;}
        </style>
    </head>
    <body onload="window.print();">
        <div class="header-info">
            <h1>مكتب الجوهرة للتجارة لحلويات والمشروبات</h1>
            <p>بإدارة: حسين</p>
            <p>العنوان: ميسان</p>
            <p>أرقام المكتب: 07735277518 | 07744090022</p>
        </div>
        <hr style="border: 1px dashed #ddd; margin: 20px 0;">
        <h2 style="text-align:center;">فاتورة مبيعات</h2>
        <div style="display:flex; justify-content:space-between; margin-top:10px;"><div><strong>رقم الفاتورة:</strong> ${order.id}</div><div><strong>التاريخ:</strong> ${order.date} - ${order.time}</div></div>
        <div style="margin-top:10px;"><strong>العميل:</strong> ${order.customer}</div>
        <table><tr><th>ت</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>${itemsRows}</table>
        <h3 style="text-align:left; margin-top:20px;">الإجمالي الكلي: ${order.total.toLocaleString()} د.ع</h3>
        <p style="text-align:left;">حالة الدفع: ${order.status}</p>
    </body></html>`;
    printWindow.document.write(html); printWindow.document.close();
}

function shareWhatsApp(order) {
    let text = `*فاتورة مبيعات*\nرقم: ${order.id}\nالعميل: ${order.customer}\nالتاريخ: ${order.date} ${order.time}\n\n*المشتريات:*\n`;
    order.items.forEach((item, i) => { text += `${i+1}. ${item.name}${isInvoiceItemHalfCarton(item) ? ' (نصف كارتون)' : ''}${item.note ? ` (${item.note})` : ''} - العدد: ${item.qty} - السعر: ${(item.price * item.qty).toLocaleString()} د.ع\n`; });
    text += `\n*الإجمالي الكلي: ${order.total.toLocaleString()} د.ع*\nحالة الدفع: ${order.status}`;
    let url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    if(order.phone) url = `https://api.whatsapp.com/send?phone=${order.phone.replace(/^0/, '+964')}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

function deleteInvoice(invoiceId) {
    let inv = db.invoices.find(i => i.id == invoiceId);
    if (!inv) return;
    
    customPrompt("هل أنت متأكد من حذف هذه الفاتورة؟ (نعم/لا)", "لا", async function(val) {
        if(val === 'نعم') {
            let previousInvoices = JSON.parse(JSON.stringify(db.invoices));
            db.invoices = db.invoices.filter(i => i.id != invoiceId);
            try {
                await saveAppDataAndQueueOperation('invoice', inv.id, 'delete', inv);
            } catch (error) {
                db.invoices = previousInvoices;
                customAlert('تعذر حفظ حذف الفاتورة محليًا. لم يتم حذف الفاتورة.');
                return;
            }
            // Refresh ledger if open
            if (document.getElementById('customerLedgerModal').style.display === 'flex') {
                openLedger(inv.customer);
            }
            customAlert(navigator.onLine
                ? 'تم حذف الفاتورة بنجاح.'
                : 'تم حفظ العملية محليًا وستتم مزامنتها لاحقًا.');
        }
    });
}

function editInvoice(invoiceId) {
    let inv = db.invoices.find(i => i.id == invoiceId);
    if (!inv) return;
    
    customPrompt("تعديل هذه الفاتورة سيقوم بمسح السلة الحالية. هل أنت متأكد؟ (نعم/لا)", "نعم", function(val) {
        if(val === 'نعم') {
            db.cart = JSON.parse(JSON.stringify(inv.items));
            editingInvoiceId = inv.id;
            
            document.getElementById('cart-customer-input').value = inv.customer;
            clearCustomerNameWarning();
            
            document.querySelectorAll('.payment-btn').forEach(b => { 
                b.classList.remove('active'); 
                b.style.background = 'var(--input-bg)'; 
                b.style.color = 'var(--text-light)'; 
                if (b.getAttribute('data-status') === inv.status) {
                    b.classList.add('active');
                    b.style.background = b.getAttribute('data-color');
                    b.style.color = (b.getAttribute('data-status') === 'واصل') ? '#000' : '#fff';
                }
            });

            saveLocal();
            updateCartUI();
            closeModal('customerLedgerModal');
            switchTab('tab-pos', document.querySelector('.nav-item')); 
            openModal('cartModal');
            customAlert("تم تحميل الفاتورة إلى السلة للتعديل.");
        }
    });
}

function openLedger(name, custId) {
    document.getElementById('ledger-name').innerText = name;
    let custInvoices = db.invoices.filter(i => i.customer === name);
    let debt = custInvoices.filter(i => i.status !== "واصل").reduce((sum, i) => sum + i.total, 0);
    document.getElementById('ledger-debt').innerText = debt.toLocaleString() + " د.ع";
    
    let invHtml = "";
    if(custInvoices.length === 0) { invHtml = `<div class="invoice-row" style="justify-content:center; color:var(--text-muted);">لا توجد معاملات سابقة</div>`; } 
    else {
        custInvoices.forEach(inv => {
            invHtml += `
            <div class="invoice-row">
                <div><strong>فاتورة #${inv.id}</strong><br><span style="font-size: 12px; color: var(--text-muted);">${inv.date} ${inv.time} - ${inv.status}</span></div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn-3d btn-blue" style="padding: 8px;" onclick="editInvoice(${inv.id})"><i class="fas fa-pen"></i></button>
                    <button class="btn-3d btn-blue" style="padding: 8px;" onclick="exportToPDF(${JSON.stringify(inv).replace(/"/g, '&quot;')})"><i class="fas fa-file-pdf"></i></button>
                    <button class="btn-3d" style="padding: 8px; background:#25D366;" onclick="shareWhatsApp(${JSON.stringify(inv).replace(/"/g, '&quot;')})"><i class="fab fa-whatsapp"></i></button>
                    <button class="btn-3d" style="padding: 8px; background:#e60000; color:white;" onclick="deleteInvoice(${inv.id})"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        });
    }
    document.getElementById('ledger-invoices').innerHTML = invHtml; openModal('customerLedgerModal');
}

// دوال التنبيهات
function customAlert(message) { document.getElementById('customAlertMessage').innerText = message; openModal('customAlertModal'); }
let currentConfirmCallback = null;
function customConfirm(message, callback) {
    document.getElementById('customConfirmMessage').innerText = message;
    currentConfirmCallback = callback;
    openModal('customConfirmModal');
    setTimeout(() => document.getElementById('customConfirmCancelBtn').focus(), 100);
}
function closeCustomConfirm() {
    currentConfirmCallback = null;
    closeModal('customConfirmModal');
}
document.getElementById('customConfirmYesBtn').addEventListener('click', function() {
    const callback = currentConfirmCallback;
    currentConfirmCallback = null;
    closeModal('customConfirmModal');
    if (callback) callback();
});
document.getElementById('customConfirmCancelBtn').addEventListener('click', closeCustomConfirm);
let currentPromptCallback = null;
function customPrompt(message, defaultValue, callback) {
    document.getElementById('customPromptMessage').innerText = message; let inputField = document.getElementById('customPromptInput');
    inputField.value = defaultValue || ''; currentPromptCallback = callback; openModal('customPromptModal'); setTimeout(() => inputField.focus(), 100);
}
document.getElementById('promptConfirmBtn').addEventListener('click', function() {
    let val = document.getElementById('customPromptInput').value; closeModal('customPromptModal'); if(currentPromptCallback) currentPromptCallback(val);
});

function compareAppVersions(firstVersion, secondVersion) {
    const first = String(firstVersion || '').split('.').map(value => Number(value) || 0);
    const second = String(secondVersion || '').split('.').map(value => Number(value) || 0);
    const length = Math.max(first.length, second.length);
    for (let index = 0; index < length; index++) {
        if ((first[index] || 0) > (second[index] || 0)) return 1;
        if ((first[index] || 0) < (second[index] || 0)) return -1;
    }
    return 0;
}

let latestAvailableVersion = APP_VERSION;
let updateCheckInProgress = false;

function setUpdateAvailable(version) {
    latestAvailableVersion = version;
    const banner = document.getElementById('appUpdateBanner');
    const bannerVersion = document.getElementById('appUpdateBannerVersion');
    const settingsButton = document.getElementById('settingsUpdateBtn');
    const status = document.getElementById('appVersionStatus');
    if (banner) banner.hidden = false;
    if (bannerVersion) bannerVersion.textContent = `الإصدار الجديد: ${version}`;
    if (settingsButton) settingsButton.hidden = false;
    if (status) status.textContent = `يتوفر إصدار أحدث: ${version}`;
}

function setAppUpToDate() {
    const banner = document.getElementById('appUpdateBanner');
    const settingsButton = document.getElementById('settingsUpdateBtn');
    const status = document.getElementById('appVersionStatus');
    if (banner) banner.hidden = true;
    if (settingsButton) settingsButton.hidden = true;
    if (status) status.textContent = navigator.onLine ? 'النسخة محدثة.' : 'أنت تعمل دون إنترنت.';
}

async function checkForAppUpdate(silent = false) {
    document.getElementById('currentAppVersion').textContent = `v${APP_VERSION}`;
    const status = document.getElementById('appVersionStatus');
    if (!navigator.onLine) {
        if (status) status.textContent = 'يتطلب فحص التحديث اتصالاً بالإنترنت.';
        return false;
    }
    if (updateCheckInProgress) return false;
    updateCheckInProgress = true;
    if (status && !silent) status.textContent = 'جاري فحص التحديثات…';
    try {
        const response = await fetch(`./version.json?check=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Version check failed: ${response.status}`);
        const release = await response.json();
        const version = String(release.version || '').trim();
        if (!version) throw new Error('Version file is invalid');
        if (compareAppVersions(version, APP_VERSION) > 0) {
            setUpdateAvailable(version);
            return true;
        }
        latestAvailableVersion = APP_VERSION;
        setAppUpToDate();
        return false;
    } catch (error) {
        console.warn('تعذر فحص تحديث التطبيق.', error);
        if (status) status.textContent = 'تعذر فحص التحديث الآن. حاول لاحقاً.';
        return false;
    } finally {
        updateCheckInProgress = false;
    }
}

async function applyAppUpdate() {
    if (!navigator.onLine) {
        customAlert('يجب الاتصال بالإنترنت لتنزيل التحديث.');
        return;
    }
    const updateButtons = [
        document.querySelector('#appUpdateBanner button'),
        document.getElementById('settingsUpdateBtn')
    ].filter(Boolean);
    updateButtons.forEach(button => {
        button.disabled = true;
        button.textContent = 'جاري التحديث…';
    });
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration('./');
            if (registration) {
                await registration.update();
                if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
        }
        if ('caches' in globalThis) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames
                .filter(name => name.startsWith('pos-offline-'))
                .map(name => caches.delete(name)));
        }
        const targetVersion = encodeURIComponent(latestAvailableVersion || Date.now());
        window.location.replace(`./?updated=${targetVersion}&time=${Date.now()}`);
    } catch (error) {
        console.error('تعذر تطبيق تحديث التطبيق.', error);
        updateButtons.forEach(button => { button.disabled = false; });
        customAlert('تعذر تنزيل التحديث. تحقق من الإنترنت وحاول مرة أخرى.');
    }
}

let sharedDataRefreshInProgress = false;
async function refreshSharedDataFromServer() {
    if (!navigator.onLine || sharedDataRefreshInProgress) return;
    sharedDataRefreshInProgress = true;
    try {
        await syncPendingChangesToConvex();
        const downloaded = await downloadCatalogFromConvex();
        if (downloaded) {
            renderCategories();
            renderProducts();
            renderCustomers();
            updateCartCustomerSelect();
        }
    } finally {
        sharedDataRefreshInProgress = false;
    }
}

// التشغيل المبدئي
loadAppDatabase().then(() => {
    document.getElementById('currentAppVersion').textContent = `v${APP_VERSION}`;
    if (navigator.onLine) refreshSharedDataFromServer();
    checkForAppUpdate(true);
});

window.addEventListener('online', async () => {
    await refreshSharedDataFromServer();
    cacheProductImagesForOffline();
    checkForAppUpdate(true);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    refreshSharedDataFromServer();
    checkForAppUpdate(true);
});

setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) refreshSharedDataFromServer();
}, 60000);

setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) checkForAppUpdate(true);
}, 300000);
