import { supabase } from './supabase-client.js';

/* ═══════════════════════════════════════════════════════════════
   ANALYTICS ENGINE — Cecilia Bakery Admin Dashboard
   Channel-based analytics with premium Chart.js styling
   ═══════════════════════════════════════════════════════════════ */

// ── State ──
let allCustomerOrders = [];
let allDriverOrders = [];
let allDriverPayments = [];
let allRouteClients = [];
let driverProfiles = {};     // id → { name, email }
let currentChannel = 'all';
let dateRange = { start: null, end: null };
let chartInstances = {};     // chart id → Chart instance

// ── Brand Color Palette ──
const COLORS = {
    navy:    '#002D62',
    red:     '#C8102E',
    amber:   '#F2994A',
    green:   '#27ae60',
    plum:    '#6B5057',
    forest:  '#1B5E20',
    violet:  '#8B5CF6',
    teal:    '#0891B2',
    rose:    '#E11D48',
    slate:   '#64748B',
};
const PALETTE = [COLORS.navy, COLORS.red, COLORS.amber, COLORS.green, COLORS.plum, COLORS.forest, COLORS.violet, COLORS.teal, COLORS.rose, COLORS.slate];

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    setupChannelToggle();
    setupDateControls();
    setupExport();

    // Set default date range to Last 30 Days
    setQuickPreset(30);

    // Listen for tab activation
    const analyticsLinks = document.querySelectorAll('a[href="#analytics"]');
    analyticsLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (allCustomerOrders.length === 0 && allDriverOrders.length === 0) {
                fetchAllAnalyticsData();
            } else {
                renderAnalytics();
            }
        });
    });

    // Also update overview stat card
    fetchAllAnalyticsData().then(() => updateOverviewCard());
});

// ═══════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════

async function fetchAllAnalyticsData() {
    try {
        const [custRes, driverRes, paymentRes, clientRes, profileRes] = await Promise.all([
            supabase.from('orders').select('id, created_at, total, items, delivery_status, user_id, profiles(full_name, role)'),
            supabase.from('driver_orders').select('id, created_at, total, items, status, driver_id, profiles(full_name)'),
            supabase.from('driver_payments').select('id, created_at, amount, driver_id'),
            supabase.from('driver_route_clients').select('id, created_at, driver_id, is_active'),
            supabase.from('profiles').select('id, full_name, email, role').eq('role', 'driver'),
        ]);

        allCustomerOrders = (custRes.data || []).filter(o => o.delivery_status !== 'cancelled');
        allDriverOrders = driverRes.data || [];
        allDriverPayments = paymentRes.data || [];
        allRouteClients = clientRes.data || [];

        // Build driver profile map
        driverProfiles = {};
        (profileRes.data || []).forEach(p => {
            driverProfiles[p.id] = { name: p.full_name || p.email || 'Unknown', email: p.email };
        });

        renderAnalytics();
    } catch (err) {
        console.error('Analytics fetch error:', err);
    }
}

// ═══════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════

function renderAnalytics() {
    const filtered = getFilteredData();
    updateKPICards(filtered);
    drawAllCharts(filtered);

    // Re-init lucide icons for any dynamic ones
    if (window.lucide) lucide.createIcons();
}

function getFilteredData() {
    const { start, end } = dateRange;

    const inRange = (dateStr) => {
        if (!start && !end) return true;
        const d = new Date(dateStr);
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    };

    let customerOrders = allCustomerOrders.filter(o => inRange(o.created_at));
    let driverOrders = allDriverOrders.filter(o => inRange(o.created_at));
    let driverPayments = allDriverPayments.filter(p => inRange(p.created_at));
    let routeClients = allRouteClients.filter(c => inRange(c.created_at));

    // Channel filtering
    const ch = currentChannel;

    // Split customer orders into actual customers vs partners
    const custOnly = customerOrders.filter(o => !o.profiles || o.profiles.role !== 'partner');
    const partnerOnly = customerOrders.filter(o => o.profiles && o.profiles.role === 'partner');

    return { customerOrders, driverOrders, driverPayments, routeClients, custOnly, partnerOnly, channel: ch };
}

// ═══════════════════════════════════════════
// KPI CARDS
// ═══════════════════════════════════════════

function updateKPICards(data) {
    const { customerOrders, driverOrders, driverPayments, routeClients, custOnly, partnerOnly, channel } = data;

    let orders, revenue, extraLabel, extraValue, extraSub;

    if (channel === 'all') {
        orders = [...customerOrders, ...driverOrders];
        revenue = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        extraLabel = 'Active Channels';
        const channelCount = [custOnly.length > 0, driverOrders.length > 0, partnerOnly.length > 0].filter(Boolean).length;
        extraValue = channelCount.toString();
        extraSub = `${custOnly.length} cust · ${driverOrders.length} driver · ${partnerOnly.length} partner orders`;
    } else if (channel === 'customers') {
        orders = custOnly;
        revenue = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        extraLabel = 'Unique Customers';
        const uniqueCustomers = new Set(orders.map(o => o.user_id).filter(Boolean));
        extraValue = uniqueCustomers.size.toString();
        extraSub = 'distinct accounts';
    } else if (channel === 'drivers') {
        orders = driverOrders;
        revenue = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        const totalPaid = driverPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        extraLabel = 'Outstanding Balance';
        extraValue = formatCurrency(revenue - totalPaid);
        extraSub = `${formatCurrency(totalPaid)} collected`;
    } else if (channel === 'partners') {
        orders = partnerOnly;
        revenue = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        extraLabel = 'Partner Accounts';
        const uniquePartners = new Set(orders.map(o => o.user_id).filter(Boolean));
        extraValue = uniquePartners.size.toString();
        extraSub = 'active partners';
    }

    const orderCount = orders.length;
    const aov = orderCount > 0 ? revenue / orderCount : 0;

    document.getElementById('kpi-revenue').textContent = formatCurrency(revenue);
    document.getElementById('kpi-revenue-sub').textContent = channel === 'all' ? 'all channels combined' : `${channel} only`;
    document.getElementById('kpi-orders').textContent = orderCount.toLocaleString();
    document.getElementById('kpi-orders-sub').textContent = 'in selected period';
    document.getElementById('kpi-aov').textContent = formatCurrency(aov);
    document.getElementById('kpi-aov-sub').textContent = 'per order average';
    document.getElementById('kpi-extra-label').textContent = extraLabel;
    document.getElementById('kpi-extra').textContent = extraValue;
    document.getElementById('kpi-extra-sub').textContent = extraSub;
}

function updateOverviewCard() {
    const revWidget = document.getElementById('overview-revenue-val');
    if (!revWidget) return;
    const totalRev = [...allCustomerOrders, ...allDriverOrders].reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    revWidget.textContent = formatCurrency(totalRev);
}

// ═══════════════════════════════════════════
// CHART DRAWING
// ═══════════════════════════════════════════

function drawAllCharts(data) {
    const { customerOrders, driverOrders, custOnly, partnerOnly, driverPayments, routeClients, channel } = data;

    // Determine which orders to chart
    let primaryOrders;
    if (channel === 'all') primaryOrders = [...customerOrders, ...driverOrders];
    else if (channel === 'customers') primaryOrders = custOnly;
    else if (channel === 'drivers') primaryOrders = driverOrders;
    else if (channel === 'partners') primaryOrders = partnerOnly;

    // Chart 1: Revenue Trend (line)
    const chart1Title = channel === 'drivers' ? 'Driver Spend Trend' : 'Revenue Trend';
    document.getElementById('chart1-title').textContent = chart1Title;
    drawRevenueTrend('analyticsChart1', primaryOrders, channel);

    // Chart 2: Order Volume (bar)
    document.getElementById('chart2-title').textContent = 'Order Volume';
    drawOrderVolume('analyticsChart2', primaryOrders, channel);

    // Chart 3: Top Items (horizontal bar)
    document.getElementById('chart3-title').textContent = 'Top Ordered Items';
    drawTopItems('analyticsChart3', primaryOrders);

    // Chart 4: Channel-specific
    if (channel === 'all') {
        document.getElementById('chart4-title').textContent = 'Revenue by Channel';
        drawRevenueByChannel('analyticsChart4', custOnly, driverOrders, partnerOnly);
    } else if (channel === 'customers') {
        document.getElementById('chart4-title').textContent = 'Orders by Status';
        drawOrdersByStatus('analyticsChart4', custOnly, 'delivery_status');
    } else if (channel === 'drivers') {
        document.getElementById('chart4-title').textContent = 'Outstanding by Driver';
        drawOutstandingByDriver('analyticsChart4', driverOrders, driverPayments);
    } else if (channel === 'partners') {
        document.getElementById('chart4-title').textContent = 'Revenue by Partner';
        drawRevenueByPartner('analyticsChart4', partnerOnly);
    }
}

// ── Chart 1: Revenue Trend ──
function drawRevenueTrend(canvasId, orders, channel) {
    const dailyMap = {};
    orders.forEach(o => {
        const d = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dailyMap[d] = (dailyMap[d] || 0) + (parseFloat(o.total) || 0);
    });
    const sorted = sortDateLabels(Object.keys(dailyMap));
    const data = sorted.map(d => dailyMap[d]);
    const color = channel === 'drivers' ? COLORS.red : channel === 'partners' ? COLORS.amber : COLORS.navy;

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sorted,
            datasets: [{
                label: 'Revenue ($)',
                data: data,
                borderColor: color,
                backgroundColor: (context) => createGradient(context, color),
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: color,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                borderWidth: 2.5,
            }]
        },
        options: getChartOptions('currency'),
    });
}

// ── Chart 2: Order Volume ──
function drawOrderVolume(canvasId, orders, channel) {
    const dailyMap = {};
    orders.forEach(o => {
        const d = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dailyMap[d] = (dailyMap[d] || 0) + 1;
    });
    const sorted = sortDateLabels(Object.keys(dailyMap));
    const data = sorted.map(d => dailyMap[d]);
    const color = channel === 'drivers' ? COLORS.red : channel === 'partners' ? COLORS.amber : COLORS.navy;

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted,
            datasets: [{
                label: 'Orders',
                data: data,
                backgroundColor: color + '99',
                hoverBackgroundColor: color,
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.6,
                categoryPercentage: 0.8,
            }]
        },
        options: getChartOptions('number'),
    });
}

// ── Chart 3: Top Items (horizontal bar) ──
function drawTopItems(canvasId, orders) {
    const itemsMap = {};
    orders.forEach(o => {
        if (!Array.isArray(o.items)) return;
        o.items.forEach(item => {
            const name = item.name || 'Unknown';
            const qty = item.qty || item.quantity || 1;
            itemsMap[name] = (itemsMap[name] || 0) + qty;
        });
    });

    let sorted = Object.entries(itemsMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (sorted.length === 0) {
        destroyChart(canvasId);
        showEmptyChart(canvasId);
        return;
    }

    const labels = sorted.map(s => s[0]);
    const data = sorted.map(s => s[1]);
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length] + 'CC');

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Quantity',
                data: data,
                backgroundColor: colors,
                hoverBackgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.7,
            }]
        },
        options: {
            ...getChartOptions('number'),
            indexAxis: 'y',
        },
    });
}

// ── Chart 4a: Revenue by Channel (doughnut) ──
function drawRevenueByChannel(canvasId, custOrders, driverOrders, partnerOrders) {
    const custRev = custOrders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const driverRev = driverOrders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const partnerRev = partnerOrders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

    if (custRev === 0 && driverRev === 0 && partnerRev === 0) {
        destroyChart(canvasId);
        showEmptyChart(canvasId);
        return;
    }

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Customers', 'Drivers', 'Partners'],
            datasets: [{
                data: [custRev, driverRev, partnerRev],
                backgroundColor: [COLORS.navy + 'DD', COLORS.red + 'DD', COLORS.amber + 'DD'],
                hoverBackgroundColor: [COLORS.navy, COLORS.red, COLORS.amber],
                borderWidth: 0,
                spacing: 4,
            }]
        },
        options: getDoughnutOptions(),
    });
}

// ── Chart 4b: Orders by Status (doughnut) ──
function drawOrdersByStatus(canvasId, orders, statusField) {
    const statusMap = {};
    orders.forEach(o => {
        const s = o[statusField] || 'unknown';
        statusMap[s] = (statusMap[s] || 0) + 1;
    });

    const labels = Object.keys(statusMap);
    const data = Object.values(statusMap);

    if (data.length === 0) { destroyChart(canvasId); showEmptyChart(canvasId); return; }

    const colorMap = {
        pending: COLORS.amber, baking: COLORS.red, out_for_delivery: COLORS.teal,
        delivered: COLORS.green, approved: COLORS.navy, in_progress: COLORS.violet,
        ready_for_pickup: COLORS.forest, picked_up: COLORS.green, unknown: COLORS.slate,
    };
    const colors = labels.map(l => (colorMap[l] || COLORS.slate) + 'DD');

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.map(l => l.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
            datasets: [{ data, backgroundColor: colors, borderWidth: 0, spacing: 4 }]
        },
        options: getDoughnutOptions(),
    });
}

// ── Chart 4c: Outstanding by Driver (horizontal bar) ──
function drawOutstandingByDriver(canvasId, driverOrders, driverPayments) {
    // Group by driver
    const driverTotals = {};
    const driverPaid = {};

    driverOrders.forEach(o => {
        const id = o.driver_id;
        if (!id) return;
        driverTotals[id] = (driverTotals[id] || 0) + (parseFloat(o.total) || 0);
    });

    driverPayments.forEach(p => {
        const id = p.driver_id;
        if (!id) return;
        driverPaid[id] = (driverPaid[id] || 0) + (parseFloat(p.amount) || 0);
    });

    const driverIds = [...new Set([...Object.keys(driverTotals), ...Object.keys(driverPaid)])];
    const labels = driverIds.map(id => driverProfiles[id]?.name || 'Unknown Driver');
    const outstanding = driverIds.map(id => (driverTotals[id] || 0) - (driverPaid[id] || 0));

    if (labels.length === 0) { destroyChart(canvasId); showEmptyChart(canvasId); return; }

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Outstanding ($)',
                data: outstanding,
                backgroundColor: outstanding.map(v => v > 0 ? COLORS.red + '99' : COLORS.green + '99'),
                hoverBackgroundColor: outstanding.map(v => v > 0 ? COLORS.red : COLORS.green),
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.6,
            }]
        },
        options: {
            ...getChartOptions('currency'),
            indexAxis: 'y',
        },
    });
}

// ── Chart 4d: Revenue by Partner (horizontal bar) ──
function drawRevenueByPartner(canvasId, partnerOrders) {
    const partnerMap = {};
    partnerOrders.forEach(o => {
        const name = o.profiles?.full_name || 'Unknown Partner';
        partnerMap[name] = (partnerMap[name] || 0) + (parseFloat(o.total) || 0);
    });

    let sorted = Object.entries(partnerMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (sorted.length === 0) { destroyChart(canvasId); showEmptyChart(canvasId); return; }

    const labels = sorted.map(s => s[0]);
    const data = sorted.map(s => s[1]);
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length] + 'CC');

    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Revenue ($)',
                data,
                backgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.7,
            }]
        },
        options: {
            ...getChartOptions('currency'),
            indexAxis: 'y',
        },
    });
}

// ═══════════════════════════════════════════
// CHART THEMING & UTILS
// ═══════════════════════════════════════════

function getChartOptions(valueType) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    const textColor = isDark ? '#ccc' : '#666';

    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: isDark ? '#1e1e2e' : '#1a1a2e',
                titleColor: '#fff',
                bodyColor: '#e0e0e0',
                titleFont: { family: "'Outfit', sans-serif", size: 13, weight: '600' },
                bodyFont: { family: "'Outfit', sans-serif", size: 12 },
                padding: 12,
                cornerRadius: 8,
                displayColors: true,
                boxPadding: 4,
                callbacks: {
                    label: (ctx) => {
                        const val = ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed;
                        if (valueType === 'currency') return ` ${formatCurrency(val)}`;
                        return ` ${val.toLocaleString()}`;
                    }
                }
            },
        },
        scales: {
            x: {
                grid: { color: gridColor, drawBorder: false },
                ticks: { color: textColor, font: { family: "'Outfit', sans-serif", size: 11 }, maxRotation: 45 },
            },
            y: {
                grid: { color: gridColor, drawBorder: false },
                ticks: {
                    color: textColor,
                    font: { family: "'Outfit', sans-serif", size: 11 },
                    callback: (val) => valueType === 'currency' ? '$' + val.toLocaleString() : val,
                },
                beginAtZero: true,
            },
        },
    };
}

function getDoughnutOptions() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
            legend: {
                position: 'right',
                labels: {
                    color: isDark ? '#ccc' : '#555',
                    font: { family: "'Outfit', sans-serif", size: 12 },
                    padding: 16,
                    usePointStyle: true,
                    pointStyleWidth: 10,
                },
            },
            tooltip: {
                backgroundColor: isDark ? '#1e1e2e' : '#1a1a2e',
                titleColor: '#fff',
                bodyColor: '#e0e0e0',
                titleFont: { family: "'Outfit', sans-serif", size: 13, weight: '600' },
                bodyFont: { family: "'Outfit', sans-serif", size: 12 },
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                    label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`,
                }
            },
        },
    };
}

function createGradient(context, color) {
    const chart = context.chart;
    const { ctx, chartArea } = chart;
    if (!chartArea) return color + '33';
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, color + '30');
    gradient.addColorStop(1, color + '03');
    return gradient;
}

function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
    }
    // Clear any empty state
    const canvas = document.getElementById(canvasId);
    if (canvas) {
        const container = canvas.parentElement;
        const emptyEl = container.querySelector('.analytics-empty');
        if (emptyEl) emptyEl.remove();
        canvas.style.display = '';
    }
}

function showEmptyChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = 'none';
    const container = canvas.parentElement;
    const div = document.createElement('div');
    div.className = 'analytics-empty';
    div.innerHTML = '<i data-lucide="bar-chart-2" class="icon"></i><span>No data for this period</span>';
    container.appendChild(div);
}

function sortDateLabels(labels) {
    return labels.sort((a, b) => new Date(a) - new Date(b));
}

function formatCurrency(n) {
    return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════
// CONTROL HANDLERS
// ═══════════════════════════════════════════

function setupChannelToggle() {
    const bar = document.getElementById('analytics-channel-bar');
    if (!bar) return;
    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.analytics-channel-btn');
        if (!btn) return;
        bar.querySelectorAll('.analytics-channel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentChannel = btn.dataset.channel;
        renderAnalytics();
    });
}

function setupDateControls() {
    const startInput = document.getElementById('analytics-start-date');
    const endInput = document.getElementById('analytics-end-date');

    if (startInput) startInput.addEventListener('change', handleDateChange);
    if (endInput) endInput.addEventListener('change', handleDateChange);

    // Preset buttons
    const presetsContainer = document.getElementById('analytics-presets');
    if (presetsContainer) {
        presetsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.analytics-preset-btn');
            if (!btn) return;
            presetsContainer.querySelectorAll('.analytics-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const days = btn.dataset.days;
            if (days === 'all') {
                dateRange = { start: null, end: null };
                document.getElementById('analytics-start-date').value = '';
                document.getElementById('analytics-end-date').value = '';
            } else {
                setQuickPreset(parseInt(days));
            }
            if (allCustomerOrders.length > 0 || allDriverOrders.length > 0) {
                renderAnalytics();
            }
        });
    }
}

function handleDateChange() {
    const startVal = document.getElementById('analytics-start-date').value;
    const endVal = document.getElementById('analytics-end-date').value;
    dateRange.start = startVal ? new Date(startVal + 'T00:00:00') : null;
    dateRange.end = endVal ? new Date(endVal + 'T23:59:59') : null;

    // Un-highlight presets since user picked custom dates
    document.querySelectorAll('.analytics-preset-btn').forEach(b => b.classList.remove('active'));

    if (allCustomerOrders.length > 0 || allDriverOrders.length > 0) {
        renderAnalytics();
    }
}

function setQuickPreset(days) {
    const now = new Date();
    const start = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    dateRange = { start, end: now };

    const startInput = document.getElementById('analytics-start-date');
    const endInput = document.getElementById('analytics-end-date');
    if (startInput) startInput.value = toDateString(start);
    if (endInput) endInput.value = toDateString(now);
}

function toDateString(d) {
    return d.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════

function setupExport() {
    const btn = document.getElementById('analytics-export-csv');
    if (!btn) return;
    btn.addEventListener('click', exportCSV);
}

function exportCSV() {
    const filtered = getFilteredData();
    const { customerOrders, driverOrders, custOnly, partnerOnly, channel } = filtered;

    let rows = [];
    let filename = 'cecilia-analytics';

    if (channel === 'all' || channel === 'customers') {
        const orders = channel === 'customers' ? custOnly : customerOrders;
        rows.push(['Source', 'Order ID', 'Date', 'Total', 'Status', 'Customer']);
        orders.forEach(o => {
            rows.push([
                'Customer',
                o.id?.substring(0, 8) || '',
                new Date(o.created_at).toLocaleDateString(),
                parseFloat(o.total || 0).toFixed(2),
                o.delivery_status || '',
                o.profiles?.full_name || '',
            ]);
        });
        filename += '-customers';
    }

    if (channel === 'all' || channel === 'drivers') {
        if (rows.length > 0) rows.push([]);  // blank separator
        const driverRows = [['Source', 'Order ID', 'Date', 'Total', 'Status', 'Driver']];
        driverOrders.forEach(o => {
            driverRows.push([
                'Driver',
                o.id?.substring(0, 8) || '',
                new Date(o.created_at).toLocaleDateString(),
                parseFloat(o.total || 0).toFixed(2),
                o.status || '',
                driverProfiles[o.driver_id]?.name || '',
            ]);
        });
        rows.push(...driverRows);
        filename += '-drivers';
    }

    if (channel === 'all' || channel === 'partners') {
        if (rows.length > 0) rows.push([]);
        const partnerRows = [['Source', 'Order ID', 'Date', 'Total', 'Status', 'Partner']];
        partnerOnly.forEach(o => {
            partnerRows.push([
                'Partner',
                o.id?.substring(0, 8) || '',
                new Date(o.created_at).toLocaleDateString(),
                parseFloat(o.total || 0).toFixed(2),
                o.delivery_status || '',
                o.profiles?.full_name || '',
            ]);
        });
        rows.push(...partnerRows);
        filename += '-partners';
    }

    if (rows.length === 0) {
        if (window.showDashboardToast) window.showDashboardToast('No data to export', 'warning');
        return;
    }

    // Build CSV string
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${toDateString(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    if (window.showDashboardToast) window.showDashboardToast('CSV exported successfully', 'success');
}
