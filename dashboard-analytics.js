import { supabase } from './supabase-client.js';

let revenueChartInstance = null;
let volumeChartInstance = null;
let itemsChartInstance = null;

let allOrdersData = [];

document.addEventListener('DOMContentLoaded', () => {
    const rangeSelect = document.getElementById('analytics-date-range');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', () => {
            renderCharts();
        });
    }

    // Bind to the exact tab clicks
    const tabs = document.querySelectorAll('a[href="#analytics"], a[href="#overview"]');
    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            if (allOrdersData.length === 0) {
                await fetchAllOrdersData();
            }
            if (tab.getAttribute('href') === '#analytics') {
                renderCharts();
            }
            updateStatCards();
        });
    });
    
    // Initial fetch to populate overview card if it exists
    fetchAllOrdersData().then(() => updateStatCards());
});

async function fetchAllOrdersData() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('created_at, total, items, delivery_status');
        
        if (error) throw error;
        
        // We filter out cancelled orders for analytics goals
        allOrdersData = data.filter(o => o.delivery_status !== 'cancelled' && o.delivery_status !== 'pending'); 
        // Note: For bakery we might only count revenue from baked/delivered ones, or pending too? 
        // Let's count everything except cancelled.
        allOrdersData = data.filter(o => o.delivery_status !== 'cancelled');
    } catch (err) {
        console.error('Error fetching analytics data:', err);
    }
}

function updateStatCards() {
    const revWidget = document.getElementById('overview-revenue-val');
    if (!revWidget) return;

    // We can default the overview to all-time revenue or this month.
    // Let's do all-time total revenue for the widget.
    const totalRev = allOrdersData.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    revWidget.textContent = '$' + totalRev.toFixed(2);
}

function filterDataByDate(days) {
    const now = new Date();
    
    let filteredOrders = allOrdersData;
    if (days !== 'all') {
        const threshold = new Date(now.getTime() - (parseInt(days) * 24 * 60 * 60 * 1000));
        filteredOrders = allOrdersData.filter(o => new Date(o.created_at) >= threshold);
    }
    return { filteredOrders };
}

function renderCharts() {
    const days = document.getElementById('analytics-date-range')?.value || '7';
    const { filteredOrders } = filterDataByDate(days);

    // Prepare Daily Data Map
    const dailyMap = {};
    
    // Prepare Items Data Map
    const itemsMap = {};

    filteredOrders.forEach(o => {
        // Date handling
        const dateStr = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (!dailyMap[dateStr]) {
            dailyMap[dateStr] = { rev: 0, count: 0 };
        }
        dailyMap[dateStr].rev += (parseFloat(o.total) || 0);
        dailyMap[dateStr].count += 1;
        
        // Item handling 
        if (Array.isArray(o.items)) {
            o.items.forEach(item => {
                const name = item.name || 'Unknown Item';
                const qty = item.qty || item.quantity || 1;
                if (!itemsMap[name]) itemsMap[name] = 0;
                itemsMap[name] += qty;
            });
        }
    });

    // Create a complete date range list to avoid gaps
    const sortedDates = Object.keys(dailyMap).sort((a,b) => new Date(a) - new Date(b));
    let labels = sortedDates;
    let revData = sortedDates.map(d => dailyMap[d].rev);
    let volData = sortedDates.map(d => dailyMap[d].count);

    // Sort items (top 5)
    let sortedItems = Object.entries(itemsMap).map(([name, qty]) => ({name, qty}));
    sortedItems.sort((a,b) => b.qty - a.qty);
    sortedItems = sortedItems.slice(0, 5);
    
    const itemLabels = sortedItems.map(i => i.name);
    const itemData = sortedItems.map(i => i.qty);

    drawRevenueChart(labels, revData);
    drawVolumeChart(labels, volData);
    drawItemsChart(itemLabels, itemData);
}

function drawRevenueChart(labels, data) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    if (revenueChartInstance) {
        revenueChartInstance.destroy();
    }
    
    revenueChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue ($)',
                data: data,
                borderColor: '#002D62',
                backgroundColor: 'rgba(0, 45, 98, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function drawVolumeChart(labels, data) {
    const ctx = document.getElementById('volumeChart');
    if (!ctx) return;

    if (volumeChartInstance) {
        volumeChartInstance.destroy();
    }
    
    volumeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Orders',
                data: data,
                backgroundColor: '#F2994A'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function drawItemsChart(labels, data) {
    const ctx = document.getElementById('itemsChart');
    if (!ctx) return;

    if (itemsChartInstance) {
        itemsChartInstance.destroy();
    }
    
    if (data.length === 0) {
        // Clear or show empty
        return;
    }
    
    itemsChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#002D62', '#C8102E', '#F2994A', '#6B5057', '#1B5E20'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                }
            }
        }
    });
}
