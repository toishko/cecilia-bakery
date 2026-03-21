import { supabase, getOrderTotal } from './supabase-client.js';
import { initIdleTimeout } from './idle-timeout.js';
import { initNotificationUI, playSound, showBrowserNotification as showBrowserNotif, addToHistory, startTitleBlink } from './notification-utils.js';
initIdleTimeout(20 * 60 * 1000);

let currentUser = null;
let currentProfile = null;
let allOrders = [];

// ── Relative Time Helper ─────────────────────────────────────
function timeAgo(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    return d.toLocaleDateString();
}

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
        console.warn('No active session. Redirecting to home...');
        window.location.href = 'index.html';
        return;
    }

    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || profile.role !== 'customer') {
            console.error('Access Denied: User is not a customer.');
            window.location.href = 'index.html';
            return;
        }

        currentUser = user;
        currentProfile = profile;
        
        document.getElementById('auth-loading-overlay')?.remove();
        console.log('Customer access granted.');
        
        showSkeletonLoading();
        renderWelcome();
        await fetchOrders();
        setupRealtimeOrders();
        setupProfileForm();
        setupSignOut();
        fetchAddresses();
        setupMobileDrawer();
        setupReceiptModal();
        setupKeyboardAccessibility();
        
    } catch (err) {
        console.error('Error during customer verification:', err);
        window.location.href = 'index.html';
    }
});

// ── Skeleton Loading ──────────────────────────────────────────

function showSkeletonLoading() {
    document.querySelectorAll('.stat-value').forEach(el => {
        el.classList.add('skeleton');
        el.dataset.originalText = el.textContent;
        el.innerHTML = '&nbsp;';
    });
}

function hideSkeletonLoading() {
    document.querySelectorAll('.stat-value.skeleton').forEach(el => {
        el.classList.remove('skeleton');
    });
}

// ── Welcome & Stats ──────────────────────────────────────────

function renderWelcome() {
    const firstName = (currentProfile.full_name || '').split(' ')[0] || 'Friend';
    document.getElementById('welcome-name').textContent = firstName;
    document.getElementById('account-email').textContent = currentUser.email;
    
    const memberDate = new Date(currentProfile.created_at);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    document.getElementById('stat-member-since').textContent = `${monthNames[memberDate.getMonth()]} ${memberDate.getFullYear()}`;
}

function renderStats(orders) {
    hideSkeletonLoading();
    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum, o) => sum + getOrderTotal(o), 0);
    
    document.getElementById('stat-total-orders').textContent = totalOrders;
    document.getElementById('stat-total-spent').textContent = '$' + totalSpent.toFixed(2);
    
    // Find most ordered item
    const itemCounts = {};
    orders.forEach(o => {
        if (!Array.isArray(o.items)) return;
        o.items.forEach(item => {
            const name = item.name || 'Unknown';
            const qty = item.qty || item.quantity || 1;
            itemCounts[name] = (itemCounts[name] || 0) + qty;
        });
    });
    
    const sorted = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
        document.getElementById('stat-fav-item').textContent = sorted[0][0];
    }
}

// ── Orders ───────────────────────────────────────────────────

async function fetchOrders() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('profile_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        allOrders = data || [];
        
        renderStats(allOrders);
        
        const activeOrders = allOrders.filter(o => o.delivery_status !== 'delivered' && o.delivery_status !== 'cancelled');
        const pastOrders = allOrders.filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'cancelled');
        
        renderActiveOrders(activeOrders);
        renderPastOrders(pastOrders);
        renderMostOrdered(allOrders);
        
    } catch (err) {
        console.error('Error fetching orders:', err);
    }
}

// ── Active Orders with Timeline ──

function renderActiveOrders(orders) {
    const container = document.getElementById('active-orders-container');
    const badge = document.getElementById('active-count-badge');
    
    if (orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <p data-en="No active orders right now" data-es="No hay pedidos activos ahora">No active orders right now</p>
                <p class="sub" data-en="When you place an order, you'll be able to track it here" data-es="Cuando hagas un pedido, podrás rastrearlo aquí">When you place an order, you'll be able to track it here</p>
            </div>`;
        badge.style.display = 'none';
        return;
    }
    
    badge.textContent = orders.length;
    badge.style.display = 'inline-block';
    
    container.innerHTML = orders.map(order => {
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const orderDate = timeAgo(order.created_at);
        const items = Array.isArray(order.items) ? order.items : [];
        const total = getOrderTotal(order);
        const itemCount = Array.isArray(order.items) ? order.items.reduce((s, i) => s + (i.qty || i.quantity || 1), 0) : 0;
        const ds = order.delivery_status || 'pending';
        
        const steps = ['pending', 'baking', 'ready_for_pickup', 'delivered'];
        const stepLabels = ['Placed', 'Baking', 'Ready for Pickup', 'Picked Up'];
        const stepIcons = ['📝', '🧁', '✅', '🛍️'];
        const currentIdx = steps.indexOf(ds);
        
        const timeline = steps.map((step, i) => {
            let cls = '';
            if (i < currentIdx) cls = 'completed';
            else if (i === currentIdx) cls = 'active';
            return `
                <div class="timeline-step ${cls}">
                    <div class="timeline-dot"></div>
                    <span class="timeline-label">${stepLabels[i]}</span>
                </div>`;
        }).join('');

        // ETA display
        let etaHtml = '';
        if (order.estimated_pickup_at && ds !== 'delivered' && ds !== 'cancelled') {
            const etaDate = new Date(order.estimated_pickup_at);
            const etaTime = etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const now = new Date();
            const diffMs = etaDate - now;
            const diffMins = Math.round(diffMs / 60000);
            
            let etaLabel = `Est. ready by ${etaTime}`;
            if (diffMins > 0 && diffMins <= 120) {
                etaLabel += ` (~${diffMins} min)`;
            } else if (diffMins <= 0) {
                etaLabel = `Should be ready now!`;
            }
            
            etaHtml = `
                <div style="
                    display: flex; align-items: center; gap: 6px; padding: 8px 14px;
                    background: rgba(212, 168, 83, 0.1); border: 1px solid rgba(212, 168, 83, 0.25);
                    border-radius: 10px; margin-bottom: 4px;
                    font-size: 0.85rem; color: var(--brand-gold, #d4a853); font-weight: 500;
                ">
                    <span>⏱️</span> ${etaLabel}
                </div>`;
        }
        
        return `
            <div class="active-order-card" style="cursor:pointer;" onclick="showOrderReceipt('${order.id}')">
                <div class="order-card-header">
                    <div>
                        <div class="order-card-id">#${shortId}</div>
                    </div>
                    <div class="order-card-meta">
                        <span>${itemCount} items · $${total.toFixed(2)}</span>
                        <span>${orderDate}</span>
                    </div>
                </div>
                ${etaHtml}
                <div class="status-timeline">${timeline}</div>
            </div>`;
    }).join('');
}

// ── Most Ordered ──

const ITEM_EMOJIS = {
    'Tres Leches': '🍰', 'Tres Leche Piña': '🍍', 'Tres Leche Strawberry': '🍓',
    'Tres Leche Hershey': '🍫', 'Cuatro Leche': '🥛', 'Piña': '🍍',
    'Guava': '🍈', 'Dulce de Leche': '🍮', 'Chocolate': '🍫',
    'Strawberry': '🍓', 'Pudin': '🍞', 'Plain': '🎂', 'Raisin': '🍇',
    'Maiz': '🌽', 'Red Velvet': '❤️', 'Carrot Cake': '🥕',
    'Cheesecake': '🧀', 'Chocoflan': '🍮',
};

function renderMostOrdered(orders) {
    const itemCounts = {};
    const itemDetails = {};
    
    orders.forEach(o => {
        if (!Array.isArray(o.items)) return;
        o.items.forEach(item => {
            const name = item.name || 'Unknown';
            const qty = item.qty || item.quantity || 1;
            itemCounts[name] = (itemCounts[name] || 0) + qty;
            if (!itemDetails[name]) {
                itemDetails[name] = { price: item.price, tag: item.tag, size: item.size };
            }
        });
    });
    
    const sorted = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const grid = document.getElementById('most-ordered-grid');
    
    if (sorted.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">🍰</div>
                <p data-en="No order history yet" data-es="Aún no hay historial de pedidos">No order history yet</p>
                <p class="sub" data-en="Your most ordered items will appear here" data-es="Tus artículos más pedidos aparecerán aquí">Your most ordered items will appear here</p>
            </div>`;
        return;
    }
    
    grid.innerHTML = sorted.map(([name, count]) => {
        const emoji = ITEM_EMOJIS[name] || '🎂';
        const detail = itemDetails[name] || {};
        return `
            <div class="most-ordered-card">
                <div class="most-ordered-emoji">${emoji}</div>
                <div class="most-ordered-name">${name}</div>
                <div class="most-ordered-count">Ordered ${count}×</div>
                <button class="most-ordered-btn" onclick="orderAgainItem('${name.replace(/'/g, "\\'")}')">Order Again</button>
            </div>`;
    }).join('');
}

// ── Past Orders (Collapsible) ──

function renderPastOrders(orders) {
    const container = document.getElementById('past-orders-container');
    const badge = document.getElementById('past-count-badge');
    
    if (orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p data-en="No past orders yet" data-es="Aún no hay pedidos pasados">No past orders yet</p>
            </div>`;
        badge.style.display = 'none';
        return;
    }
    
    badge.textContent = orders.length;
    badge.style.display = 'inline-block';
    
    container.innerHTML = orders.map(order => {
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const orderDate = timeAgo(order.created_at);
        const orderItems = Array.isArray(order.items) ? order.items : [];
        const total = getOrderTotal(order);
        const ds = order.delivery_status || 'delivered';
        
        const statusStyles = {
            delivered: { color: '#1B5E20', bg: 'rgba(27, 94, 32, 0.12)', text: 'Delivered' },
            cancelled: { color: '#C8102E', bg: 'rgba(200, 16, 46, 0.12)', text: 'Cancelled' },
        };
        const sInfo = statusStyles[ds] || statusStyles.delivered;
        
        const items = Array.isArray(order.items) ? order.items : [];
        const itemRows = items.map(item => {
            const qty = item.qty || item.quantity || 1;
            const price = parseFloat(item.price) || 0;
            const sizeLabel = item.size ? ` (${item.size})` : '';
            return `<tr>
                <td>${item.name || 'Item'}${sizeLabel}</td>
                <td style="text-align:center;">${qty}</td>
                <td style="text-align:right;">$${(price * qty).toFixed(2)}</td>
            </tr>`;
        }).join('');
        
        return `
            <div class="past-order-card" data-order-id="${order.id}">
                <div class="past-order-summary" onclick="togglePastOrder(this)">
                    <div class="past-order-left">
                        <span class="past-order-id">#${shortId}</span>
                        <span class="past-order-date">${orderDate}</span>
                    </div>
                    <div class="past-order-right">
                        <span class="past-order-badge" style="background:${sInfo.bg};color:${sInfo.color};border:1px solid ${sInfo.color};">${sInfo.text}</span>
                        <span class="past-order-total">$${total.toFixed(2)}</span>
                        <svg class="past-order-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                </div>
                <div class="past-order-details">
                    <table class="order-items-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th style="text-align:center;">Qty</th>
                                <th style="text-align:right;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>${itemRows || '<tr><td colspan="3" style="text-align:center;color:var(--tx-muted);">No item details available</td></tr>'}</tbody>
                    </table>
                    <button class="order-reorder-btn" onclick="orderAgainAll('${order.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        Order Again
                    </button>
                </div>
            </div>`;
    }).join('');
}

// ── Toggle Past Order ──

window.togglePastOrder = function(el) {
    const card = el.closest('.past-order-card');
    card.classList.toggle('expanded');
};

// ── Order Again Functions ──

window.orderAgainItem = function(itemName) {
    // Look through all orders to find this item's details
    let itemData = null;
    for (const order of allOrders) {
        if (!Array.isArray(order.items)) continue;
        const found = order.items.find(i => i.name === itemName);
        if (found) { itemData = found; break; }
    }
    
    if (!itemData) {
        showToast('Could not find item details.', true);
        return;
    }
    
    // Add to cecilia_cart localStorage format
    const cart = JSON.parse(localStorage.getItem('cecilia_cart') || '[]');
    
    // Check if item already in cart
    const existing = cart.find(c => c.name === itemData.name && c.size === (itemData.size || null));
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({
            name: itemData.name,
            nameEn: itemData.nameEn || itemData.name,
            nameEs: itemData.nameEs || itemData.name,
            tag: itemData.tag || '',
            tagEn: itemData.tagEn || itemData.tag || '',
            tagEs: itemData.tagEs || itemData.tag || '',
            key: itemData.key || itemData.name,
            size: itemData.size || null,
            sizeDisplay: itemData.sizeDisplay || itemData.size || null,
            qty: 1,
            price: itemData.price || null,
            img: itemData.img || null,
        });
    }
    
    localStorage.setItem('cecilia_cart', JSON.stringify(cart));
    showToast(`${itemData.name} added to cart!`);
    
    // Small delay then redirect to menu
    setTimeout(() => {
        window.location.href = 'menu.html';
    }, 800);
};

window.orderAgainAll = function(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order || !Array.isArray(order.items)) {
        showToast('Could not find order details.', true);
        return;
    }
    
    const cart = JSON.parse(localStorage.getItem('cecilia_cart') || '[]');
    
    order.items.forEach(item => {
        const existing = cart.find(c => c.name === item.name && c.size === (item.size || null));
        if (existing) {
            existing.qty += (item.qty || item.quantity || 1);
        } else {
            cart.push({
                name: item.name,
                nameEn: item.nameEn || item.name,
                nameEs: item.nameEs || item.name,
                tag: item.tag || '',
                tagEn: item.tagEn || item.tag || '',
                tagEs: item.tagEs || item.tag || '',
                key: item.key || item.name,
                size: item.size || null,
                sizeDisplay: item.sizeDisplay || item.size || null,
                qty: item.qty || item.quantity || 1,
                price: item.price || null,
                img: item.img || null,
            });
        }
    });
    
    localStorage.setItem('cecilia_cart', JSON.stringify(cart));
    showToast('All items added to cart!');
    
    setTimeout(() => {
        window.location.href = 'menu.html';
    }, 800);
};

// ── Saved Addresses (Supabase) ──

let addressesCache = [];

async function fetchAddresses() {
    try {
        const { data, error } = await supabase
            .from('addresses')
            .select('*')
            .eq('profile_id', currentUser.id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        addressesCache = data || [];

        // One-time migration from localStorage
        const localRaw = localStorage.getItem('cecilia_addresses');
        if (localRaw && addressesCache.length === 0) {
            try {
                const localAddrs = JSON.parse(localRaw);
                if (Array.isArray(localAddrs) && localAddrs.length > 0) {
                    const rows = localAddrs.map(a => ({
                        profile_id: currentUser.id,
                        label: a.label || 'Address',
                        street: a.street || '',
                        city: a.city || ''
                    }));
                    const { error: insertErr } = await supabase.from('addresses').insert(rows);
                    if (!insertErr) {
                        localStorage.removeItem('cecilia_addresses');
                        return fetchAddresses(); // re-fetch after migration
                    }
                }
            } catch { /* ignore parse errors */ }
        }

        renderAddresses();
    } catch (err) {
        console.error('Error fetching addresses:', err);
    }
}

function renderAddresses() {
    const grid = document.getElementById('address-grid');
    
    let html = addressesCache.map((addr) => `
        <div class="address-card">
            <div class="address-card-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                ${addr.label || 'Address'}
            </div>
            <div class="address-card-text">${addr.street || ''}<br>${addr.city || ''}</div>
            <div class="address-card-actions">
                <button class="address-action-btn" onclick="editAddress('${addr.id}')">Edit</button>
                <button class="address-action-btn delete" onclick="deleteAddress('${addr.id}')">Delete</button>
            </div>
        </div>
    `).join('');
    
    html += `
        <button class="add-address-card" onclick="openAddressModal()">
            <span class="plus-icon">+</span>
            <span data-en="Add Address" data-es="Agregar Dirección">Add Address</span>
        </button>
    `;
    
    grid.innerHTML = html;
}

let editingAddressId = null;

window.openAddressModal = function(id) {
    editingAddressId = id || null;
    const overlay = document.getElementById('address-modal-overlay');
    
    if (editingAddressId) {
        const addr = addressesCache.find(a => a.id === editingAddressId);
        if (addr) {
            document.getElementById('addr-label').value = addr.label || '';
            document.getElementById('addr-street').value = addr.street || '';
            document.getElementById('addr-city').value = addr.city || '';
        }
        document.getElementById('address-modal-title').textContent = 'Edit Address';
    } else {
        document.getElementById('addr-label').value = '';
        document.getElementById('addr-street').value = '';
        document.getElementById('addr-city').value = '';
        document.getElementById('address-modal-title').textContent = 'Add Address';
    }
    
    overlay.classList.add('open');
};

window.closeAddressModal = function() {
    document.getElementById('address-modal-overlay').classList.remove('open');
    editingAddressId = null;
};

window.saveAddress = async function() {
    const label = document.getElementById('addr-label').value.trim();
    const street = document.getElementById('addr-street').value.trim();
    const city = document.getElementById('addr-city').value.trim();
    
    if (!street) {
        showToast('Please enter a street address.', true);
        return;
    }
    
    const entry = { label: label || 'Address', street, city };
    
    try {
        if (editingAddressId) {
            const { error } = await supabase
                .from('addresses')
                .update(entry)
                .eq('id', editingAddressId);
            if (error) throw error;
        } else {
            entry.profile_id = currentUser.id;
            const { error } = await supabase
                .from('addresses')
                .insert(entry);
            if (error) throw error;
        }
        
        closeAddressModal();
        await fetchAddresses();
        showToast(editingAddressId ? 'Address updated!' : 'Address added!');
    } catch (err) {
        console.error('Error saving address:', err);
        showToast('Failed to save address.', true);
    }
};

window.editAddress = function(id) {
    openAddressModal(id);
};

window.deleteAddress = async function(id) {
    try {
        const { error } = await supabase
            .from('addresses')
            .delete()
            .eq('id', id);
        if (error) throw error;
        await fetchAddresses();
        showToast('Address removed.');
    } catch (err) {
        console.error('Error deleting address:', err);
        showToast('Failed to delete address.', true);
    }
};

// ── Real-Time Order Updates ──

const STATUS_MESSAGES = {
    pending:          { emoji: '📝', text: 'Your order has been placed!' },
    baking:           { emoji: '🧁', text: 'Your order is now being prepared!' },
    ready_for_pickup: { emoji: '🎉', text: 'Your order is ready for pickup!' },
    delivered:        { emoji: '🛍️', text: 'Your order has been picked up!' },
    cancelled:        { emoji: '❌', text: 'Your order has been cancelled.' },
};

let previousStatuses = {};

function setupRealtimeOrders() {
    // Initialize shared notification UI (mute toggle, bell panel)
    initNotificationUI();

    // Snapshot current statuses before any realtime events
    allOrders.forEach(o => {
        if (o.id) previousStatuses[o.id] = o.delivery_status || 'pending';
    });

    supabase.channel('customer-orders')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `profile_id=eq.${currentUser.id}`
        }, async (payload) => {
            console.log('Order update received:', payload);

            if (payload.eventType === 'UPDATE' && payload.new) {
                const orderId = payload.new.id;
                const newStatus = payload.new.delivery_status;
                const oldStatus = previousStatuses[orderId];

                if (oldStatus && newStatus && oldStatus !== newStatus) {
                    const msg = STATUS_MESSAGES[newStatus];
                    if (msg) {
                        const shortId = orderId.split('-')[0].toUpperCase();
                        showToast(`${msg.emoji} #${shortId}: ${msg.text}`);
                        // Use 'alert' for cancellations, 'status' for normal updates
                        const toneType = newStatus === 'cancelled' ? 'alert' : 'status';
                        playSound(toneType);
                        showBrowserNotif('Order Update', `#${shortId}: ${msg.text}`);
                        addToHistory('status', 'Order Update', `#${shortId}: ${msg.text}`);
                        startTitleBlink(`#${shortId}: ${msg.text}`);
                    }
                }
                previousStatuses[orderId] = newStatus;
            } else if (payload.eventType === 'INSERT' && payload.new) {
                previousStatuses[payload.new.id] = payload.new.delivery_status || 'pending';
            }

            await fetchOrders();
        })
        .subscribe();
}

// ── Sign Out ──

function setupSignOut() {
    const btn = document.getElementById('nav-sign-out-btn');
    if (btn) {
        btn.addEventListener('click', async () => {
            const { error } = await supabase.auth.signOut();
            if (!error) window.location.href = 'index.html';
        });
    }

    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'index.html';
        }
    });
}

// ── Profile & Settings Form ──

function setupProfileForm() {
    if (!currentProfile) return;

    document.getElementById('profile-name').value = currentProfile.full_name || '';
    document.getElementById('profile-phone').value = currentProfile.phone || '';

    const profileForm = document.getElementById('profile-form');
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('profile-update-btn');
        const msg = document.getElementById('profile-msg');
        
        btn.disabled = true;
        btn.textContent = 'Updating...';
        
        const updates = {
            full_name: document.getElementById('profile-name').value,
            phone: document.getElementById('profile-phone').value
        };

        try {
            const { error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', currentProfile.id);

            if (error) throw error;
            
            msg.textContent = 'Profile updated successfully!';
            msg.style.color = '#27ae60';
            currentProfile = { ...currentProfile, ...updates };
            
            // Update the welcome name
            const firstName = (updates.full_name || '').split(' ')[0] || 'Friend';
            document.getElementById('welcome-name').textContent = firstName;

        } catch (err) {
            console.error('Error updating profile:', err);
            msg.textContent = 'Failed to update profile.';
            msg.style.color = 'var(--red)';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Update Profile';
            setTimeout(() => { msg.textContent = ''; }, 3000);
        }
    });

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
                msg.style.color = '#27ae60';
                settingsForm.reset();
            } catch (err) {
                console.error('Error updating password:', err);
                msg.textContent = err.message || 'Error updating password.';
                msg.style.color = 'var(--red)';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Change Password';
                setTimeout(() => { msg.textContent = ''; }, 4000);
            }
        });
    }
}

// ── Order Receipt Modal ──

window.showOrderReceipt = function(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const shortId = order.id.split('-')[0].toUpperCase();
    document.getElementById('receipt-title').textContent = `Order #${shortId}`;
    document.getElementById('receipt-date').textContent = new Date(order.created_at).toLocaleString();

    const orderItems = Array.isArray(order.items) ? order.items : [];
    const total = getOrderTotal(order);
    document.getElementById('receipt-total').textContent = `$${total.toFixed(2)}`;

    // ETA
    const etaEl = document.getElementById('receipt-eta');
    if (order.estimated_pickup_at && order.delivery_status !== 'delivered' && order.delivery_status !== 'cancelled') {
        const etaDate = new Date(order.estimated_pickup_at);
        const etaTime = etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const diffMins = Math.round((etaDate - new Date()) / 60000);
        let etaLabel = `Est. ready by ${etaTime}`;
        if (diffMins > 0 && diffMins <= 120) etaLabel += ` (~${diffMins} min)`;
        else if (diffMins <= 0) etaLabel = 'Should be ready now!';
        etaEl.innerHTML = `<span>⏱️</span> ${etaLabel}`;
        etaEl.style.display = 'flex';
    } else {
        etaEl.style.display = 'none';
    }

    // Items table
    const items = Array.isArray(order.items) ? order.items : [];
    const tbody = document.getElementById('receipt-items-body');
    tbody.innerHTML = items.map(item => {
        const qty = item.qty || item.quantity || 1;
        const price = parseFloat(item.price) || 0;
        const sizeLabel = item.size ? ` (${item.size})` : '';
        return `<tr>
            <td>${item.name || 'Item'}${sizeLabel}</td>
            <td style="text-align:center;">${qty}</td>
            <td style="text-align:right;">$${(price * qty).toFixed(2)}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="3" style="text-align:center;color:var(--tx-muted);">No item details</td></tr>`;

    // Notes
    const notesEl = document.getElementById('receipt-notes');
    if (order.notes) {
        notesEl.innerHTML = `<strong>Notes:</strong> ${order.notes}`;
        notesEl.style.display = 'block';
    } else {
        notesEl.style.display = 'none';
    }

    document.getElementById('receipt-modal-overlay').classList.add('open');
};

function closeReceiptModal() {
    document.getElementById('receipt-modal-overlay').classList.remove('open');
}

function setupReceiptModal() {
    document.getElementById('receipt-close-btn')?.addEventListener('click', closeReceiptModal);
    document.getElementById('receipt-action-close')?.addEventListener('click', closeReceiptModal);
    document.getElementById('receipt-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeReceiptModal();
    });
    document.getElementById('receipt-print-btn')?.addEventListener('click', () => {
        window.print();
    });
}

// ── Mobile Drawer ──

function setupMobileDrawer() {
    const btn = document.getElementById('mobile-menu-btn');
    const drawer = document.getElementById('mobile-nav-drawer');
    const overlay = document.getElementById('mobile-drawer-overlay');
    const closeBtn = document.getElementById('mobile-drawer-close');

    function openDrawer() {
        drawer?.classList.add('open');
        overlay?.classList.add('open');
    }
    function closeDrawer() {
        drawer?.classList.remove('open');
        overlay?.classList.remove('open');
    }

    btn?.addEventListener('click', openDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    overlay?.addEventListener('click', closeDrawer);

    // Wire up the drawer sign-out button
    const drawerSignOut = document.getElementById('drawer-sign-out-btn');
    if (drawerSignOut) {
        drawerSignOut.addEventListener('click', async () => {
            const { error } = await supabase.auth.signOut();
            if (!error) window.location.href = 'index.html';
        });
    }
}

// ── Keyboard Accessibility ──

function setupKeyboardAccessibility() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close receipt modal
            const receiptOverlay = document.getElementById('receipt-modal-overlay');
            if (receiptOverlay?.classList.contains('open')) {
                closeReceiptModal();
                return;
            }
            // Close address modal
            const addressOverlay = document.getElementById('address-modal-overlay');
            if (addressOverlay?.classList.contains('open')) {
                window.closeAddressModal();
                return;
            }
            // Close mobile drawer
            const drawer = document.getElementById('mobile-nav-drawer');
            if (drawer?.classList.contains('open')) {
                drawer.classList.remove('open');
                document.getElementById('mobile-drawer-overlay')?.classList.remove('open');
                return;
            }
            // Close notification panel
            const notifPanel = document.getElementById('notif-history-panel');
            if (notifPanel?.classList.contains('open')) {
                notifPanel.classList.remove('open');
                return;
            }
        }
    });
}

// ── Toast ──

function showToast(message, isError = false) {
    const toast = document.getElementById('account-toast');
    toast.textContent = message;
    toast.className = 'account-toast' + (isError ? ' error' : '');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}
