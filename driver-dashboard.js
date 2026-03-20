import { supabase } from './supabase-client.js';

// ── Toast Notification System ──
window.showDashboardToast = function(message, type = 'error') {
    let container = document.getElementById('dashboard-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'dashboard-toast-container';
        container.className = 'dashboard-toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `dashboard-toast ${type}`;
    
    let iconName = 'alert-circle';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';

    toast.innerHTML = `
        <div class="toast-icon"><i data-lucide="${iconName}" style="width: 20px; height: 20px;"></i></div>
        <div class="toast-content">${message}</div>
    `;
    
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ── Product Catalog (same as partner items) ──
const CATALOG_ITEMS = [
    { id: 'tres-leches-half', name: 'Tres Leches (1/2 Sheet)', price: 45.00 },
    { id: 'tres-leches-full', name: 'Tres Leches (Full Sheet)', price: 85.00 },
    { id: 'guava-pastries-flat', name: 'Guava Pastries (Flat/12)', price: 24.00 },
    { id: 'cheese-rolls-flat', name: 'Cheese Rolls (Flat/12)', price: 26.00 },
    { id: 'cuban-bread-dozen', name: 'Cuban Bread (Dozen)', price: 18.00 }
];

let currentUser = null;
let driverPriceOverrides = {};
let customItemCounter = 0;

// ══════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    document.body.style.display = 'none';
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
        console.warn('No active session. Redirecting to home...');
        window.location.href = 'index.html';
        return;
    }

    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, full_name, phone')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || profile.role !== 'driver') {
            console.error('Access Denied: User is not a driver.');
            window.location.href = 'index.html';
            return;
        }

        currentUser = { ...user, ...profile };
        document.body.style.display = 'block';
        console.log('Driver access granted.');
        
        // Load driver-specific price overrides
        await loadPriceOverrides();
        
        setupTabs();
        setupSignOut();
        setupAccount();
        renderCatalog();
        setupCustomItems();
        setupOrderSubmission();
        setupOrderDetailModal();
        
        fetchMyOrders();

    } catch (err) {
        console.error('Error during driver verification:', err);
        window.location.href = 'index.html';
    }
});

// ══════════════════════════════════════════════════════════
// PRICE OVERRIDES
// ══════════════════════════════════════════════════════════
async function loadPriceOverrides() {
    try {
        const { data, error } = await supabase
            .from('driver_price_overrides')
            .select('item_id, custom_price')
            .eq('driver_id', currentUser.id);
        
        if (!error && data) {
            data.forEach(override => {
                driverPriceOverrides[override.item_id] = parseFloat(override.custom_price);
            });
        }
    } catch (err) {
        console.warn('Could not load price overrides:', err);
    }
}

function getItemPrice(itemId, defaultPrice) {
    return driverPriceOverrides[itemId] !== undefined ? driverPriceOverrides[itemId] : defaultPrice;
}

// ══════════════════════════════════════════════════════════
// CATALOG RENDERING
// ══════════════════════════════════════════════════════════
function renderCatalog() {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    CATALOG_ITEMS.forEach(item => {
        const price = getItemPrice(item.id, item.price);
        const card = document.createElement('div');
        card.className = 'catalog-item';
        card.innerHTML = `
            <div class="catalog-item-name">${item.name}</div>
            <div class="catalog-item-price">$${price.toFixed(2)} each</div>
            <div class="qty-row">
                <button type="button" class="qty-btn" onclick="window.updateCatalogQty('${item.id}', -1)">−</button>
                <input type="number" class="qty-input" id="cat-qty-${item.id}" value="0" min="0" max="999" readonly>
                <button type="button" class="qty-btn" onclick="window.updateCatalogQty('${item.id}', 1)">+</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.updateCatalogQty = function(itemId, change) {
    const input = document.getElementById(`cat-qty-${itemId}`);
    if (!input) return;
    let val = parseInt(input.value) || 0;
    val += change;
    if (val < 0) val = 0;
    if (val > 999) val = 999;
    input.value = val;
    calculateTotal();
};

function calculateTotal() {
    let total = 0;
    CATALOG_ITEMS.forEach(item => {
        const input = document.getElementById(`cat-qty-${item.id}`);
        const qty = input ? parseInt(input.value) || 0 : 0;
        const price = getItemPrice(item.id, item.price);
        total += qty * price;
    });
    
    const totalEl = document.getElementById('order-total');
    if (totalEl) totalEl.textContent = '$' + total.toFixed(2);
    return total;
}

// ══════════════════════════════════════════════════════════
// CUSTOM ITEMS
// ══════════════════════════════════════════════════════════
function setupCustomItems() {
    const addBtn = document.getElementById('add-custom-item-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => addCustomItemRow());
    }
}

function addCustomItemRow() {
    customItemCounter++;
    const container = document.getElementById('custom-items-list');
    if (!container) return;
    
    const row = document.createElement('div');
    row.className = 'custom-item-row';
    row.id = `custom-row-${customItemCounter}`;
    row.innerHTML = `
        <input type="text" placeholder="Item name (e.g., Plain Cake)" class="custom-item-name">
        <input type="number" class="qty-input custom-item-qty" value="1" min="1" max="999" style="width: 60px;">
        <button type="button" class="remove-custom-btn" onclick="window.removeCustomItem(${customItemCounter})">
            <i data-lucide="x" class="icon" style="width: 16px; height: 16px;"></i>
        </button>
    `;
    container.appendChild(row);
    if (window.lucide) window.lucide.createIcons();
}

window.removeCustomItem = function(id) {
    const row = document.getElementById(`custom-row-${id}`);
    if (row) row.remove();
};

function getCustomItems() {
    const rows = document.querySelectorAll('.custom-item-row');
    const items = [];
    rows.forEach(row => {
        const name = row.querySelector('.custom-item-name')?.value?.trim();
        const qty = parseInt(row.querySelector('.custom-item-qty')?.value) || 1;
        if (name) {
            items.push({ name, quantity: qty, unit_price: null });
        }
    });
    return items;
}

// ══════════════════════════════════════════════════════════
// ORDER SUBMISSION
// ══════════════════════════════════════════════════════════
function setupOrderSubmission() {
    const submitBtn = document.getElementById('submit-order-btn');
    if (!submitBtn) return;
    
    submitBtn.addEventListener('click', async () => {
        // Gather catalog items with qty > 0
        const catalogItems = [];
        CATALOG_ITEMS.forEach(item => {
            const input = document.getElementById(`cat-qty-${item.id}`);
            const qty = input ? parseInt(input.value) || 0 : 0;
            if (qty > 0) {
                const price = getItemPrice(item.id, item.price);
                catalogItems.push({
                    id: item.id,
                    name: item.name,
                    quantity: qty,
                    unit_price: price
                });
            }
        });
        
        const customItems = getCustomItems();
        
        if (catalogItems.length === 0 && customItems.length === 0) {
            window.showDashboardToast('Please add at least one item to your order.', 'warning');
            return;
        }
        
        const totalAmount = calculateTotal();
        const notes = document.getElementById('order-notes')?.value || '';
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        
        try {
            const { error } = await supabase
                .from('driver_orders')
                .insert({
                    driver_id: currentUser.id,
                    items: catalogItems,
                    custom_items: customItems,
                    total_amount: totalAmount,
                    status: 'pending',
                    notes: notes
                });
            
            if (error) throw error;
            
            window.showDashboardToast('Order submitted successfully! Awaiting admin approval.', 'success');
            
            // Reset form
            CATALOG_ITEMS.forEach(item => {
                const input = document.getElementById(`cat-qty-${item.id}`);
                if (input) input.value = 0;
            });
            document.getElementById('custom-items-list').innerHTML = '';
            document.getElementById('order-notes').value = '';
            calculateTotal();
            
            // Switch to My Orders tab
            document.querySelector('.sidebar-nav .sidebar-link[href="#myorders"]')?.click();
            
        } catch (err) {
            console.error('Error submitting order:', err);
            window.showDashboardToast('Failed to submit order. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Order';
        }
    });
}

// ══════════════════════════════════════════════════════════
// MY ORDERS — Fetch & Render
// ══════════════════════════════════════════════════════════
async function fetchMyOrders() {
    const tbody = document.getElementById('my-orders-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--tx-muted); padding: 40px;">Loading orders...</td></tr>';
    
    try {
        const { data, error } = await supabase
            .from('driver_orders')
            .select('*')
            .eq('driver_id', currentUser.id)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 40px;">
                        <div style="display: flex; flex-direction: column; align-items: center; color: var(--tx-muted);">
                            <i data-lucide="clipboard-list" class="icon" style="width: 40px; height: 40px; margin-bottom: 12px; opacity: 0.4;"></i>
                            <span style="font-weight: 500;" data-en="No orders yet. Place your first order!" data-es="Sin pedidos aún. ¡Haz tu primer pedido!">No orders yet. Place your first order!</span>
                        </div>
                    </td>
                </tr>`;
            if (window.lucide) window.lucide.createIcons();
            return;
        }
        
        tbody.innerHTML = '';
        data.forEach(order => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => openOrderDetail(order));
            
            const shortId = order.id.split('-')[0].toUpperCase();
            const date = new Date(order.created_at).toLocaleDateString();
            const { color, bg, label } = getStatusStyle(order.status);
            
            const catalogCount = Array.isArray(order.items) ? order.items.reduce((s, i) => s + (i.quantity || 0), 0) : 0;
            const customCount = Array.isArray(order.custom_items) ? order.custom_items.reduce((s, i) => s + (i.quantity || 0), 0) : 0;
            const totalItems = catalogCount + customCount;
            
            const total = parseFloat(order.total_amount) || 0;
            const hasPendingPricing = Array.isArray(order.custom_items) && order.custom_items.some(i => i.unit_price === null);
            
            tr.innerHTML = `
                <td><strong>#${shortId}</strong></td>
                <td>${date}</td>
                <td>${totalItems} items${hasPendingPricing ? ' *' : ''}</td>
                <td>${hasPendingPricing && order.status === 'pending' ? '<em style="color: var(--tx-muted);">TBD</em>' : '<strong>$' + total.toFixed(2) + '</strong>'}</td>
                <td><span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color};">${label}</span></td>
            `;
            tbody.appendChild(tr);
        });
        
        if (window.lucide) window.lucide.createIcons();
        
    } catch (err) {
        console.error('Error fetching orders:', err);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--red); padding: 40px;">Error loading orders.</td></tr>';
    }
}

function getStatusStyle(status) {
    const map = {
        pending:           { color: '#F2994A', bg: 'rgba(242, 153, 74, 0.15)', label: 'Pending' },
        approved:          { color: 'var(--icon-blue, #A6CEFF)', bg: 'rgba(166, 206, 255, 0.15)', label: 'Approved' },
        in_progress:       { color: '#E2A93B', bg: 'rgba(226, 169, 59, 0.15)', label: 'In Progress' },
        ready_for_pickup:  { color: '#1B5E20', bg: 'rgba(27, 94, 32, 0.15)', label: 'Ready for Pickup' },
        picked_up:         { color: '#6B5057', bg: 'rgba(107, 80, 87, 0.15)', label: 'Picked Up' },
        rejected:          { color: 'var(--red)', bg: 'rgba(200, 16, 46, 0.15)', label: 'Rejected' }
    };
    return map[status] || map.pending;
}

// ══════════════════════════════════════════════════════════
// ORDER DETAIL MODAL
// ══════════════════════════════════════════════════════════
function setupOrderDetailModal() {
    const closeBtn = document.getElementById('close-order-detail-btn');
    const overlay = document.getElementById('order-detail-modal-overlay');
    
    if (closeBtn) closeBtn.addEventListener('click', () => overlay?.classList.remove('open'));
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
}

function openOrderDetail(order) {
    const overlay = document.getElementById('order-detail-modal-overlay');
    const body = document.getElementById('order-detail-body');
    if (!overlay || !body) return;
    
    const shortId = order.id.split('-')[0].toUpperCase();
    const { color, bg, label } = getStatusStyle(order.status);
    const date = new Date(order.created_at).toLocaleString();
    const total = parseFloat(order.total_amount) || 0;
    
    let itemsHtml = '';
    if (Array.isArray(order.items) && order.items.length > 0) {
        itemsHtml += '<div style="margin-bottom: 16px;"><strong style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--tx-muted);">Catalog Items</strong><ul style="list-style: none; padding: 0; margin: 8px 0 0;">';
        order.items.forEach(item => {
            const price = item.unit_price ? `$${parseFloat(item.unit_price).toFixed(2)}` : 'TBD';
            itemsHtml += `<li style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--bd);"><span>${item.name} × ${item.quantity}</span><span style="font-weight: 600;">${price}</span></li>`;
        });
        itemsHtml += '</ul></div>';
    }
    
    if (Array.isArray(order.custom_items) && order.custom_items.length > 0) {
        itemsHtml += '<div style="margin-bottom: 16px;"><strong style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--tx-muted);">Custom / Special Items</strong><ul style="list-style: none; padding: 0; margin: 8px 0 0;">';
        order.custom_items.forEach(item => {
            const price = item.unit_price !== null ? `$${parseFloat(item.unit_price).toFixed(2)}` : '<em style="color: var(--tx-muted);">Price pending</em>';
            itemsHtml += `<li style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--bd);"><span>${item.name} × ${item.quantity}</span><span style="font-weight: 600;">${price}</span></li>`;
        });
        itemsHtml += '</ul></div>';
    }
    
    body.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div>
                <div style="font-weight: 600; font-size: 1.1rem;">Order #${shortId}</div>
                <div style="font-size: 0.85rem; color: var(--tx-muted);">${date}</div>
            </div>
            <span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color};">${label}</span>
        </div>
        
        ${itemsHtml}
        
        ${order.notes ? `<div style="background: var(--bg-body, var(--bg)); padding: 12px; border-radius: 8px; border: 1px solid var(--bd); margin-bottom: 12px;"><strong style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--tx-muted); display: block; margin-bottom: 4px;">Your Notes</strong><span style="font-size: 0.9rem;">${order.notes}</span></div>` : ''}
        
        ${order.admin_notes ? `<div style="background: var(--bg-body, var(--bg)); padding: 12px; border-radius: 8px; border: 1px solid var(--bd); margin-bottom: 12px;"><strong style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--tx-muted); display: block; margin-bottom: 4px;">Admin Notes</strong><span style="font-size: 0.9rem;">${order.admin_notes}</span></div>` : ''}
        
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--bd);">
            <span style="font-size: 0.85rem; color: var(--tx-muted);">Total</span>
            <span style="font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; font-weight: 700;">$${total.toFixed(2)}</span>
        </div>
    `;
    
    overlay.classList.add('open');
}

// ══════════════════════════════════════════════════════════
// ACCOUNT & SETTINGS
// ══════════════════════════════════════════════════════════
function setupAccount() {
    // Populate profile fields
    const nameField = document.getElementById('profile-name');
    const phoneField = document.getElementById('profile-phone');
    const emailField = document.getElementById('profile-email');
    
    if (nameField) nameField.value = currentUser.full_name || '';
    if (phoneField) phoneField.value = currentUser.phone || '';
    if (emailField) emailField.value = currentUser.email || '';
    
    // Save profile
    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const msg = document.getElementById('profile-msg');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            
            try {
                const { error } = await supabase
                    .from('profiles')
                    .update({
                        full_name: nameField.value,
                        phone: phoneField.value
                    })
                    .eq('id', currentUser.id);
                
                if (error) throw error;
                
                msg.textContent = 'Profile updated!';
                msg.style.color = 'green';
                currentUser.full_name = nameField.value;
                currentUser.phone = phoneField.value;
            } catch (err) {
                msg.textContent = 'Failed to update profile.';
                msg.style.color = 'var(--red)';
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Changes';
                setTimeout(() => { msg.textContent = ''; }, 3000);
            }
        });
    }
    
    // Password change
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPwd = document.getElementById('settings-current-pwd').value;
            const pwd = document.getElementById('settings-new-pwd').value;
            const conf = document.getElementById('settings-conf-pwd').value;
            const msg = document.getElementById('settings-msg');
            const btn = document.getElementById('settings-btn');
            
            if (pwd !== conf) {
                msg.textContent = 'Passwords do not match.';
                msg.style.color = 'var(--red)';
                return;
            }
            
            btn.disabled = true;
            btn.textContent = 'Verifying...';
            
            try {
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: currentUser.email,
                    password: currentPwd
                });
                
                if (signInError) throw new Error('Current password is incorrect.');
                
                btn.textContent = 'Updating...';
                const { error: updateError } = await supabase.auth.updateUser({ password: pwd });
                if (updateError) throw updateError;
                
                msg.textContent = 'Password updated successfully!';
                msg.style.color = 'green';
                settingsForm.reset();
            } catch (err) {
                msg.textContent = err.message || 'Error updating password.';
                msg.style.color = 'var(--red)';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Update Password';
            }
        });
    }
}

// ══════════════════════════════════════════════════════════
// NAVIGATION & SIDEBAR
// ══════════════════════════════════════════════════════════
function setupTabs() {
    const links = document.querySelectorAll('.sidebar-nav .sidebar-link');
    const panes = document.querySelectorAll('.tab-pane');

    links.forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href').replace('#', '');
            if (!link.getAttribute('href').startsWith('#')) return;
            
            e.preventDefault();

            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            panes.forEach(pane => {
                pane.classList.remove('active');
                if (pane.id === 'sec-' + targetId) {
                    pane.classList.add('active');
                }
            });

            if (targetId === 'myorders') {
                fetchMyOrders();
            }
        });
    });
    
    // Refresh button
    const refreshBtn = document.getElementById('refresh-orders-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="icon" style="width: 14px; height: 14px; animation: spin 1s linear infinite;"></i> Refreshing...';
            fetchMyOrders().then(() => {
                refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="icon" style="width: 14px; height: 14px;"></i> Refresh';
                if (window.lucide) window.lucide.createIcons();
            });
        });
    }
}

function setupSignOut() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('#nav-sign-out-btn') || e.target.closest('#mobile-sign-out-btn');
        if (btn) {
            e.preventDefault();
            const { error } = await supabase.auth.signOut();
            if (!error) {
                window.location.href = 'index.html';
            }
        }
    });

    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'index.html';
        }
    });
}
