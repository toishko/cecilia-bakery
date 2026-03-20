import { supabase } from './supabase-client.js';

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
    
    // Trigger slide-in animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // 400ms CSS animation match
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
        
        document.body.style.display = 'block';
        console.log('Partner access granted.');
        
        setupTabs();
        setupSignOut();
        setupProfileForm();
        renderBulkItems();
        setupOrderForm();
        
        fetchOrderHistory();

    } catch (err) {
        console.error('Error during partner verification:', err);
        window.location.href = 'index.html';
    }
});

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

            if (targetId === 'history' || targetId === 'overview') {
                fetchOrderHistory();
            }
        });
    });
}

// ── Phase 3.2: Profile & Preferences Management ──
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
            const { error } = await supabase
                .from('partner_details')
                .update(updates)
                .eq('id', currentPartnerDetails.id);

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

    // Also support checking password updates logic same as staff dashboard
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

// ── Phase 3.3: Bulk Order Form UI ──
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

// ── Phase 3.4: Submit Order Logic ──
function setupOrderForm() {
    const submitBtn = document.getElementById('submit-order-btn');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', async () => {
        const totalAmount = window.calculateTotals();
        
        if (totalAmount <= 0) {
            window.showDashboardToast('Please add at least one item to your order.', 'error');
            return;
        }

        const orderItems = [];
        BULK_ITEMS.forEach(item => {
            const input = document.getElementById(`qty-${item.id}`);
            const qty = input ? parseInt(input.value) || 0 : 0;
            if (qty > 0) {
                orderItems.push({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: qty
                });
            }
        });

        const notes = document.getElementById('order-notes').value;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const { error } = await supabase
                .from('orders')
                .insert({
                    profile_id: currentUser.id,
                    role: 'partner',
                    items: orderItems,
                    total_amount: totalAmount,
                    delivery_status: 'pending',
                    notes: notes,
                    delivery_address: currentPartnerDetails.delivery_address || ''
                });

            if (error) throw error;
            
            window.showDashboardToast('Order submitted successfully!', 'success');
            
            // Reset form
            BULK_ITEMS.forEach(item => {
                const input = document.getElementById(`qty-${item.id}`);
                if (input) input.value = 0;
            });
            document.getElementById('order-notes').value = '';
            calculateTotals();
            
            // Redirect to history
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

// ── Phase 3.5: Order Status Tracker & Invoices ──
async function fetchOrderHistory() {
    const tbodyHistory = document.getElementById('history-tbody');
    const tbodyOverview = document.getElementById('overview-recent-orders-tbody');
    
    if (tbodyHistory) tbodyHistory.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading history...</td></tr>';
    
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('profile_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        updateOverviewWidgets(data || []);
        renderHistoryTable(data || []);
        renderOverviewRecentOrders(data || []);

    } catch (err) {
        console.error('Error fetching order history:', err);
        if (tbodyHistory) tbodyHistory.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--red);">Error loading order history.</td></tr>`;
    }
}

function updateOverviewWidgets(orders) {
    document.getElementById('overview-total-orders').textContent = orders.length;
    
    const activeDeliveries = orders.filter(o => o.delivery_status === 'out_for_delivery' || o.delivery_status === 'baking' || o.delivery_status === 'pending').length;
    document.getElementById('overview-active-deliveries').textContent = activeDeliveries;
    
    const totalSpent = orders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    document.getElementById('overview-total-spent').textContent = '$' + totalSpent.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function renderOverviewRecentOrders(orders) {
    const tbody = document.getElementById('overview-recent-orders-tbody');
    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--tx-muted); padding: 24px;">No recent orders.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    orders.slice(0, 5).forEach(order => {
        const tr = document.createElement('tr');
        
        const ds = order.delivery_status || 'pending';
        const { color, bg } = getStatusColors(ds);
        
        const orderDate = new Date(order.created_at).toLocaleDateString();
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const total = parseFloat(order.total_amount) || 0;

        tr.innerHTML = `
            <td>#${shortId}</td>
            <td>${orderDate}</td>
            <td><span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color}; opacity: 0.8">${ds.replace(/_/g, ' ')}</span></td>
            <td>$${total.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderHistoryTable(orders) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px 20px;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--tx-muted);">
                        <p style="margin: 0; font-size: 1rem; font-weight: 500;">No order history found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = '';
    orders.forEach(order => {
        const tr = document.createElement('tr');
        
        const ds = order.delivery_status || 'pending';
        const { color, bg } = getStatusColors(ds);
        
        const orderDate = new Date(order.created_at).toLocaleString();
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const total = parseFloat(order.total_amount) || 0;
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
    const statusColorMap = {
        pending: '#F2994A',
        baking: '#002D62',
        out_for_delivery: '#6B5057',
        delivered: '#1B5E20',
        cancelled: 'var(--red)'
    };
    const statusBgMap = {
        pending: 'rgba(242, 153, 74, 0.15)',
        baking: 'rgba(0, 45, 98, 0.15)',
        out_for_delivery: 'rgba(107, 80, 87, 0.15)',
        delivered: 'rgba(27, 94, 32, 0.15)',
        cancelled: 'rgba(200, 16, 46, 0.15)'
    };
    return {
        color: statusColorMap[status] || 'var(--tx)',
        bg: statusBgMap[status] || 'transparent'
    };
}

window.printInvoice = function(orderId) {
    // Simple window.print approach. A true invoice would render dedicated HTML.
    window.showDashboardToast('Invoice printing will fetch order ' + orderId + ' and call window.print()', 'warning');
    // In a real scenario, you'd open a new window or iframe, render the invoice template, and print.
};
