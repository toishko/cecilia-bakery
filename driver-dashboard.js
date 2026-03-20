import { supabase } from './supabase-client.js';

let currentUser = null;
let selectedOrderIdForDelivery = null;

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

        if (profileError || !profile || profile.role !== 'driver') {
            console.error('Access Denied: User is not a driver.');
            window.location.href = 'index.html';
            return;
        }

        currentUser = user;
        document.body.style.display = 'block';
        console.log('Driver access granted.');
        
        setupTabs();
        setupSignOut();
        setupModals();
        
        fetchDispatchList();
        
        const refreshBtn = document.getElementById('refresh-dispatch-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => {
            refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="icon" style="width: 14px; height: 14px; animation: spin 1s linear infinite;"></i> Refreshing...';
            setTimeout(() => {
                fetchDispatchList().then(() => {
                    refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="icon" style="width: 14px; height: 14px;"></i> Refresh';
                    if (window.lucide) window.lucide.createIcons();
                });
            }, 500);
        });

    } catch (err) {
        console.error('Error during driver verification:', err);
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

            if (targetId === 'dispatch' || targetId === 'completed') {
                fetchDispatchList();
            }
        });
    });
}

function setupModals() {
    const closeBtn = document.getElementById('close-notes-btn');
    const overlay = document.getElementById('notes-modal-overlay');
    const submitBtn = document.getElementById('submit-delivery-btn');

    if (closeBtn) closeBtn.addEventListener('click', closeNotesModal);
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeNotesModal();
    });

    if (submitBtn) submitBtn.addEventListener('click', confirmDelivery);
}

function closeNotesModal() {
    const overlay = document.getElementById('notes-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    selectedOrderIdForDelivery = null;
    document.getElementById('delivery-note-input').value = '';
}

window.openDeliveryNotes = function(orderId) {
    selectedOrderIdForDelivery = orderId;
    const overlay = document.getElementById('notes-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
}

// ── Phase 4.2: Active Dispatch List ──
async function fetchDispatchList() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                profiles:profile_id ( full_name, phone )
            `)
            .in('delivery_status', ['pending', 'baking', 'out_for_delivery', 'delivered'])
            .order('created_at', { ascending: true });

        if (error) throw error;

        const activeOrders = data.filter(o => o.delivery_status !== 'delivered');
        
        // Find completed today
        const today = new Date();
        today.setHours(0,0,0,0);
        const completedOrders = data.filter(o => o.delivery_status === 'delivered' && new Date(o.created_at) >= today);

        renderDispatchCards(activeOrders, 'dispatch-list', true);
        renderDispatchCards(completedOrders, 'completed-list', false);
        
        if (window.lucide) window.lucide.createIcons();

    } catch (err) {
        console.error('Error fetching dispatch list:', err);
        document.getElementById('dispatch-list').innerHTML = `<div style="text-align: center; color: var(--red); padding: 40px;">Error loading deliveries.</div>`;
    }
}

function renderDispatchCards(orders, containerId, isActive) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (orders.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--tx-muted); padding: 40px; display: flex; flex-direction: column; align-items: center;">
            <i data-lucide="check-circle" class="icon" style="width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
            <span style="font-weight: 500; font-size: 1.1rem;">${isActive ? 'No active deliveries.' : 'No completed deliveries today.'}</span>
            <span style="font-size: 0.85rem; opacity: 0.8;">You're all caught up!</span>
        </div>`;
        return;
    }

    container.innerHTML = '';
    orders.forEach(order => {
        // Extract partner/customer details
        const isPartner = order.role === 'partner';
        const profileInfo = Array.isArray(order.profiles) ? order.profiles[0] : order.profiles;
        
        const customerName = profileInfo?.full_name || (isPartner ? 'Partner' : 'Customer');
        const phone = profileInfo?.phone || 'N/A';
        const rawAddress = order.delivery_address || 'Pickup';
        
        const addressMapLink = rawAddress !== 'Pickup' ? `https://maps.google.com/?q=${encodeURIComponent(rawAddress)}` : '#';
        
        const shortId = order.id ? order.id.split('-')[0].toUpperCase() : 'N/A';
        const isBaking = order.delivery_status === 'baking' || order.delivery_status === 'pending';
        const isOut = order.delivery_status === 'out_for_delivery';

        const card = document.createElement('div');
        card.className = 'dispatch-card';
        
        const lang = document.documentElement.lang || 'en';

        let itemsHtml = '';
        if (order.items && Array.isArray(order.items)) {
            itemsHtml = order.items.map(item => `<li><span>${item.name}</span> <span style="font-weight: 600;">x${item.quantity || item.qty || 1}</span></li>`).join('');
        }
        
        // Status Badge Logic
        const statusMap = {
            pending: { color: '#F2994A', bg: 'rgba(242, 153, 74, 0.15)', text: 'Pending' },
            baking: { color: 'var(--role-baking-tx)', bg: 'var(--role-baking-bg)', text: 'Baking' },
            out_for_delivery: { color: '#6B5057', bg: 'rgba(107, 80, 87, 0.15)', text: 'Out for Delivery' },
            delivered: { color: '#1B5E20', bg: 'rgba(27, 94, 32, 0.15)', text: 'Delivered' }
        };
        const sInfo = statusMap[order.delivery_status] || statusMap.pending;
        const badgeHtml = `<span style="font-size: 0.75rem; padding: 4px 8px; border-radius: 4px; border: 1px solid ${sInfo.color}; color: ${sInfo.color}; background: ${sInfo.bg}; font-weight: 600;">${sInfo.text}</span>`;

        card.innerHTML = `
            <div class="dispatch-header">
                <div>
                    <div class="dispatch-title">${customerName}</div>
                    <div class="dispatch-id">Order #${shortId} • Phone: ${phone}</div>
                </div>
                <div>${badgeHtml}</div>
            </div>
            
            <a href="${addressMapLink}" target="_blank" class="dispatch-address">
                <i data-lucide="map-pin" class="icon" style="color: var(--icon-blue); margin-top: 2px;"></i>
                <div>
                    <span style="font-weight: 600; display: block; margin-bottom: 2px; font-size: 0.85rem; color: var(--tx-muted); text-transform: uppercase;">Delivery Address</span>
                    ${rawAddress}
                </div>
            </a>
            
            <div class="dispatch-items">
                <span style="display: block; font-weight: 600; margin-bottom: 8px; font-size: 0.8rem; text-transform: uppercase;">Order Items</span>
                <ul>${itemsHtml}</ul>
            </div>
            
            ${isActive ? `
            <div class="dispatch-actions">
                ${isBaking ? `<button class="btn-dispatch btn-pickup" onclick="window.markPickedUp('${order.id}', this)">
                    <i data-lucide="package" class="icon" style="width: 18px; height: 18px;"></i> Mark Picked Up
                </button>` : ''}
                
                ${isOut ? `<button class="btn-dispatch btn-deliver" onclick="window.openDeliveryNotes('${order.id}')">
                    <i data-lucide="check" class="icon" style="width: 18px; height: 18px;"></i> Mark Delivered
                </button>` : ''}
            </div>` : ''}
        `;

        container.appendChild(card);
    });
}

// ── Phase 4.3: Status Update & Proof Controls ──
window.markPickedUp = async function(orderId, btnElem) {
    if (!orderId) return;
    btnElem.disabled = true;
    btnElem.innerHTML = '<i data-lucide="loader" class="icon" style="animation: spin 1s linear infinite;"></i> Processing...';
    
    try {
        const { error } = await supabase
            .from('orders')
            .update({ delivery_status: 'out_for_delivery' })
            .eq('id', orderId);

        if (error) throw error;
        fetchDispatchList();
    } catch (err) {
        console.error('Error marking picked up:', err);
        btnElem.disabled = false;
        btnElem.innerHTML = 'Error - Try Again';
    }
}

async function confirmDelivery() {
    if (!selectedOrderIdForDelivery) return;
    
    const submitBtn = document.getElementById('submit-delivery-btn');
    const note = document.getElementById('delivery-note-input').value;
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating...';
    
    try {
        const { error } = await supabase
            .from('orders')
            .update({ 
                delivery_status: 'delivered',
                driver_notes: note 
            })
            .eq('id', selectedOrderIdForDelivery);

        if (error) throw error;
        
        closeNotesModal();
        fetchDispatchList();

    } catch (err) {
        console.error('Error delivering order:', err);
        submitBtn.textContent = 'Error Updating';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Delivery';
    }
}
