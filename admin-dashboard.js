import { supabase } from './supabase-client.js';

// Run check on load, safely wait for hydration
document.addEventListener('DOMContentLoaded', async () => {
    // Hide body initially to prevent Flash of Unauthenticated Content (FOUC)
    document.body.style.display = 'none';
    
    // Await getUser() explicitly — this safely waits for any background token refreshes 
    // and guarantees we have the true auth state from the server.
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
        console.warn('No active session. Redirecting to home...');
        window.location.href = 'index.html';
        return;
    }

    try {
        // Verify admin role
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || profile.role !== 'admin') {
            console.error('Access Denied: User is not an admin.');
            window.location.href = 'index.html';
            return;
        }

        // Successfully verified as admin
        document.body.style.display = 'block';
        console.log('Admin access granted.');
        
        // Setup UI
        setupTabs();
        setupUserFilters();
        setupOrderFilters();
        setupSearchAndExport();
        setupRealtimeSubscriptions();
        
        // Initial fetch
        fetchPendingPartners();
        fetchUserDirectory();
        fetchMasterOrders();

    } catch (err) {
        console.error('Error during admin verification:', err);
        window.location.href = 'index.html';
    }
});

// Keep listener entirely dedicated to sign-out events so we catch logouts or timeouts cleanly
supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
        window.location.href = 'index.html';
    }
});

// Global Event Delegation for Sign Out
document.addEventListener('click', async (e) => {
    // Traverse up to find the button in case an inner element (like an icon) was clicked
    const btn = e.target.closest('#nav-sign-out-btn') || e.target.closest('#mobile-sign-out-btn');
    if (btn) {
        e.preventDefault();
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Error signing out:', error.message);
        } else {
            window.location.href = 'index.html';
        }
    }
});

// ── Admin Idle Timeout (20 Mins) ──
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
let idleTimer;

function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
        console.warn('Session timed out due to inactivity.');
        await supabase.auth.signOut();
    }, IDLE_TIMEOUT_MS);
}

// Attach globally
['mousemove', 'keydown', 'scroll', 'click'].forEach(evt => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

// ── Profile Settings ──
function setupSettings() {
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
                // 1. Verify current password by attempting a signIn
                const { data: { user }, error: userError } = await supabase.auth.getUser();
                if (userError || !user) throw new Error('Could not identify active user session.');
                
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: user.email,
                    password: currentPwd
                });
                
                if (signInError) throw new Error('Current password is incorrect.');
                
                // 2. Proceed with update
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

// ── Tab Management ──
function setupTabs() {
    setupSettings(); // Initialize settings form
    
    const links = document.querySelectorAll('.sidebar-nav .sidebar-link');
    const panes = document.querySelectorAll('.tab-pane');

    links.forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href').replace('#', '');
            
            // Allow native behavior for non-hash links
            if (!link.getAttribute('href').startsWith('#')) return;
            
            e.preventDefault();

            // Update Active Link State
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update Active Pane State
            panes.forEach(pane => {
                pane.classList.remove('active');
                if (pane.id === 'sec-' + targetId) {
                    pane.classList.add('active');
                }
            });

            // Trigger specific data fetching based on tab
            if (targetId === 'partners') {
                fetchPendingPartners();
            } else if (targetId === 'users') {
                fetchUserDirectory();
            } else if (targetId === 'orders') {
                fetchMasterOrders();
            }
        });
    });
}

// ── Phase 2.4: Partner Approval Module ──
window.approvePartner = async function(partnerId, btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Approving...';
    btnEl.style.opacity = '0.6';

    try {
        const { error } = await supabase
            .from('partner_details')
            .update({ status: 'approved' })
            .eq('id', partnerId);

        if (error) throw error;

        // Animate row removal smoothly
        const rowEl = btnEl.closest('tr');
        rowEl.style.transition = 'opacity 0.3s, transform 0.3s';
        rowEl.style.opacity = '0';
        rowEl.style.transform = 'translateY(10px)';
        
        // Update overview widget
        const widget = document.getElementById('overview-pending-val');
        if (widget) {
            const val = parseInt(widget.textContent, 10);
            if (!isNaN(val) && val > 0) widget.textContent = val - 1;
        }

        setTimeout(() => {
            rowEl.remove();
            // Check if table is empty now
            const tbody = document.getElementById('partners-tbody');
            if (tbody && tbody.children.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; padding: 40px 20px;">
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--tx-muted);">
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                                <p style="margin: 0; font-size: 1rem; font-weight: 500;">No pending wholesale applications</p>
                                <p style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.8;">You're all caught up!</p>
                            </div>
                        </td>
                    </tr>`;
            }
        }, 300);

    } catch (err) {
        console.error('Error approving partner:', err);
        alert('Failed to approve partner. Check console.');
        btnEl.disabled = false;
        btnEl.textContent = 'Approve Partner';
        btnEl.style.opacity = '1';
    }
}

async function fetchPendingPartners() {
    const tbody = document.getElementById('partners-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Loading partners...</td></tr>';

    try {
        const { data, error } = await supabase
            .from('partner_details')
            .select('*')
            .eq('status', 'pending');

        if (error) throw error;

        // Update Overview Widget
        const widget = document.getElementById('overview-pending-val');
        if (widget) widget.textContent = data ? data.length : 0;

        if (!data || data.length === 0) {
            tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px 20px;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--tx-muted);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                        <p style="margin: 0; font-size: 1rem; font-weight: 500;">No pending wholesale applications</p>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.8;">You're all caught up!</p>
                    </div>
                </td>
            </tr>`;
            return;
        }

        tbody.innerHTML = '';
        data.forEach(partner => {
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td><strong>${partner.business_name || 'N/A'}</strong></td>
                <td>${partner.contact_name || 'N/A'}</td>
                <td><span class="badge badge-pending">${partner.status}</span></td>
                <td>
                    <button class="btn-submit" style="padding: 6px 16px; font-size: 0.75rem; margin-top: 0; width: auto;" onclick="approvePartner('${partner.id}', this)">Approve Partner</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error('Error fetching pending partners:', err);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--red);">Error loading pending applications.</td></tr>`;
    }
}

// ── Phase 2.5: User Directory Module ──
let allUsersCache = [];

async function fetchUserDirectory() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading users...</td></tr>';

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Update overview widget
        const widget = document.getElementById('overview-users-val');
        if (widget) widget.textContent = data ? data.length : 0;

        allUsersCache = data || [];
        // The table renders filtered data if a filter is already active
        const activeFilter = document.querySelector('.filter-btn.active-filter');
        const role = activeFilter ? activeFilter.dataset.role : 'all';
        
        if (role === 'all') {
            renderUserTable(allUsersCache);
        } else {
            renderUserTable(allUsersCache.filter(u => u.role === role));
        }

    } catch (err) {
        console.error('Error fetching users:', err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--red);">Error loading users.</td></tr>`;
    }
}

function renderUserTable(users) {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;

    if (!document.getElementById('sec-users').classList.contains('active')) {
        // Only update if someone is not looking, to save paint, or just do it. Doing it is fine.
    }

    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px 20px;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--tx-muted);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        <p style="margin: 0; font-size: 1rem; font-weight: 500;">No users found</p>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.8;">Try adjusting your filters or search.</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = '';
    users.forEach(user => {
        const tr = document.createElement('tr');
        
        const roleColorMap = {
            admin: 'var(--role-admin-tx)',
            staff: 'var(--role-staff-tx)',
            partner: '#F2994A',
            driver: '#C8102E', 
            customer: '#6B5057' 
        };
        const roleBgMap = {
            admin: 'var(--role-admin-bg)',
            staff: 'var(--role-staff-bg)',
            partner: 'rgba(242, 153, 74, 0.15)',
            driver: 'rgba(200, 16, 46, 0.15)',
            customer: 'rgba(107, 80, 87, 0.15)'
        };
        
        const safeRole = user.role || 'customer';
        const color = roleColorMap[safeRole] || 'var(--tx)';
        const bg = roleBgMap[safeRole] || 'transparent';

        const joinDate = new Date(user.created_at).toLocaleDateString();

        const roleOptions = ['customer', 'partner', 'driver', 'staff', 'admin'];
        const selectHtml = `
            <select 
                class="role-select"
                data-original-role="${safeRole}"
                style="background: ${bg}; color: ${color}; border: 1px dashed ${color}; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; outline: none; cursor: pointer; text-transform: uppercase;"
                onchange="window.changeUserRole('${user.id}', this.value, this)"
            >
                ${roleOptions.map(r => `<option value="${r}" ${safeRole === r ? 'selected' : ''} style="color: initial; background: initial;">${r.toUpperCase()}</option>`).join('')}
            </select>
        `;

        tr.innerHTML = `
            <td><strong>${user.full_name || 'Anonymous'}</strong></td>
            <td>${selectHtml}</td>
            <td>${user.phone || 'N/A'}</td>
            <td>${joinDate}</td>
            <td>
                ${safeRole === 'staff' ? `<button class="btn-submit" style="padding: 4px 12px; font-size: 0.7rem; margin: 0; width: auto; background: transparent; border: 1px solid var(--bd); color: var(--tx);" onclick="window.togglePermissionsRow('${user.id}')">Permissions</button>` : '<span style="color:var(--tx-muted); font-size:0.75rem;">—</span>'}
            </td>
        `;
        tbody.appendChild(tr);

        if (safeRole === 'staff') {
            const permTr = document.createElement('tr');
            permTr.id = `perm-row-${user.id}`;
            permTr.style.display = 'none';
            permTr.style.background = 'var(--bg-hover)';
            
            const perms = user.staff_permissions || {
                can_view_orders: true,
                can_advance_orders: true,
                can_cancel_orders: false,
                can_approve_partners: false,
                can_manage_users: false,
                can_view_analytics: false
            };

            permTr.innerHTML = `
                <td colspan="5" style="padding: 16px 24px; border-bottom: 2px solid var(--bd);">
                    <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 12px;">Staff Permissions for ${user.full_name || 'Anonymous'}</div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 0.8rem;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="perm_orders_${user.id}" ${perms.can_view_orders ? 'checked' : ''} style="cursor: pointer;"> View Orders
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="perm_adv_${user.id}" ${perms.can_advance_orders ? 'checked' : ''} style="cursor: pointer;"> Advance Orders
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="perm_cancel_${user.id}" ${perms.can_cancel_orders ? 'checked' : ''} style="cursor: pointer;"> Cancel Orders
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="perm_partners_${user.id}" ${perms.can_approve_partners ? 'checked' : ''} style="cursor: pointer;"> Approve Partners
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="perm_users_${user.id}" ${perms.can_manage_users ? 'checked' : ''} style="cursor: pointer;"> Manage Users
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="perm_analytics_${user.id}" ${perms.can_view_analytics ? 'checked' : ''} style="cursor: pointer;"> View Analytics
                        </label>
                    </div>
                    <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
                        <button class="btn-submit" style="padding: 6px 16px; font-size: 0.75rem; margin: 0; width: auto;" onclick="window.saveStaffPermissions('${user.id}', this)">Save Permissions</button>
                    </div>
                </td>
            `;
            tbody.appendChild(permTr);
        }
    });
}

window.togglePermissionsRow = function(userId) {
    const row = document.getElementById(`perm-row-${userId}`);
    if (row) {
        row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
    }
}

window.saveStaffPermissions = async function(userId, btnEl) {
    btnEl.innerHTML = 'Saving...';
    btnEl.style.opacity = '0.7';

    const perms = {
        can_view_orders: document.getElementById(`perm_orders_${userId}`).checked,
        can_advance_orders: document.getElementById(`perm_adv_${userId}`).checked,
        can_cancel_orders: document.getElementById(`perm_cancel_${userId}`).checked,
        can_approve_partners: document.getElementById(`perm_partners_${userId}`).checked,
        can_manage_users: document.getElementById(`perm_users_${userId}`).checked,
        can_view_analytics: document.getElementById(`perm_analytics_${userId}`).checked
    };

    try {
        const { error } = await supabase
            .from('profiles')
            .update({ staff_permissions: perms })
            .eq('id', userId);

        if (error) throw error;
        
        btnEl.innerHTML = 'Saved!';
        setTimeout(() => {
            btnEl.innerHTML = 'Save Permissions';
            btnEl.style.opacity = '1';
        }, 2000);
        
        // Update cache silently
        const cachedUser = allUsersCache.find(u => u.id === userId);
        if (cachedUser) cachedUser.staff_permissions = perms;
        
    } catch (err) {
        console.error('Error updating permissions', err);
        btnEl.innerHTML = 'Error';
        setTimeout(() => {
            btnEl.innerHTML = 'Save Permissions';
            btnEl.style.opacity = '1';
        }, 2000);
    }
}

window.changeUserRole = async function(userId, newRole, selectEl) {
    const originalRole = selectEl.dataset.originalRole;
    if (newRole === originalRole) return;
    
    selectEl.disabled = true;
    selectEl.style.opacity = '0.5';
    
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);

        if (error) throw error;
        
        fetchUserDirectory(); // Triggers a clean refetch and visual rebuild (which correctly parses colors and expandable rows)
        
    } catch (err) {
        console.error('Failed to update role', err);
        selectEl.value = originalRole;
        selectEl.disabled = false;
        selectEl.style.opacity = '1';
        alert('Failed to update role. Make sure RLS policies allow you.');
    }
}

function setupUserFilters() {
    const filters = document.querySelectorAll('.filter-btn[data-role]');
    filters.forEach(btn => {
        btn.addEventListener('click', () => {
            filters.forEach(f => f.classList.remove('active-filter'));
            btn.classList.add('active-filter');
            
            const role = btn.dataset.role;
            let list = role === 'all' ? allUsersCache : allUsersCache.filter(u => u.role === role);
            
            const sVal = document.getElementById('user-search')?.value.toLowerCase() || '';
            if (sVal) list = list.filter(u => (u.full_name||'').toLowerCase().includes(sVal) || (u.phone||'').includes(sVal));
            
            renderUserTable(list);
        });
    });
}

// ── Phase 2.6: Master Orders Module ──
let allOrdersCache = [];

async function fetchMasterOrders() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading orders...</td></tr>';

    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                id, role, status, created_at, delivery_status, assigned_driver_id, profile_id, items,
                profiles:profile_id ( full_name, role )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Update overview widget
        const widget = document.getElementById('overview-orders-val');
        if (widget) {
            // Count today's orders
            const today = new Date();
            today.setHours(0,0,0,0);
            const todaysOrders = data ? data.filter(o => new Date(o.created_at) >= today).length : 0;
            widget.textContent = todaysOrders;
        }

        allOrdersCache = data || [];
        
        const activeFilter = document.querySelector('.filter-btn[data-order].active-filter');
        const status = activeFilter ? activeFilter.dataset.order : 'all';
        
        if (status === 'all') renderOrdersTable(allOrdersCache);
        else renderOrdersTable(allOrdersCache.filter(o => o.delivery_status === status));

    } catch (err) {
        console.error('Error fetching orders:', err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--red);">Error loading orders.</td></tr>`;
    }
}

function renderOrdersTable(orders) {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px 20px;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--tx-muted);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                        <p style="margin: 0; font-size: 1rem; font-weight: 500;">No orders found</p>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.8;">Try adjusting your filters or search.</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = '';
    orders.forEach(order => {
        const tr = document.createElement('tr');
        
        const statusColorMap = {
            pending: '#F2994A',
            baking: '#002D62',
            out_for_delivery: '#6B5057',
            delivered: '#1B5E20'
        };
        const statusBgMap = {
            pending: 'rgba(242, 153, 74, 0.15)',
            baking: 'rgba(0, 45, 98, 0.15)',
            out_for_delivery: 'rgba(107, 80, 87, 0.15)',
            delivered: 'rgba(27, 94, 32, 0.15)'
        };
        
        const ds = order.delivery_status || 'pending';
        const color = statusColorMap[ds] || 'var(--tx)';
        const bg = statusBgMap[ds] || 'transparent';

        const orderDate = new Date(order.created_at).toLocaleString();
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        
        // Profiles response handling
        const profileObj = Array.isArray(order.profiles) ? order.profiles[0] : order.profiles;
        const profileName = profileObj?.full_name || 'Anonymous';
        const profileRole = profileObj?.role || order.role || 'Unknown';
        const itemCount = Array.isArray(order.items) ? order.items.reduce((sum, item) => sum + (item.quantity || item.qty || 1), 0) : 0;

        tr.innerHTML = `
            <td>
                <button class="order-id-link" onclick="openOrderModal('${order.id}')" title="View Order Details">#${shortId}</button>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                    ${profileName} <span style="font-size: 0.75rem; color: var(--tx-muted);">(${profileRole.toUpperCase()})</span>
                    <span style="font-size: 0.7rem; background: var(--bg-hover); padding: 2px 6px; border-radius: 12px; color: var(--tx-muted); font-weight: 500;">${itemCount} items</span>
                </div>
            </td>
            <td><span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color}; opacity: 0.8">${ds.replace(/_/g, ' ')}</span></td>
            <td><span style="font-size: 0.9rem">${orderDate}</span></td>
            <td>
                <div style="display: flex; gap: 8px;">
                    ${(ds !== 'delivered' && ds !== 'cancelled') ? `<button class="btn-submit" style="padding: 6px 12px; font-size: 0.75rem; margin: 0; width: auto; transition: all 0.2s;" onclick="handleAdvanceClick(this, '${order.id}', '${ds}')">Advance</button>` : `<button class="btn-submit" style="padding: 6px 12px; font-size: 0.75rem; margin: 0; width: auto; opacity: 0.4;" disabled>${ds === 'cancelled' ? 'Cancelled' : 'Advance'}</button>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.handleAdvanceClick = async function(btnElem, orderId, currentStatus, fromModal = false) {
    if (!orderId) return;

    const nextStatusMap = {
        pending: 'baking',
        baking: 'out_for_delivery',
        out_for_delivery: 'delivered',
        delivered: 'pending' 
    };
    const newStatus = nextStatusMap[currentStatus] || 'pending';
    const friendlyStatus = newStatus.replace(/_/g, ' ');

    // ── Phase 1: Wait for Confirmation Click ──
    if (btnElem.dataset.confirming !== 'true') {
        const originalHtml = btnElem.innerHTML;
        btnElem.dataset.confirming = 'true';
        btnElem.dataset.originalHtml = originalHtml;
        
        btnElem.innerHTML = `Confirm to ${friendlyStatus}`;
        btnElem.style.background = 'var(--red)';
        btnElem.style.color = '#fff';
        btnElem.style.borderColor = 'var(--red)';
        
        // Reset after 4 seconds to normal state if they hesitate
        setTimeout(() => {
            if (btnElem.dataset.confirming === 'true') {
                btnElem.dataset.confirming = 'false';
                btnElem.innerHTML = btnElem.dataset.originalHtml;
                btnElem.style.background = '';
                btnElem.style.color = '';
                btnElem.style.borderColor = '';
            }
        }, 4000);
        return;
    }

    // ── Phase 2: Execute! ──
    btnElem.dataset.confirming = 'false';
    const originalHtml = btnElem.dataset.originalHtml;
    btnElem.innerHTML = 'Updating...';
    btnElem.style.opacity = '0.7';

    try {
        const { error } = await supabase
            .from('orders')
            .update({ delivery_status: newStatus })
            .eq('id', orderId);

        if (error) throw error;
        
        if (fromModal) {
            closeOrderModal();
        }
        
        fetchMasterOrders();
    } catch (err) {
        console.error('Error updating order:', err);
        btnElem.innerHTML = 'Error!';
        setTimeout(() => {
            btnElem.innerHTML = originalHtml;
            btnElem.style.opacity = '1';
            btnElem.style.background = '';
            btnElem.style.color = '';
            btnElem.style.borderColor = '';
        }, 3000);
    }
}

window.handleCancelClick = async function(btnElem, orderId, fromModal = false) {
    if (!orderId) return;

    if (btnElem.dataset.confirming !== 'true') {
        const originalHtml = btnElem.innerHTML;
        btnElem.dataset.confirming = 'true';
        btnElem.dataset.originalHtml = originalHtml;
        
        btnElem.innerHTML = `Confirm Cancellation`;
        btnElem.style.background = 'var(--red)';
        btnElem.style.color = '#fff';
        btnElem.style.borderColor = 'var(--red)';
        
        setTimeout(() => {
            if (btnElem.dataset.confirming === 'true') {
                btnElem.dataset.confirming = 'false';
                btnElem.innerHTML = btnElem.dataset.originalHtml;
                btnElem.style.background = 'transparent';
                btnElem.style.color = 'var(--red)';
                btnElem.style.borderColor = 'var(--red)';
            }
        }, 4000);
        return;
    }

    // Execute Cancel
    btnElem.dataset.confirming = 'false';
    const originalHtml = btnElem.dataset.originalHtml;
    btnElem.innerHTML = 'Cancelling...';
    btnElem.style.opacity = '0.7';

    try {
        const { error } = await supabase
            .from('orders')
            .update({ delivery_status: 'cancelled' })
            .eq('id', orderId);

        if (error) throw error;
        
        if (fromModal) {
            closeOrderModal();
        }
        
        fetchMasterOrders();
    } catch (err) {
        console.error('Error cancelling order:', err);
        btnElem.innerHTML = 'Error!';
        setTimeout(() => {
            btnElem.innerHTML = originalHtml;
            btnElem.style.opacity = '1';
            btnElem.style.background = 'transparent';
            btnElem.style.color = 'var(--red)';
            btnElem.style.borderColor = 'var(--red)';
        }, 3000);
    }
}

function setupOrderFilters() {
    const filters = document.querySelectorAll('.filter-btn[data-order]');
    filters.forEach(btn => {
        btn.addEventListener('click', () => {
            filters.forEach(f => f.classList.remove('active-filter'));
            btn.classList.add('active-filter');
            
            const status = btn.dataset.order;
            let list = status === 'all' ? allOrdersCache : allOrdersCache.filter(o => o.delivery_status === status);
            
            const sVal = document.getElementById('order-search')?.value.toLowerCase() || '';
            if (sVal) {
                list = list.filter(o => 
                    o.id.toLowerCase().includes(sVal) || 
                    ((Array.isArray(o.profiles) ? o.profiles[0] : o.profiles)?.full_name || '').toLowerCase().includes(sVal)
                );
            }
            renderOrdersTable(list);
        });
    });
}

// ── Admin QoL: Search & Export CSV ──
function exportToCSV(filename, rows) {
    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function setupSearchAndExport() {
    // Users
    const uSearch = document.getElementById('user-search');
    if (uSearch) {
        uSearch.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const role = document.querySelector('.filter-btn[data-role].active-filter')?.dataset.role || 'all';
            let list = role === 'all' ? allUsersCache : allUsersCache.filter(u => u.role === role);
            if (val) list = list.filter(u => (u.full_name||'').toLowerCase().includes(val) || (u.phone||'').includes(val));
            renderUserTable(list);
        });
    }

    const uExp = document.getElementById('export-users-btn');
    if (uExp) {
        uExp.addEventListener('click', () => {
            const role = document.querySelector('.filter-btn[data-role].active-filter')?.dataset.role || 'all';
            let list = role === 'all' ? allUsersCache : allUsersCache.filter(u => u.role === role);
            const headers = ['ID', 'Name', 'Phone', 'Role', 'Joined At'];
            const rows = list.map(u => [u.id, `"${u.full_name||''}"`, `"${u.phone||''}"`, u.role, u.created_at]);
            exportToCSV('User_Directory.csv', [headers, ...rows]);
        });
    }

    // Orders
    const oSearch = document.getElementById('order-search');
    if (oSearch) {
        oSearch.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const status = document.querySelector('.filter-btn[data-order].active-filter')?.dataset.order || 'all';
            let list = status === 'all' ? allOrdersCache : allOrdersCache.filter(o => o.delivery_status === status);
            if (val) {
                list = list.filter(o => 
                    o.id.toLowerCase().includes(val) || 
                    ((Array.isArray(o.profiles) ? o.profiles[0] : o.profiles)?.full_name || '').toLowerCase().includes(val)
                );
            }
            renderOrdersTable(list);
        });
    }

    const oExp = document.getElementById('export-orders-btn');
    if (oExp) {
        oExp.addEventListener('click', () => {
            const status = document.querySelector('.filter-btn[data-order].active-filter')?.dataset.order || 'all';
            let list = status === 'all' ? allOrdersCache : allOrdersCache.filter(o => o.delivery_status === status);
            const headers = ['Order ID', 'Customer Name', 'Role', 'Status', 'Date'];
            const rows = list.map(o => {
                const profileObj = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
                const pName = profileObj?.full_name || 'Anonymous';
                const pRole = profileObj?.role || o.role || 'Unknown';
                return [o.id, `"${pName}"`, pRole, o.delivery_status, o.created_at];
            });
            exportToCSV('Master_Orders.csv', [headers, ...rows]);
        });
    }
}

// ── Admin QoL: Realtime Notifications & Subscriptions ──
function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Helper function to synthesize a soft bell/chime strike
        const playTone = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            
            // A triangle wave has richer harmonics than a pure sine wave, sounding more like a glass chime
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);
            
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            // Volume Envelope: Sharp strike (0.02s) fading out smoothly
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        // Synthesize an ascending major third double-chime (like an iPhone SMS alert)
        const now = ctx.currentTime;
        playTone(1046.50, now, 0.3);         // Initial 'ding' (C6)
        playTone(1318.51, now + 0.12, 0.5);  // Staggered higher 'ping' (E6)
        
    } catch(e) { console.error('Audio setup failed:', e); }
}

function showNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}

function setupRealtimeSubscriptions() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    supabase.channel('admin-orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
            console.log('Realtime Order Event:', payload);
            if (payload.eventType === 'INSERT') {
                playNotificationSound();
                showNotification('New Bakery Order!', 'An order was just placed.');
            }
            fetchMasterOrders();
        })
        .subscribe();

    supabase.channel('admin-partners')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_details' }, (payload) => {
            console.log('Realtime Partner Event:', payload);
            if (payload.eventType === 'INSERT') {
                playNotificationSound();
                showNotification('New Wholesale Application', 'A new partner just applied.');
            }
            fetchPendingPartners();
        })
        .subscribe();
}

// ── Admin QoL: Order Detail Modal ──

window.openOrderModal = function(orderId) {
    const order = allOrdersCache.find(o => o.id === orderId);
    if (!order) return;

    // Header
    const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
    document.getElementById('modal-order-id').innerText = `Order #${shortId}`;
    document.getElementById('modal-order-date').innerText = new Date(order.created_at).toLocaleString();

    // Customer Detail
    const profileObj = Array.isArray(order.profiles) ? order.profiles[0] : order.profiles;
    document.getElementById('modal-customer-name').innerText = profileObj?.full_name || 'Anonymous';
    
    const roleBadge = document.getElementById('modal-customer-role');
    const role = (profileObj?.role || order.role || 'Unknown').toLowerCase();
    roleBadge.innerText = role.toUpperCase();
    if (role === 'customer') {
        roleBadge.style.background = 'rgba(0,0,0,0.05)';
        roleBadge.style.color = 'var(--tx)';
        roleBadge.style.borderColor = 'var(--bd)';
    } else {
        roleBadge.style.background = 'var(--bg-blob)';
        roleBadge.style.color = 'var(--red)';
        roleBadge.style.borderColor = 'var(--red)';
    }
    
    // Check if we have phone in profile
    // Note: If profile table has phone, update query to select it if needed. For now display 'Unknown' if not fetched.
    document.getElementById('modal-customer-phone').innerText = profileObj?.phone || 'No phone number listed';

    // Body Itemized Table
    const tbody = document.getElementById('modal-items-tbody');
    let grandTotal = 0;

    if (order.items && Array.isArray(order.items) && order.items.length > 0) {
        tbody.innerHTML = order.items.map(item => {
            const qty = parseInt(item.qty) || 1;
            const price = parseFloat(item.price) || 0;
            const lineTotal = qty * price;
            grandTotal += lineTotal;
            return `
                <tr>
                    <td><strong>${item.name}</strong></td>
                    <td style="text-align: center;">${qty}</td>
                    <td style="text-align: right;">$${price.toFixed(2)}</td>
                    <td class="line-tot">$${lineTotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--tx-muted); font-style: italic;">No item data recorded format.</td></tr>';
    }

    document.getElementById('modal-grand-total').innerText = grandTotal.toFixed(2);

    // Progress Bar
    const stages = ['pending', 'baking', 'out_for_delivery', 'delivered'];
    const humanStages = ['Pending', 'Baking', 'Out for Delivery', 'Delivered'];
    const ds = order.delivery_status || 'pending';
    const activeIdx = stages.indexOf(ds);

    if (ds === 'cancelled') {
        document.getElementById('modal-progress-bar').innerHTML = '<div style="width: 100%; text-align: center; color: var(--red); font-weight: bold; margin: 16px 0 24px; font-size: 1rem; letter-spacing: 0.1em; text-transform: uppercase;">ORDER CANCELLED</div>';
    } else {
        const progHtml = stages.map((stage, idx) => {
            let stateClass = '';
            if (idx < activeIdx) stateClass = 'completed';
            if (idx === activeIdx) stateClass = 'active';
            return `
                <div class="prog-step ${stateClass}">
                    <div class="prog-dot"></div>
                    <div class="prog-label">${humanStages[idx]}</div>
                </div>
            `;
        }).join('');
        document.getElementById('modal-progress-bar').innerHTML = progHtml;
    }

    // Footer actions
    const footerContainer = document.getElementById('modal-footer-container');
    
    // Print Button (Always Available)
    const printBtn = `
        <button class="btn-submit" style="background: transparent; color: var(--tx); border: 1px solid var(--bd); padding: 8px 16px; margin: 0; width: auto;" onclick="printOrder()">
            <i data-lucide="printer" class="icon" style="width: 16px; height: 16px; margin-right: 6px; display: inline-block; vertical-align: middle;"></i>
            <span>Print</span>
        </button>
    `;

    if (ds === 'cancelled') {
        footerContainer.innerHTML = printBtn;
    } else if (ds === 'delivered') {
        footerContainer.innerHTML = `
            ${printBtn}
            <button class="btn-submit" style="padding: 8px 16px; margin: 0; width: auto; opacity: 0.4;" disabled>Delivered</button>
        `;
    } else {
        footerContainer.innerHTML = `
            <div style="display: flex; gap: 8px; align-items: center;">
                ${printBtn}
                <button class="btn-submit" style="background: transparent; border: 1px solid var(--red); color: var(--red); padding: 8px 16px; margin: 0; width: auto; transition: all 0.2s;" onclick="handleCancelClick(this, '${order.id}', true)">Cancel Order</button>
            </div>
            <button class="btn-submit" style="padding: 8px 24px; margin: 0; width: auto; box-shadow: 0 4px 12px rgba(200,16,46,0.3); transition: all 0.2s;" onclick="handleAdvanceClick(this, '${order.id}', '${ds}', true)">Advance Status</button>
        `;
    }

    // Initialize missing lucide icons injected
    if (window.lucide) window.lucide.createIcons();

    const overlay = document.getElementById('order-modal-overlay');
    if (overlay) overlay.classList.add('open');
};

window.closeOrderModal = function() {
    const overlay = document.getElementById('order-modal-overlay');
    if (overlay) overlay.classList.remove('open');
};

window.printOrder = function() {
    window.print();
};
