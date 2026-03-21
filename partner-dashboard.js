import { supabase, getOrderTotal } from './supabase-client.js';
import { initIdleTimeout } from './idle-timeout.js';
import { initNotificationUI, playSound, showBrowserNotification, addToHistory, startTitleBlink } from './notification-utils.js';
initIdleTimeout(20 * 60 * 1000);

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

const BULK_ITEMS = [
    { id: 'tres-leches-half', name: 'Tres Leches (1/2 Sheet)', price: 45.00 },
    { id: 'tres-leches-full', name: 'Tres Leches (Full Sheet)', price: 85.00 },
    { id: 'guava-pastries-flat', name: 'Guava Pastries (Flat/12)', price: 24.00 },
    { id: 'cheese-rolls-flat', name: 'Cheese Rolls (Flat/12)', price: 26.00 },
    { id: 'cuban-bread-dozen', name: 'Cuban Bread (Dozen)', price: 18.00 }
];

let currentUser = null;
let currentPartnerDetails = null;
let allPartnerOrders = [];

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
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || profile.role !== 'partner') {
            console.error('Access Denied: User is not a partner.');
            window.location.href = 'index.html';
            return;
        }

        const { data: partnerData, error: partnerError } = await supabase
            .from('partner_details')
            .select('*')
            .eq('id', user.id)
            .single();

        if (partnerError || !partnerData || partnerData.status !== 'approved') {
            window.showDashboardToast('Your partner account is pending approval or inactive. Please contact administration.', 'error');
            window.location.href = 'index.html';
            return;
        }

        currentUser = user;
        currentPartnerDetails = partnerData;
        
        document.getElementById('auth-loading-overlay')?.remove();
        console.log('Partner access granted.');
        
        setupTabs();
        setupSignOut();
        setupProfileForm();
        
        fetchOrderHistory();
        setupRealtimeSubscriptions();

    } catch (err) {
        console.error('Error during partner verification:', err);
        window.location.href = 'index.html';
    }
});

// ── Realtime Subscriptions ──
const PARTNER_STATUS_MESSAGES = {
    pending:          { emoji: '📝', text: 'Order status: Pending' },
    baking:           { emoji: '🧁', text: 'Your order is being prepared!' },
    ready_for_pickup: { emoji: '🎉', text: 'Your order is ready for pickup!' },
    delivered:        { emoji: '🛍️', text: 'Order delivered!' },
    cancelled:        { emoji: '❌', text: 'Order has been cancelled.' },
};

let previousPartnerStatuses = {};

function setupRealtimeSubscriptions() {
    initNotificationUI();

    allPartnerOrders.forEach(o => {
        if (o.id) previousPartnerStatuses[o.id] = o.delivery_status || 'pending';
    });

    supabase.channel('partner-orders')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `profile_id=eq.${currentUser.id}`
        }, (payload) => {
            console.log('Partner order update received:', payload);

            if (payload.eventType === 'UPDATE' && payload.new) {
                const orderId = payload.new.id;
                const newStatus = payload.new.delivery_status;
                const oldStatus = previousPartnerStatuses[orderId];

                if (oldStatus && newStatus && oldStatus !== newStatus) {
                    const msg = PARTNER_STATUS_MESSAGES[newStatus];
                    if (msg) {
                        const shortId = orderId.split('-')[0].toUpperCase();
                        window.showDashboardToast(`${msg.emoji} #${shortId}: ${msg.text}`, 'success');
                        const toneType = newStatus === 'cancelled' ? 'alert' : 'status';
                        playSound(toneType);
                        showBrowserNotification('Order Update', `#${shortId}: ${msg.text}`);
                        addToHistory('status', 'Order Update', `#${shortId}: ${msg.text}`);
                        startTitleBlink(`#${shortId}: ${msg.text}`);
                    }
                }
                previousPartnerStatuses[orderId] = newStatus;
            } else if (payload.eventType === 'INSERT' && payload.new) {
                previousPartnerStatuses[payload.new.id] = payload.new.delivery_status || 'pending';
            }

            fetchOrderHistory();
        })
        .subscribe();
}

function setupSignOut() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('#nav-sign-out-btn') || e.target.closest('#mobile-sign-out-btn');
        if (btn) {
            e.preventDefault();
            const { error } = await supabase.auth.signOut();
            if (!error) { window.location.href = 'index.html'; }
        }
    });

    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { window.location.href = 'index.html'; }
    });
}

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
                if (pane.id === 'sec-' + targetId) pane.classList.add('active');
            });

            if (targetId === 'history' || targetId === 'overview') fetchOrderHistory();
            if (targetId === 'analytics') renderPartnerAnalytics();
        });
    });
}

// ── Profile & Preferences Management ──
function setupProfileForm() {
    if (!currentPartnerDetails) return;

    document.getElementById('profile-business-name').value = currentPartnerDetails.business_name || '';
    document.getElementById('profile-contact-name').value = currentPartnerDetails.contact_name || '';
    document.getElementById('profile-phone').value = currentPartnerDetails.phone || '';
    document.getElementById('profile-address').value = currentPartnerDetails.delivery_address || '';

    const profileForm = document.getElementById('profile-form');
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('profile-update-btn');
        const msg = document.getElementById('profile-msg');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        
        const updates = {
            business_name: document.getElementById('profile-business-name').value,
            contact_name: document.getElementById('profile-contact-name').value,
            phone: document.getElementById('profile-phone').value,
            delivery_address: document.getElementById('profile-address').value
        };

        try {
            const { error } = await supabase.from('partner_details').update(updates).eq('id', currentPartnerDetails.id);
            if (error) throw error;
            msg.textContent = 'Profile updated successfully!';
            msg.style.color = 'green';
            currentPartnerDetails = { ...currentPartnerDetails, ...updates };
        } catch (err) {
            console.error('Error updating profile:', err);
            msg.textContent = 'Failed to update profile.';
            msg.style.color = 'var(--red)';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save Changes';
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
            
            if (pwd !== conf) { msg.textContent = 'Passwords do not match.'; msg.style.color = 'var(--red)'; return; }
            
            btn.disabled = true;
            btn.textContent = 'Verifying...';
            
            try {
                const { error: signInError } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: currentPwd });
                if (signInError) throw new Error('Current password is incorrect.');
                btn.textContent = 'Updating...';
                const { error: updateError } = await supabase.auth.updateUser({ password: pwd });
                if (updateError) throw updateError;
                msg.textContent = 'Password updated successfully!';
                msg.style.color = 'green';
                settingsForm.reset();
            } catch (err) {
                console.error('Error updating password:', err);
                msg.textContent = err.message || 'Error updating password.';
                msg.style.color = 'var(--red)';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Update Password';
            }
        });
    }
}

// ── Bulk Order Form UI (locked) ──
function renderBulkItems() {
    const tbody = document.getElementById('bulk-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    BULK_ITEMS.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${item.name}</strong></td>
            <td>$${item.price.toFixed(2)}</td>
            <td style="text-align: center;">
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <button type="button" class="qty-btn" onclick="updateQty('${item.id}', -1)" style="width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg-hover); cursor: pointer; color: var(--tx);">-</button>
                    <input type="number" id="qty-${item.id}" value="0" min="0" max="99" style="width: 40px; text-align: center; border: 1px solid var(--bd); border-radius: 4px; padding: 4px;" readonly onchange="calculateTotals()">
                    <button type="button" class="qty-btn" onclick="updateQty('${item.id}', 1)" style="width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg-hover); cursor: pointer; color: var(--tx);">+</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.updateQty = function(id, change) {
    const input = document.getElementById(`qty-${id}`);
    if (!input) return;
    let current = parseInt(input.value) || 0;
    current += change;
    if (current < 0) current = 0;
    if (current > 99) current = 99;
    input.value = current;
    calculateTotals();
};

window.calculateTotals = function() {
    let subtotal = 0;
    BULK_ITEMS.forEach(item => {
        const input = document.getElementById(`qty-${item.id}`);
        const qty = input ? parseInt(input.value) || 0 : 0;
        subtotal += qty * item.price;
    });
    document.getElementById('order-subtotal').textContent = '$' + subtotal.toFixed(2);
    document.getElementById('order-total').textContent = '$' + subtotal.toFixed(2);
    return subtotal;
};

// ── Submit Order Logic (locked) ──
function setupOrderForm() {
    const submitBtn = document.getElementById('submit-order-btn');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', async () => {
        const totalAmount = window.calculateTotals();
        if (totalAmount <= 0) { window.showDashboardToast('Please add at least one item to your order.', 'error'); return; }

        const orderItems = [];
        BULK_ITEMS.forEach(item => {
            const input = document.getElementById(`qty-${item.id}`);
            const qty = input ? parseInt(input.value) || 0 : 0;
            if (qty > 0) { orderItems.push({ id: item.id, name: item.name, price: item.price, quantity: qty }); }
        });

        const notes = document.getElementById('order-notes').value;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const { error } = await supabase.from('orders').insert({
                profile_id: currentUser.id, role: 'partner', items: orderItems,
                delivery_status: 'pending',
                delivery_address: currentPartnerDetails.delivery_address || '',
                total_amount: totalAmount,
                note: notes || null,
            });
            if (error) throw error;
            window.showDashboardToast('Order submitted successfully!', 'success');
            BULK_ITEMS.forEach(item => { const input = document.getElementById(`qty-${item.id}`); if (input) input.value = 0; });
            document.getElementById('order-notes').value = '';
            calculateTotals();
            document.querySelector('.sidebar-nav .sidebar-link[href="#history"]').click();
        } catch (err) {
            console.error('Error submitting order:', err);
            window.showDashboardToast('Failed to submit order. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Order';
        }
    });
}

// ── Order Status Tracker & Invoices ──
async function fetchOrderHistory() {
    const tbodyHistory = document.getElementById('history-tbody');
    if (tbodyHistory) tbodyHistory.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading history...</td></tr>';
    
    try {
        const { data, error } = await supabase
            .from('orders').select('*')
            .eq('profile_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        allPartnerOrders = data || [];

        // Seed previous statuses for realtime
        allPartnerOrders.forEach(o => {
            if (o.id && !previousPartnerStatuses[o.id]) previousPartnerStatuses[o.id] = o.delivery_status || 'pending';
        });

        updateOverviewWidgets(allPartnerOrders);
        renderHistoryTable(allPartnerOrders);
        renderOverviewRecentOrders(allPartnerOrders);
    } catch (err) {
        console.error('Error fetching order history:', err);
        if (tbodyHistory) tbodyHistory.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--red);">Error loading order history.</td></tr>`;
    }
}

function updateOverviewWidgets(orders) {
    document.getElementById('overview-total-orders').textContent = orders.length;
    const activeDeliveries = orders.filter(o => ['ready_for_pickup', 'baking', 'pending'].includes(o.delivery_status)).length;
    document.getElementById('overview-active-deliveries').textContent = activeDeliveries;
    const totalSpent = orders.reduce((sum, o) => sum + getOrderTotal(o), 0);
    document.getElementById('overview-total-spent').textContent = '$' + totalSpent.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function renderOverviewRecentOrders(orders) {
    const tbody = document.getElementById('overview-recent-orders-tbody');
    if (!tbody) return;
    if (orders.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--tx-muted); padding: 24px;">No recent orders.</td></tr>`; return; }
    tbody.innerHTML = '';
    orders.slice(0, 5).forEach(order => {
        const tr = document.createElement('tr');
        const ds = order.delivery_status || 'pending';
        const { color, bg } = getStatusColors(ds);
        const orderDate = new Date(order.created_at).toLocaleDateString();
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const itemsList = Array.isArray(order.items) ? order.items : [];
        const total = getOrderTotal(order);
        tr.innerHTML = `<td>#${shortId}</td><td>${orderDate}</td><td><span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color}; opacity: 0.8">${ds.replace(/_/g, ' ')}</span></td><td>$${total.toFixed(2)}</td>`;
        tbody.appendChild(tr);
    });
}

function renderHistoryTable(orders) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px 20px;"><div style="display: flex; flex-direction: column; align-items: center; color: var(--tx-muted);"><p style="margin: 0; font-size: 1rem; font-weight: 500;">No order history found</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = '';
    orders.forEach(order => {
        const tr = document.createElement('tr');
        const ds = order.delivery_status || 'pending';
        const { color, bg } = getStatusColors(ds);
        const orderDate = new Date(order.created_at).toLocaleString();
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const itemsList = Array.isArray(order.items) ? order.items : [];
        const total = getOrderTotal(order);
        const itemsCount = Array.isArray(order.items) ? order.items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 0;
        tr.innerHTML = `
            <td><strong>#${shortId}</strong></td>
            <td>${orderDate}</td>
            <td><span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color}; opacity: 0.8">${ds.replace(/_/g, ' ')}</span></td>
            <td>${itemsCount} items</td>
            <td><strong>$${total.toFixed(2)}</strong></td>
            <td style="text-align: center;">
                <button onclick="window.printInvoice('${order.id}')" style="background: transparent; border: 1px solid var(--bd); padding: 4px 8px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--tx);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function getStatusColors(status) {
    const statusColorMap = { pending: '#F2994A', baking: '#002D62', ready_for_pickup: '#1B5E20', delivered: '#1B5E20', cancelled: 'var(--red)' };
    const statusBgMap = { pending: 'rgba(242, 153, 74, 0.15)', baking: 'rgba(0, 45, 98, 0.15)', ready_for_pickup: 'rgba(27, 94, 32, 0.15)', delivered: 'rgba(27, 94, 32, 0.15)', cancelled: 'rgba(200, 16, 46, 0.15)' };
    return { color: statusColorMap[status] || 'var(--tx)', bg: statusBgMap[status] || 'transparent' };
}

window.printInvoice = function(orderId) {
    window.showDashboardToast('Invoice printing will fetch order ' + orderId + ' and call window.print()', 'warning');
};

// ═══════════════════════════════════════════
// PARTNER ANALYTICS
// ═══════════════════════════════════════════

let analyticsCharts = {};

async function renderPartnerAnalytics() {
    const orders = allPartnerOrders;

    // ── KPI Cards ──
    const totalOrders = orders.length;
    const totalSpent = orders.reduce((s, o) => s + getOrderTotal(o), 0);
    const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
    const activeOrders = orders.filter(o => ['pending', 'baking', 'ready_for_pickup'].includes(o.delivery_status)).length;

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('analytics-kpi-orders', totalOrders);
    setEl('analytics-kpi-spent', '$' + totalSpent.toFixed(2));
    setEl('analytics-kpi-aov', '$' + avgOrderValue.toFixed(2));
    setEl('analytics-kpi-active', activeOrders);

    // ── Order Trend Chart (last 30 days) ──
    const trendCanvas = document.getElementById('partnerTrendChart');
    if (trendCanvas && typeof Chart !== 'undefined') {
        if (analyticsCharts.trend) analyticsCharts.trend.destroy();

        const dayLabels = [], dayTotals = [], dayCounts = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            dayLabels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
            const dayOrders = orders.filter(o => o.created_at && o.created_at.startsWith(key));
            dayCounts.push(dayOrders.length);
            dayTotals.push(dayOrders.reduce((s, o) => s + getOrderTotal(o), 0));
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#ccc' : '#666';
        const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

        analyticsCharts.trend = new Chart(trendCanvas, {
            type: 'bar',
            data: {
                labels: dayLabels,
                datasets: [{
                    label: 'Spending ($)', data: dayTotals,
                    backgroundColor: 'rgba(200, 16, 46, 0.6)', borderRadius: 4,
                    barThickness: 'flex', maxBarThickness: 16, yAxisID: 'y'
                }, {
                    label: 'Orders', data: dayCounts, type: 'line',
                    borderColor: '#002D62', backgroundColor: 'transparent',
                    pointRadius: 0, tension: 0.3, borderWidth: 2, yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: textColor } } },
                scales: {
                    x: { ticks: { color: textColor, maxRotation: 45 }, grid: { color: gridColor } },
                    y: { position: 'left', ticks: { color: textColor, callback: v => '$' + v }, grid: { color: gridColor } },
                    y1: { position: 'right', ticks: { color: textColor, stepSize: 1 }, grid: { drawOnChartArea: false } }
                }
            }
        });
    }

    // ── Top Items Chart ──
    const itemsCanvas = document.getElementById('partnerItemsChart');
    if (itemsCanvas && typeof Chart !== 'undefined') {
        if (analyticsCharts.items) analyticsCharts.items.destroy();

        const itemCountMap = {};
        orders.forEach(o => {
            if (!Array.isArray(o.items)) return;
            o.items.forEach(i => {
                const name = i.name || i.id || 'Unknown';
                itemCountMap[name] = (itemCountMap[name] || 0) + (i.quantity || 1);
            });
        });
        const sorted = Object.entries(itemCountMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const isDark2 = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor2 = isDark2 ? '#ccc' : '#666';

        const colors = [
            'rgba(200,16,46,0.7)', 'rgba(0,45,98,0.7)', 'rgba(242,153,74,0.7)',
            'rgba(27,94,32,0.7)', 'rgba(156,39,176,0.6)', 'rgba(0,150,136,0.6)',
            'rgba(255,87,34,0.6)', 'rgba(63,81,181,0.6)'
        ];

        analyticsCharts.items = new Chart(itemsCanvas, {
            type: 'doughnut',
            data: {
                labels: sorted.map(s => s[0]),
                datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors, borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '60%',
                plugins: { legend: { position: 'right', labels: { color: textColor2, boxWidth: 12, padding: 10 } } }
            }
        });
    }
}
