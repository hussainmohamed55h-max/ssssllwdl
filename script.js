// إعداد قاعدة البيانات IndexedDB ذات المساحة المفتوحة
const IDB_NAME = 'POSAppDB_AbuAmir';
const IDB_STORE = 'appStorage';

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        let request = indexedDB.open(IDB_NAME, 1);
        request.onupgradeneeded = function(e) {
            let db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
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

// قاعدة بيانات تتضمن الفئات الآن
let db = { products: [], customers: [], cart: [], invoices: [], categories: [] };

// استرجاع البيانات من التخزين المحلي (التحديث لاستخدام IndexedDB مع دعم نقل القديم)
async function loadAppDatabase() {
    try {
        let savedDb = await getFromIndexedDB('pos_db_abu_amir');
        
        // التوافقية الرجعية: استيراد البيانات القديمة من localStorage إن وجدت ولم يتم نقلها بعد
        if (!savedDb && localStorage.getItem('pos_db_abu_amir')) {
            savedDb = JSON.parse(localStorage.getItem('pos_db_abu_amir'));
        }

        if(savedDb) {
            db.products = savedDb.products || [];
            db.customers = savedDb.customers || [];
            db.cart = savedDb.cart || [];
            db.invoices = savedDb.invoices || [];
            db.categories = savedDb.categories || [];
        }
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
        saveToIndexedDB('pos_db_abu_amir', db).catch(e => {
            console.error("خطأ في الحفظ", e);
            customAlert("حدث خطأ أثناء الحفظ. يرجى التأكد من مساحة الجهاز.");
        });
    }, 150); // تأخير بسيط لمنع التكرار المستمر
}

let activeCategoryFilter = 'الكل'; // متغير لتتبع الفئة المحددة
let editingInvoiceId = null; // متغير لتتبع الفاتورة قيد التعديل

// ==========================================
// 1. المظهر والنسخ الاحتياطي
// ==========================================
let isLightMode = true;
function toggleTheme() {
    isLightMode = !isLightMode;
    document.body.classList.toggle('light-mode', isLightMode);
    document.getElementById('themeToggleBtn').innerHTML = isLightMode ? '<i class="fas fa-sun"></i> المظهر: نهاري (أساسي)' : '<i class="fas fa-moon"></i> المظهر: ليلي';
}

function exportBackup() {
    let dataStr = JSON.stringify(db);
    let dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    let linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'backup_sales_app.json');
    document.body.appendChild(linkElement); linkElement.click(); document.body.removeChild(linkElement);
    customAlert('تم تحميل النسخة الاحتياطية بنجاح!');
}

function importBackup() { document.getElementById('backupInput').click(); }
document.getElementById('backupInput').addEventListener('change', function(event) {
    let file = event.target.files[0]; if (!file) return;
    let reader = new FileReader();
    reader.onload = function(e) {
        try {
            let importedDb = JSON.parse(e.target.result);
            if(importedDb && importedDb.products) {
                db.products = importedDb.products || [];
                db.customers = importedDb.customers || [];
                db.cart = importedDb.cart || [];
                db.invoices = importedDb.invoices || [];
                db.categories = importedDb.categories || [];
                saveLocal(); 
                renderCategories(); renderProducts(); renderCustomers(); updateCartCustomerSelect(); updateCartUI();
                customAlert('تم استعادة النسخة الاحتياطية بنجاح!');
            }
        } catch(err) { customAlert('حدث خطأ أثناء قراءة الملف!'); }
    };
    reader.readAsText(file); event.target.value = '';
});

// ==========================================
// 2. التحكم بالنوافذ والتنقل
// ==========================================
function switchTab(tabId, navElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if(navElement) navElement.classList.add('active');
}
function triggerFlip(btn, callback) {
    btn.classList.add('flip-animate');
    setTimeout(() => { btn.classList.remove('flip-animate'); if(callback) callback(); }, 400);
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ==========================================
// 3. إدارة الفئات
// ==========================================
function saveCategory() {
    let name = document.getElementById('newCategoryName').value;
    if(!name) { customAlert('يرجى إدخال اسم الفئة'); return; }
    db.categories.push({ id: Date.now(), name: name });
    saveLocal();
    document.getElementById('newCategoryName').value = '';
    renderCategories();
}

function deleteCategory(id) {
    db.categories = db.categories.filter(c => c.id !== id);
    if(activeCategoryFilter !== 'الكل' && !db.categories.find(c => c.name === activeCategoryFilter)) {
        activeCategoryFilter = 'الكل';
    }
    saveLocal();
    renderCategories();
    renderProducts();
}

function editCategory(id) {
    let cat = db.categories.find(c => c.id == id);
    customPrompt('تعديل اسم الفئة:', cat.name, function(newVal) {
        if(newVal) { 
            if(activeCategoryFilter === cat.name) activeCategoryFilter = newVal;
            cat.name = newVal; 
            saveLocal();
            renderCategories(); 
            renderProducts();
        }
    });
}

function filterProducts(category, element) {
    activeCategoryFilter = category;
    document.querySelectorAll('#pos-categories-pills .pill').forEach(p => p.classList.remove('active'));
    if(element) element.classList.add('active');
    renderProducts();
}

function renderCategories() {
    const listModal = document.getElementById('categories-list-modal');
    listModal.innerHTML = '';
    if(db.categories.length === 0) {
        listModal.innerHTML = '<p style="text-align:center; color:var(--text-muted);">لا توجد فئات.</p>';
    } else {
        let listHtml = '';
        db.categories.forEach(c => {
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
    db.categories.forEach(c => { selectHtml += `<option value="${c.name}">${c.name}</option>`; });
    select.innerHTML = selectHtml;

    const pills = document.getElementById('pos-categories-pills');
    let pillsHtml = `<div class="pill ${activeCategoryFilter === 'الكل' ? 'active' : ''}" onclick="filterProducts('الكل', this)">الكل</div>`;
    db.categories.forEach(c => { 
        pillsHtml += `<div class="pill ${activeCategoryFilter === c.name ? 'active' : ''}" onclick="filterProducts('${c.name}', this)">${c.name}</div>`; 
    });
    pills.innerHTML = pillsHtml;
}

// ==========================================
// 4. إدارة المنتجات 
// ==========================================
let tempProdImg = "";
let currentUploadImage = null; // الصورة الأصلية
let imgScale = 1;
let imgPanX = 0;
let imgPanY = 0;

document.getElementById('newProdImg').addEventListener('change', function(e) {
    let file = e.target.files[0];
    if(file) {
        let reader = new FileReader();
        reader.onload = function(evt) {
            let img = new Image();
            img.onload = function() {
                currentUploadImage = img;
                imgScale = 1;
                imgPanX = 0;
                imgPanY = 0;
                document.getElementById('imageZoomContainer').style.display = 'flex';
                document.getElementById('imgZoomSlider').value = 1;
                updateImagePreview();
            }
            img.src = evt.target.result;
        }
        reader.readAsDataURL(file);
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
    currentUploadImage = null;
    document.getElementById('imageZoomContainer').style.display = 'none';
    document.getElementById('productModalTitle').innerText = 'إضافة منتج';
    document.getElementById('editProdId').value = '';
    document.getElementById('newProdName').value = '';
    document.getElementById('newProdPrice').value = '';
    document.getElementById('newProdCategory').value = '';
    tempProdImg = '';
    document.getElementById('prodImgPreview').innerHTML = '<i class="fas fa-camera"></i>';
    openModal('addProductModal');
}

function openEditProduct(id) {
    currentUploadImage = null;
    document.getElementById('imageZoomContainer').style.display = 'none';
    let p = db.products.find(x => x.id == id);
    document.getElementById('productModalTitle').innerText = 'تعديل منتج';
    document.getElementById('editProdId').value = p.id;
    document.getElementById('newProdName').value = p.name;
    document.getElementById('newProdPrice').value = p.price;
    document.getElementById('newProdCategory').value = p.category || '';
    
    tempProdImg = p.img;
    if(p.img && !p.img.includes('No+Image')) {
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
        img.src = p.img;
    } else {
        document.getElementById('prodImgPreview').innerHTML = '<i class="fas fa-camera"></i>';
    }
    openModal('addProductModal');
}

function saveProduct() {
    let name = document.getElementById('newProdName').value;
    let price = parseFloat(document.getElementById('newProdPrice').value);
    let category = document.getElementById('newProdCategory').value;
    let editId = document.getElementById('editProdId').value;

    if(!name || isNaN(price)) { customAlert('يرجى إدخال اسم وسعر المنتج بشكل صحيح.'); return; }
    
    if(currentUploadImage) {
        let size = 800;
        let canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        let ctx = canvas.getContext('2d');
        
        ctx.fillStyle = "#1e1e1e";
        ctx.fillRect(0,0,size,size);
        
        let previewScaleRatio = size / 100;
        let baseScale = Math.max(size / currentUploadImage.width, size / currentUploadImage.height);
        
        let finalWidth = currentUploadImage.width * baseScale * imgScale;
        let finalHeight = currentUploadImage.height * baseScale * imgScale;
        
        let drawX = (size - finalWidth) / 2 + (imgPanX * previewScaleRatio);
        let drawY = (size - finalHeight) / 2 + (imgPanY * previewScaleRatio);
        
        ctx.drawImage(currentUploadImage, drawX, drawY, finalWidth, finalHeight);
        tempProdImg = canvas.toDataURL('image/jpeg', 0.85);
    }
    
    let imgToSave = tempProdImg || 'https://placehold.co/400x400/2a2a2a/ffffff/png?text=No+Image';

    if(editId) {
        let p = db.products.find(x => x.id == editId);
        p.name = name; p.price = price; p.category = category; p.img = imgToSave;
        
        let c = db.cart.find(x => x.id == editId);
        if(c) { c.name = name; c.price = price; updateCartUI(); }
        
        customAlert('تم تعديل المنتج بنجاح!');
    } else {
        db.products.push({ id: Date.now(), name: name, price: price, category: category, img: imgToSave });
        customAlert('تم إضافة المنتج بنجاح!');
    }
    
    saveLocal();
    renderProducts(); closeModal('addProductModal');
}

function deleteProduct(id) {
    db.products = db.products.filter(p => p.id != id);
    db.cart = db.cart.filter(c => c.id != id);
    saveLocal();
    renderProducts(); updateCartUI(); customAlert('تم حذف المنتج بنجاح!');
}

function toggleProductLock(id) {
    let p = db.products.find(x => x.id == id);
    if(p) {
        p.isHidden = !p.isHidden;
        saveLocal();
        renderProducts();
    }
}

function renderProducts() {
    const posGrid = document.getElementById('pos-products-grid');
    const adminGrid = document.getElementById('admin-products-grid');
    
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
    let posHasProducts = false;

    db.products.forEach(p => {
        let catBadge = p.category ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:5px;">${p.category}</div>` : '';
        let isLocked = p.isHidden ? true : false;
        let imgOpacity = isLocked ? "0.4" : "1";
        let lockIcon = isLocked ? "fa-lock" : "fa-unlock";
        let lockColor = isLocked ? "var(--text-muted)" : "var(--primary-green)";
        
        adminGridHtml += `
            <div class="card" style="position: relative; padding: 8px;">
                <div style="position: absolute; top: 12px; left: 12px; z-index: 2; background: rgba(0,0,0,0.5); border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${lockColor}; font-size: 12px;" onclick="toggleProductLock(${p.id})">
                    <i class="fas ${lockIcon}"></i>
                </div>
                <img src="${p.img}" alt="صورة" style="width: 100%; height: auto; aspect-ratio: 1/1; object-fit: cover; border-radius: 8px; opacity: ${imgOpacity}; transition: opacity 0.3s;">
                <h3 style="font-size: 13px; margin: 5px 0; opacity: ${imgOpacity}; transition: opacity 0.3s;">${p.name}</h3>
                <div style="opacity: ${imgOpacity}; transition: opacity 0.3s;">${catBadge}</div>
                <div class="price" style="font-size: 13px; margin-bottom: 6px; opacity: ${imgOpacity}; transition: opacity 0.3s;">${p.price.toLocaleString()} د.ع</div>
                <div class="action-btns" style="margin-top: auto; display: flex; gap: 4px;">
                    <button class="btn-3d btn-blue" style="flex: 1; padding: 6px; font-size: 12px;" onclick="triggerFlip(this, () => openEditProduct(${p.id}))"><i class="fas fa-pen"></i></button>
                    <button class="btn-3d btn-red" style="flex: 1; padding: 6px; font-size: 12px;" onclick="triggerFlip(this, () => deleteProduct(${p.id}))"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;

        if (!p.isHidden && (activeCategoryFilter === 'الكل' || p.category === activeCategoryFilter)) {
            posHasProducts = true;
            let cartItem = db.cart.find(c => c.id == p.id);
            let posActionHtml = '';
            
            if(cartItem) {
                posActionHtml = `
                <div style="font-size: 12px; color: var(--primary-green); margin-top: 5px; font-weight: bold;">الإجمالي: ${(p.price * cartItem.qty).toLocaleString()} د.ع</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px; gap: 5px;">
                    <button class="btn-3d btn-red" style="width: 40px; padding: 5px;" onclick="changeQtyById(${p.id}, -0.5)">-</button>
                    <span style="font-weight: bold; font-size: 18px; cursor: pointer; border-bottom: 1px dashed var(--primary-green);" onclick="editQtyById(${p.id})">${cartItem.qty}</span>
                    <button class="btn-3d btn-blue" style="width: 40px; padding: 5px;" onclick="changeQtyById(${p.id}, 0.5)">+</button>
                </div>
                <input type="text" placeholder="ملاحظة (اختياري)..." value="${cartItem.note || ''}" onchange="updateItemNote(${p.id}, this.value)" style="width: 100%; margin-top: 8px; padding: 6px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-light); text-align: center; font-size: 12px; outline: none; transition: 0.3s;" onfocus="this.style.borderColor='var(--primary-green)'" onblur="this.style.borderColor='var(--border-color)'">`;
            } else {
                posActionHtml = `<button class="btn-3d btn-green" style="margin-top: 10px; width: 100%;" onclick="triggerFlip(this, () => addToCart(${p.id}))"><i class="fas fa-cart-plus"></i> أضف للسلة</button>`;
            }

            posGridHtml += `
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; padding: 8px;">
                    <div style="background: transparent; border: none; padding: 0; margin: 0; width: 100%; text-align: right; color: inherit; flex: 1; user-select: none; display: block;">
                        <img src="${p.img}" alt="صورة" style="pointer-events: none; width: 100%; height: auto; aspect-ratio: 1/1; object-fit: cover; border-radius: 8px;">
                        <h3 style="pointer-events: none; font-size: 13px; margin: 5px 0;">${p.name}</h3>
                        <div style="pointer-events: none;">${catBadge}</div>
                        <div class="price" style="pointer-events: none; font-size: 13px; margin-bottom: 6px;">${p.price.toLocaleString()} د.ع</div>
                    </div>
                    <div>${posActionHtml}</div>
                </div>`;
        }
    });

    if (!posHasProducts && db.products.length > 0) {
        posGridHtml = '<p style="grid-column: span 3; text-align: center; color: var(--text-muted); margin-top: 20px;">لا توجد منتجات مسجلة في هذه الفئة.</p>';
    }

    posGrid.innerHTML = posGridHtml;
    adminGrid.innerHTML = adminGridHtml;
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
    customPrompt("هل أنت متأكد من حذف هذا الزبون؟ اكتب 'نعم' للتأكيد", "", function(val) {
        if(val === 'نعم') {
            db.customers = db.customers.filter(c => c.id != id);
            saveLocal();
            renderCustomers(); updateCartCustomerSelect();
            customAlert('تم حذف الزبون بنجاح!');
        }
    });
}

function saveCustomer() {
    let name = document.getElementById('newCustName').value;
    let phone = document.getElementById('newCustPhone').value;
    let address = document.getElementById('newCustAddress').value;
    if(!name) { customAlert('يرجى إدخال اسم الزبون.'); return; }
    
    let editId = document.getElementById('editCustId').value;
    if (editId) {
        let c = db.customers.find(x => x.id == editId);
        if (c) {
            c.name = name;
            c.phone = phone;
            c.address = address;
        }
        customAlert('تم تعديل الزبون بنجاح!');
    } else {
        db.customers.push({ id: Date.now(), name: name, phone: phone, address: address });
        customAlert('تم حفظ الزبون بنجاح!');
    }
    
    saveLocal();
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

    let listHtml = '';
    db.customers.forEach(c => {
        let addressText = c.address ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;"><i class="fas fa-map-marker-alt"></i> ${c.address}</div>` : '';
        listHtml += `
            <div class="card" style="text-align: right; display: flex; flex-direction: row; justify-content: space-between; align-items: center; margin-bottom: 10px; cursor: pointer;" onclick="openLedger('${c.name}', ${c.id})">
                <div>
                    <h3 style="margin: 0; color: var(--primary-green);"><i class="fas fa-user"></i> ${c.name}</h3>
                    <span style="font-size: 12px; color: var(--text-muted);">${c.phone || ''}</span>
                    ${addressText}
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
function addToCart(productId) {
    let product = db.products.find(p => p.id == productId);
    let existing = db.cart.find(c => c.id == productId);
    if(existing) { existing.qty++; } else { db.cart.push({ ...product, qty: 1 }); }
    saveLocal();
    updateCartUI();
    renderProducts();
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
                renderProducts();
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
                    <button onclick="changeQty(${index}, -0.5)">-</button>
                    <span onclick="editQtyById(${item.id})" style="cursor: pointer; border-bottom: 1px dashed var(--primary-green); padding: 0 5px;">${item.qty}</span>
                    <button onclick="changeQty(${index}, 0.5)">+</button>
                    <i class="fas fa-trash" style="color: #ff4d4d; margin-right: 10px; cursor: pointer; font-size: 18px;" onclick="removeFromCart(${index})"></i>
                </div>
            </div>`;
    });
    
    container.innerHTML = cartHtml;
    renderProducts();
}

function changeQty(index, change) { db.cart[index].qty += change; if(db.cart[index].qty <= 0) db.cart.splice(index, 1); saveLocal(); updateCartUI(); renderProducts(); }
function removeFromCart(index) { db.cart.splice(index, 1); saveLocal(); updateCartUI(); renderProducts(); }
function editPrice(index) {
    customPrompt("أدخل السعر الجديد لـ " + db.cart[index].name + ":", db.cart[index].price, function(newPrice) {
        let parsedPrice = parseArabicLocaleNumber(newPrice);
        if(!isNaN(parsedPrice) && parsedPrice >= 0) { 
            db.cart[index].price = parsedPrice; 
            saveLocal(); 
            updateCartUI(); 
            renderProducts();
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

function saveOrderAndShowDetails() {
    if(db.cart.length === 0) { customAlert("السلة فارغة!"); return; }
    
    let custInput = document.getElementById('cart-customer-input').value.trim();
    let custName = custInput !== "" ? custInput : "زبون نقدي";
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
    if (editingInvoiceId) {
        let existingIndex = db.invoices.findIndex(i => i.id === editingInvoiceId);
        if (existingIndex !== -1) {
            order = db.invoices[existingIndex];
            order.customer = custName;
            order.phone = custPhone;
            order.status = status;
            order.statusColor = statusColor;
            order.total = total;
            order.items = [...db.cart];
        } else {
            let orderId = db.invoices.length > 0 ? Math.max(...db.invoices.map(i => parseInt(i.id) || 1000)) + 1 : 1000;
            order = { id: orderId, customer: custName, phone: custPhone, date: dateString, time: timeString, status: status, statusColor: statusColor, total: total, items: [...db.cart] };
            db.invoices.push(order);
        }
        editingInvoiceId = null;
    } else {
        let orderId = db.invoices.length > 0 ? Math.max(...db.invoices.map(i => parseInt(i.id) || 1000)) + 1 : 1000;
        order = { id: orderId, customer: custName, phone: custPhone, date: dateString, time: timeString, status: status, statusColor: statusColor, total: total, items: [...db.cart] };
        db.invoices.push(order);
    }
    
    db.cart = []; saveLocal(); updateCartUI(); 
    document.getElementById('cart-customer-input').value = '';
    closeModal('cartModal');
    showOrderDetails(order);
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
        itemsHtml += `<div class="order-item-row"><span>${item.name} ${item.note ? `<span style="font-size:11px; color:var(--primary-green);">(${item.note})</span>` : ''} <span style="color:var(--text-muted); font-size:11px;">x${item.qty}</span></span><span>${itemTotal.toLocaleString()} د.ع</span></div>`;
    });
    document.getElementById('od-items-list').innerHTML = itemsHtml;

    document.getElementById('btn-export-pdf').onclick = () => { triggerFlip(document.getElementById('btn-export-pdf'), () => exportToPDF(order)); };
    document.getElementById('btn-share-wa').onclick = () => { triggerFlip(document.getElementById('btn-share-wa'), () => shareWhatsApp(order)); };
    document.getElementById('btn-delete-order').onclick = () => { triggerFlip(document.getElementById('btn-delete-order'), () => { db.invoices = db.invoices.filter(i => i.id != order.id); saveLocal(); closeModal('orderDetailsModal'); customAlert('تم حذف الطلب نهائياً!'); }); };

    openModal('orderDetailsModal');
}

function exportToPDF(order) {
    let printWindow = window.open('', '_blank'); let itemsRows = "";
    order.items.forEach((item, i) => { itemsRows += `<tr><td style="border:1px solid #ddd; padding:8px;">${i+1}</td><td style="border:1px solid #ddd; padding:8px;">${item.name}${item.note ? `<br><span style="font-size:11px; color:#555;">${item.note}</span>` : ''}</td><td style="border:1px solid #ddd; padding:8px;">${item.qty}</td><td style="border:1px solid #ddd; padding:8px;">${item.price.toLocaleString()}</td><td style="border:1px solid #ddd; padding:8px;">${(item.price * item.qty).toLocaleString()}</td></tr>`; });

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
    order.items.forEach((item, i) => { text += `${i+1}. ${item.name}${item.note ? ` (${item.note})` : ''} - العدد: ${item.qty} - السعر: ${(item.price * item.qty).toLocaleString()} د.ع\n`; });
    text += `\n*الإجمالي الكلي: ${order.total.toLocaleString()} د.ع*\nحالة الدفع: ${order.status}`;
    let url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    if(order.phone) url = `https://api.whatsapp.com/send?phone=${order.phone.replace(/^0/, '+964')}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

function deleteInvoice(invoiceId) {
    let inv = db.invoices.find(i => i.id == invoiceId);
    if (!inv) return;
    
    customPrompt("هل أنت متأكد من حذف هذه الفاتورة؟ (نعم/لا)", "لا", function(val) {
        if(val === 'نعم') {
            db.invoices = db.invoices.filter(i => i.id != invoiceId);
            saveLocal();
            // Refresh ledger if open
            if (document.getElementById('customerLedgerModal').style.display === 'flex') {
                openLedger(inv.customer);
            }
            customAlert("تم حذف الفاتورة بنجاح.");
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
let currentPromptCallback = null;
function customPrompt(message, defaultValue, callback) {
    document.getElementById('customPromptMessage').innerText = message; let inputField = document.getElementById('customPromptInput');
    inputField.value = defaultValue || ''; currentPromptCallback = callback; openModal('customPromptModal'); setTimeout(() => inputField.focus(), 100);
}
document.getElementById('promptConfirmBtn').addEventListener('click', function() {
    let val = document.getElementById('customPromptInput').value; closeModal('customPromptModal'); if(currentPromptCallback) currentPromptCallback(val);
});

// التشغيل المبدئي
loadAppDatabase();
