import { supabase } from './supabase-client.js';
import { initIdleTimeout } from './idle-timeout.js';
initIdleTimeout(20 * 60 * 1000);

let currentUser = null;
let currentProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Loading overlay is in the HTML, no need to hide body
    
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
        
        setupTabs();
        setupSignOut();
        setupProfileForm();
        fetchOrders();
        
        // Setup visual elements
        document.getElementById('member-since').textContent = new Date(profile.created_at).toLocaleDateString();
        document.getElementById('account-email').textContent = user.email;

    } catch (err) {
        console.error('Error during customer verification:', err);
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

            if (targetId === 'orders') {
                fetchOrders();
            }
        });
    });
}

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
            msg.style.color = 'green';
            currentProfile = { ...currentProfile, ...updates };

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
                msg.style.color = 'green';
                settingsForm.reset();
            } catch (err) {
                console.error('Error updating password:', err);
                msg.textContent = err.message || 'Error updating password.';
                msg.style.color = 'var(--red)';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Change Password';
            }
        });
    }
}

// ── Phase 5.3: Retail Active & Past Order Tracker ──
async function fetchOrders() {
    const tbodyActive = document.getElementById('active-orders-tbody');
    const tbodyPast = document.getElementById('past-orders-tbody');
    
    if (tbodyActive) tbodyActive.innerHTML = '<tr><td colspan="4" style="text-align: center;">Loading...</td></tr>';
    if (tbodyPast) tbodyPast.innerHTML = '<tr><td colspan="4" style="text-align: center;">Loading...</td></tr>';
    
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('profile_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const activeOrders = data.filter(o => o.delivery_status !== 'delivered' && o.delivery_status !== 'cancelled');
        const pastOrders = data.filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'cancelled');

        renderOrdersTable(activeOrders, 'active-orders-tbody', 'No active orders.');
        renderOrdersTable(pastOrders, 'past-orders-tbody', 'No past orders found.');

    } catch (err) {
        console.error('Error fetching orders:', err);
        if (tbodyActive) tbodyActive.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--red);">Error loading orders.</td></tr>`;
        if (tbodyPast) tbodyPast.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--red);">Error loading orders.</td></tr>`;
    }
}

function renderOrdersTable(orders, tbodyId, emptyMessage) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 30px 20px; color: var(--tx-muted);">
                    ${emptyMessage}
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = '';
    orders.forEach(order => {
        const tr = document.createElement('tr');
        
        const statusMap = {
            pending: { color: '#F2994A', bg: 'rgba(242, 153, 74, 0.15)', text: 'Pending' },
            baking: { color: '#002D62', bg: 'rgba(0, 45, 98, 0.15)', text: 'Baking' },
            out_for_delivery: { color: '#6B5057', bg: 'rgba(107, 80, 87, 0.15)', text: 'Out for Delivery' },
            delivered: { color: '#1B5E20', bg: 'rgba(27, 94, 32, 0.15)', text: 'Delivered' },
            cancelled: { color: 'var(--red)', bg: 'rgba(200, 16, 46, 0.15)', text: 'Cancelled' }
        };
        const ds = order.delivery_status || 'pending';
        const sInfo = statusMap[ds] || statusMap.pending;
        
        const orderDate = new Date(order.created_at).toLocaleDateString();
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const total = parseFloat(order.total_amount) || 0;

        tr.innerHTML = `
            <td><strong>#${shortId}</strong></td>
            <td>${orderDate}</td>
            <td><span class="badge" style="background: ${sInfo.bg}; color: ${sInfo.color}; border: 1px solid ${sInfo.color}; opacity: 0.8">${sInfo.text}</span></td>
            <td><strong>$${total.toFixed(2)}</strong></td>
        `;
        tbody.appendChild(tr);
    });
}
