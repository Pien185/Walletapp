// ==========================================================================
// CHART.JS VISUALIZATION MODULE
// ==========================================================================

let pieChartInstance = null;
let barChartInstance = null;

// Palette for expense categories (excluding Loan which is forced to Gray)
const CATEGORY_COLORS = [
  '#F43F5E', // Rose
  '#6366F1', // Indigo
  '#F59E0B', // Amber
  '#06B6D4', // Cyan
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#10B981', // Emerald
  '#3B82F6'  // Blue
];

const GRAY_COLOR = '#9CA3AF'; // Special color for Loan transactions (isLoan: true)

/**
 * Format currency number to VND string
 */
function formatVND(num) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num || 0);
}

/**
 * Render Pie Chart: Expense breakdown for active cycle
 * Requirements: Transactions with isLoan: true must be colored Gray (#9CA3AF)
 * @param {HTMLCanvasElement} canvas
 * @param {Array} transactions Active cycle transactions
 */
export function updateExpensePieChart(canvas, transactions) {
  if (!canvas) return;

  // Filter only expense transactions ("chi")
  const expenseTxs = transactions.filter(t => t.type === 'chi');

  if (expenseTxs.length === 0) {
    if (pieChartInstance) {
      pieChartInstance.destroy();
      pieChartInstance = null;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px Inter';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'center';
    ctx.fillText('Chưa có dữ liệu chi tiêu', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Group total amount by category and record whether category is loan
  const categoryTotals = {};
  const categoryIsLoan = {};

  expenseTxs.forEach(tx => {
    const cat = tx.category || 'Khác';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(tx.amount || 0);
    if (tx.isLoan || cat === 'Cho mượn') {
      categoryIsLoan[cat] = true;
    }
  });

  const labels = Object.keys(categoryTotals);
  const data = Object.values(categoryTotals);

  // Map background colors according to requirement: Loan categories MUST be Gray (#9CA3AF)
  let colorIndex = 0;
  const bgColors = labels.map(label => {
    if (categoryIsLoan[label] || label === 'Cho mượn') {
      return GRAY_COLOR;
    }
    const color = CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length];
    colorIndex++;
    return color;
  });

  // Destroy previous chart instance if exists
  if (pieChartInstance) {
    pieChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  pieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderWidth: 2,
        borderColor: '#1E293B',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94A3B8',
            font: { family: 'Inter', size: 12 },
            padding: 14,
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.raw || 0;
              return ` ${label}: ${formatVND(value)}`;
            }
          }
        }
      },
      cutout: '65%'
    }
  });
}

/**
 * Render Bar Chart: Multi-cycle comparison of Total Income vs Total Expense
 * @param {HTMLCanvasElement} canvas 
 * @param {Array} cycles List of all cycles
 * @param {Array} allTransactions All user transactions
 */
export function updateCyclesBarChart(canvas, cycles, allTransactions) {
  if (!canvas) return;

  if (cycles.length === 0) {
    if (barChartInstance) {
      barChartInstance.destroy();
      barChartInstance = null;
    }
    return;
  }

  // Calculate Total Income & Expense for each cycle
  const labels = [];
  const incomeData = [];
  const expenseData = [];

  cycles.forEach(cycle => {
    labels.push(cycle.name);
    
    const cycleTxs = allTransactions.filter(t => t.cycleId === cycle.id);
    let totalThu = 0;
    let totalChi = 0;

    cycleTxs.forEach(t => {
      if (t.type === 'thu') totalThu += Number(t.amount || 0);
      else if (t.type === 'chi') totalChi += Number(t.amount || 0);
    });

    incomeData.push(totalThu);
    expenseData.push(totalChi);
  });

  if (barChartInstance) {
    barChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Tổng Thu',
          data: incomeData,
          backgroundColor: '#10B981',
          borderRadius: 6
        },
        {
          label: 'Tổng Chi',
          data: expenseData,
          backgroundColor: '#F43F5E',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: '#94A3B8', font: { family: 'Inter', size: 11 } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y: {
          ticks: { 
            color: '#94A3B8', 
            font: { family: 'Inter', size: 10 },
            callback: function(val) {
              if (val >= 1000000) return (val / 1000000) + 'M ₫';
              if (val >= 1000) return (val / 1000) + 'k ₫';
              return val + ' ₫';
            }
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94A3B8', font: { family: 'Inter', size: 12 }, usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${formatVND(context.raw)}`;
            }
          }
        }
      }
    }
  });
}
