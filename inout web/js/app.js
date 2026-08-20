// ==========================================================================
// MAIN APPLICATION & UI ORCHESTRATOR
// ==========================================================================

import { loginWithGoogle, logoutUser, initAuthObserver } from './auth.js';
import { 
  getActiveCycle, 
  endCurrentCycleAndStartNew, 
  getAllCycles,
  getCategoriesByType, 
  addCustomCategory, 
  addTransaction, 
  subscribeCycleTransactions, 
  subscribePendingLoans, 
  payLoanTransaction, 
  deleteTransaction,
  getAllUserTransactions
} from './db.js';
import { updateExpensePieChart, updateCyclesBarChart } from './charts.js';

// Application State Variables
let currentUser = null;
let activeCycle = null;
let currentType = 'chi'; // Default 'chi' (Expense)
let currentTransactions = [];
let pendingLoans = [];
let unsubscribeCycleTxs = null;
let unsubscribeLoans = null;

/* ==========================================================================
   HELPER UTILITIES
   ========================================================================== */

/**
 * Format currency number to Vietnamese Dong string
 */
function formatVND(num) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num || 0);
}

/**
 * Display toast notification
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconClass = 'fa-info-circle';
  if (type === 'success') iconClass = 'fa-check-circle';
  if (type === 'error') iconClass = 'fa-exclamation-circle';

  toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Format raw number input with thousands separators
 */
function setupAmountInputMask() {
  const amountInput = document.getElementById('input-amount');
  if (!amountInput) return;

  amountInput.addEventListener('input', (e) => {
    let rawValue = e.target.value.replace(/\D/g, '');
    if (rawValue) {
      e.target.value = parseInt(rawValue, 10).toLocaleString('vi-VN');
    } else {
      e.target.value = '';
    }
  });
}

/**
 * Get current GPS coordinates from browser Geolocation API
 */
async function getCurrentGPSLocation() {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      (error) => {
        console.warn("Không thể tự động lấy GPS:", error.message);
        resolve(null);
      },
      { timeout: 6000, enableHighAccuracy: true }
    );
  });
}

/**
 * Get numeric amount from formatted input
 */
function getRawAmountValue() {
  const amountInput = document.getElementById('input-amount');
  if (!amountInput || !amountInput.value) return 0;
  return parseInt(amountInput.value.replace(/\D/g, ''), 10) || 0;
}

/* ==========================================================================
   UI CONTROLLERS & DATA SYNC
   ========================================================================== */

/**
 * Initialize app upon user login
 */
async function onUserLoggedIn(user) {
  currentUser = user;
  console.log("Người dùng đã đăng nhập:", user.displayName);

  try {
    // 1. Fetch current active cycle
    activeCycle = await getActiveCycle(currentUser.uid);
    updateCycleHeaderDisplay();

    // 2. Load categories for current form type
    await populateCategoryDropdown(currentType);

    // 3. Set default date to today & handle 'Hiện tại' checkbox
    const dateInput = document.getElementById('input-date');
    const checkboxNow = document.getElementById('checkbox-now');
    const todayStr = new Date().toISOString().split('T')[0];

    if (dateInput) {
      dateInput.value = todayStr;
    }

    if (checkboxNow && dateInput) {
      checkboxNow.addEventListener('change', (e) => {
        if (e.target.checked) {
          dateInput.value = new Date().toISOString().split('T')[0];
          dateInput.disabled = true;
        } else {
          dateInput.disabled = false;
        }
      });
    }

    // 4. Subscribe to active cycle transactions
    subscribeToActiveCycle();

    // 5. Subscribe to pending loans
    subscribeToLoans();

    // 6. Refresh charts
    refreshCharts();
  } catch (err) {
    console.error("Lỗi tải dữ liệu người dùng:", err);
    showToast("Không thể tải dữ liệu. Vui lòng thử lại!", "error");
  }
}

/**
 * Cleanup app upon user logout
 */
function onUserLoggedOut() {
  currentUser = null;
  activeCycle = null;
  currentTransactions = [];
  pendingLoans = [];

  if (unsubscribeCycleTxs) unsubscribeCycleTxs();
  if (unsubscribeLoans) unsubscribeLoans();

  console.log("Người dùng đã đăng xuất");
}

/**
 * Update header with active cycle name
 */
function updateCycleHeaderDisplay() {
  const cycleDisplay = document.getElementById('cycle-name-display');
  if (cycleDisplay && activeCycle) {
    cycleDisplay.textContent = activeCycle.name;
  }
}

/**
 * Populate Category select element based on type ("chi" or "thu")
 */
async function populateCategoryDropdown(type) {
  if (!currentUser) return;
  const select = document.getElementById('select-category');
  if (!select) return;

  select.innerHTML = '<option value="" disabled selected>-- Chọn danh mục --</option>';

  const categories = await getCategoriesByType(currentUser.uid, type);
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });
}

/**
 * Subscribe real-time listener to active cycle transactions
 */
function subscribeToActiveCycle() {
  if (!currentUser || !activeCycle) return;

  if (unsubscribeCycleTxs) unsubscribeCycleTxs();

  unsubscribeCycleTxs = subscribeCycleTransactions(currentUser.uid, activeCycle.id, (txs) => {
    currentTransactions = txs;
    renderTransactionsHistoryList(txs);
    renderCycleSummaryBanner(txs);
    refreshCharts();
  });
}

/**
 * Subscribe real-time listener to pending loans
 */
function subscribeToLoans() {
  if (!currentUser) return;

  if (unsubscribeLoans) unsubscribeLoans();

  unsubscribeLoans = subscribePendingLoans(currentUser.uid, (loans) => {
    pendingLoans = loans;
    updateLoanBadge(loans.length);
    renderLoanBookModalItems(loans);
  });
}

/**
 * Render Financial Summary Banner (Tab 2: History)
 */
function renderCycleSummaryBanner(txs) {
  let totalThu = 0;
  let totalChi = 0;

  txs.forEach(t => {
    if (t.type === 'thu') totalThu += Number(t.amount || 0);
    else if (t.type === 'chi') totalChi += Number(t.amount || 0);
  });

  const balance = totalThu - totalChi;

  const totalThuEl = document.getElementById('summary-total-thu');
  const totalChiEl = document.getElementById('summary-total-chi');
  const balanceEl = document.getElementById('summary-balance');

  if (totalThuEl) totalThuEl.textContent = formatVND(totalThu);
  if (totalChiEl) totalChiEl.textContent = formatVND(totalChi);
  if (balanceEl) balanceEl.textContent = formatVND(balance);
}

/**
 * Render Chronological History List (Tab 2: History)
 */
function renderTransactionsHistoryList(txs) {
  const container = document.getElementById('transactions-list');
  if (!container) return;

  if (txs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-receipt" style="font-size: 32px; color: #64748B; margin-bottom: 8px;"></i>
        <p>Chưa có giao dịch nào trong kỳ này.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  txs.forEach(tx => {
    const item = document.createElement('div');
    item.className = 'tx-item';

    const isLoanTx = tx.isLoan || tx.category === 'Cho mượn';
    let iconTypeClass = tx.type;
    let iconSymbol = tx.type === 'thu' ? 'fa-arrow-up' : 'fa-arrow-down';
    if (isLoanTx) {
      iconTypeClass = 'loan';
      iconSymbol = 'fa-hand-holding-dollar';
    }

    const txDate = tx.date ? new Date(tx.date.toDate()).toLocaleDateString('vi-VN') : '';
    const formattedAmount = `${tx.type === 'thu' ? '+' : '-'}${formatVND(tx.amount)}`;

    let loanTagHTML = '';
    if (isLoanTx) {
      const statusText = tx.loanStatus === 'đã_trả' ? 'Đã trả' : 'Chưa thu';
      const statusClass = tx.loanStatus === 'đã_trả' ? 'paid' : 'pending';
      loanTagHTML = `<span class="loan-tag ${statusClass}">${statusText}</span>`;
    }

    let locationHTML = '';
    if (tx.location && tx.location.latitude && tx.location.longitude) {
      const lat = Number(tx.location.latitude).toFixed(4);
      const lng = Number(tx.location.longitude).toFixed(4);
      const mapsUrl = `https://www.google.com/maps?q=${tx.location.latitude},${tx.location.longitude}`;
      locationHTML = `
        <a href="${mapsUrl}" target="_blank" class="tx-location-link" title="Xem vị trí trên Google Maps">
          <i class="fa-solid fa-location-dot"></i> ${lat}, ${lng}
        </a>
      `;
    }

    item.innerHTML = `
      <div class="tx-left">
        <div class="tx-icon ${iconTypeClass}">
          <i class="fa-solid ${iconSymbol}"></i>
        </div>
        <div class="tx-details">
          <span class="tx-cat">${tx.category}</span>
          ${tx.note ? `<span class="tx-note">${tx.note}</span>` : ''}
          <span class="tx-date">${txDate}</span>
          ${locationHTML}
        </div>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${iconTypeClass}">${formattedAmount}</span>
        ${loanTagHTML}
        <button class="btn-delete-tx" data-id="${tx.id}" title="Xóa giao dịch">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // Attach delete listener
    const deleteBtn = item.querySelector('.btn-delete-tx');
    deleteBtn.addEventListener('click', () => handleDeleteTransaction(tx.id));

    container.appendChild(item);
  });
}

/**
 * Handle Transaction Deletion
 */
async function handleDeleteTransaction(txId) {
  if (!confirm("Bạn có chắc muốn xóa giao dịch này không?")) return;
  try {
    await deleteTransaction(currentUser.uid, txId);
    showToast("Đã xóa giao dịch", "success");
  } catch (err) {
    showToast("Không thể xóa giao dịch", "error");
  }
}

/**
 * Update Pending Loans Badge Count
 */
function updateLoanBadge(count) {
  const badge = document.getElementById('loan-count-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/**
 * Render Pending Loans inside Modal (Sổ Nợ)
 */
function renderLoanBookModalItems(loans) {
  const container = document.getElementById('loan-items-list');
  if (!container) return;

  if (loans.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-circle-check" style="font-size: 36px; color: #10B981; margin-bottom: 8px;"></i>
        <p>Tuyệt vời! Không có khoản nợ nào chưa thu.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  loans.forEach(loan => {
    const card = document.createElement('div');
    card.className = 'loan-card';

    const loanDate = loan.date ? new Date(loan.date.toDate()).toLocaleDateString('vi-VN') : '';

    card.innerHTML = `
      <div class="loan-card-info">
        <span class="loan-card-note">${loan.note || 'Cho mượn tiền'}</span>
        <span class="loan-card-date">Ngày cho mượn: ${loanDate}</span>
        <span class="loan-card-amount">${formatVND(loan.amount)}</span>
      </div>
      <button class="btn-pay-loan" data-id="${loan.id}">
        <i class="fa-solid fa-check"></i> Đã Trả
      </button>
    `;

    // Attach "Đã trả" click listener
    const payBtn = card.querySelector('.btn-pay-loan');
    payBtn.addEventListener('click', () => handlePayLoan(loan));

    container.appendChild(card);
  });
}

/**
 * Handle Loan Repayment Action ("Đã trả")
 * Requirements:
 * 1. Change original transaction loanStatus to "đã_trả"
 * 2. Generate a NEW Income transaction ("Thu hồi nợ") tied to CURRENT active cycle
 */
async function handlePayLoan(loan) {
  if (!currentUser || !activeCycle) return;
  try {
    await payLoanTransaction(currentUser.uid, loan, activeCycle.id);
    showToast(`Đã thu hồi khoản nợ ${formatVND(loan.amount)}!`, "success");
  } catch (err) {
    console.error("Lỗi cập nhật trả nợ:", err);
    showToast("Lỗi xử lý trả nợ. Vui lòng thử lại!", "error");
  }
}

/**
 * Refresh Chart Visualizations (Tab 3: Statistics)
 */
async function refreshCharts() {
  if (!currentUser) return;

  const pieCanvas = document.getElementById('chart-pie-expense');
  const barCanvas = document.getElementById('chart-bar-cycles');

  // Update Pie Chart for active cycle
  if (pieCanvas) {
    updateExpensePieChart(pieCanvas, currentTransactions);
  }

  // Update Bar Chart for multi-cycle comparison
  if (barCanvas) {
    const allCycles = await getAllCycles(currentUser.uid);
    const allTxs = await getAllUserTransactions(currentUser.uid);
    updateCyclesBarChart(barCanvas, allCycles, allTxs);
  }
}

/* ==========================================================================
   EVENT LISTENERS INITIALIZATION
   ========================================================================== */

function setupEventListeners() {
  // 1. Google Sign-In & Logout Buttons
  const loginBtn = document.getElementById('btn-login-google');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      try {
        await loginWithGoogle();
        showToast("Đăng nhập thành công!", "success");
      } catch (err) {
        showToast("Đăng nhập thất bại!", "error");
      }
    });
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
      showToast("Đã đăng xuất", "info");
    });
  }

  // 2. Tab Navigation Bar Switching
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTabId = item.getAttribute('data-tab');

      // Update nav active styling
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Update tab content visibility
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
      });

      const targetTab = document.getElementById(targetTabId);
      if (targetTab) targetTab.classList.add('active');

      // Refresh charts if opening statistics tab
      if (targetTabId === 'tab-stats') {
        refreshCharts();
      }
    });
  });

  // 3. Type Switch Buttons (CHI TIÊU vs THU NHẬP)
  const btnChi = document.getElementById('type-chi');
  const btnThu = document.getElementById('type-thu');

  if (btnChi && btnThu) {
    btnChi.addEventListener('click', async () => {
      currentType = 'chi';
      btnChi.className = 'switch-btn active-chi';
      btnThu.className = 'switch-btn';
      await populateCategoryDropdown('chi');
    });

    btnThu.addEventListener('click', async () => {
      currentType = 'thu';
      btnThu.className = 'switch-btn active-thu';
      btnChi.className = 'switch-btn';
      await populateCategoryDropdown('thu');
    });
  }

  // 4. Setup Currency Input Masking
  setupAmountInputMask();

  // 5. Submit Transaction Form
  const formTx = document.getElementById('form-transaction');
  if (formTx) {
    formTx.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser || !activeCycle) {
        showToast("Chưa xác định kỳ tài chính!", "error");
        return;
      }

      const amount = getRawAmountValue();
      const categorySelect = document.getElementById('select-category');
      const category = categorySelect ? categorySelect.value : '';
      const noteInput = document.getElementById('input-note');
      const note = noteInput ? noteInput.value : '';
      const dateInput = document.getElementById('input-date');
      const checkboxNow = document.getElementById('checkbox-now');
      const checkboxGps = document.getElementById('checkbox-gps');
      const gpsStatusText = document.getElementById('gps-status-text');

      // 1. Calculate Date Timestamp
      let txDate;
      if (checkboxNow && checkboxNow.checked) {
        txDate = new Date();
      } else {
        txDate = (dateInput && dateInput.value) ? new Date(dateInput.value) : new Date();
      }

      if (amount <= 0) {
        showToast("Vui lòng nhập số tiền hợp lệ lớn hơn 0!", "error");
        return;
      }

      if (!category) {
        showToast("Vui lòng chọn danh mục!", "error");
        return;
      }

      // 2. Fetch GPS location if checkbox is checked
      let location = null;
      if (checkboxGps && checkboxGps.checked) {
        if (gpsStatusText) gpsStatusText.textContent = "Đang lấy vị trí GPS...";
        location = await getCurrentGPSLocation();
        if (gpsStatusText) {
          if (location) {
            gpsStatusText.textContent = `Đã định vị: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
          } else {
            gpsStatusText.textContent = "Không thể lấy GPS (chưa cấp quyền)";
          }
        }
      }

      try {
        await addTransaction(currentUser.uid, {
          amount,
          type: currentType,
          category,
          note,
          date: txDate,
          cycleId: activeCycle.id,
          location
        });

        showToast(location ? "Đã lưu giao dịch & đính kèm vị trí GPS!" : "Đã lưu giao dịch thành công!", "success");

        // Reset Form Fields
        document.getElementById('input-amount').value = '';
        if (noteInput) noteInput.value = '';
        categorySelect.selectedIndex = 0;
        if (gpsStatusText) gpsStatusText.textContent = "Tự động lấy vị trí khi lưu";

      } catch (err) {
        showToast("Lỗi lưu giao dịch!", "error");
      }
    });
  }

  // 6. Modal Open/Close Controls
  // Sổ nợ Modal Trigger
  const btnOpenLoanModal = document.getElementById('btn-open-loan-modal');
  if (btnOpenLoanModal) {
    btnOpenLoanModal.addEventListener('click', () => {
      document.getElementById('modal-loans').classList.remove('hidden');
    });
  }

  // Add Category Modal Trigger
  const btnAddCatModal = document.getElementById('btn-add-category-modal');
  if (btnAddCatModal) {
    btnAddCatModal.addEventListener('click', () => {
      const typeSelect = document.getElementById('new-cat-type');
      if (typeSelect) typeSelect.value = currentType;
      document.getElementById('modal-add-category').classList.remove('hidden');
    });
  }

  // End Cycle Modal Trigger
  const btnEndCycle = document.getElementById('btn-end-cycle');
  if (btnEndCycle) {
    btnEndCycle.addEventListener('click', () => {
      document.getElementById('modal-confirm-end-cycle').classList.remove('hidden');
    });
  }

  // Generic Close Modal Buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetModalId = btn.getAttribute('data-close');
      const modal = document.getElementById(targetModalId);
      if (modal) modal.classList.add('hidden');
    });
  });

  // 7. Add Custom Category Form Submit
  const formAddCat = document.getElementById('form-add-category');
  if (formAddCat) {
    formAddCat.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const catNameInput = document.getElementById('new-cat-name');
      const catName = catNameInput ? catNameInput.value : '';

      if (!catName.trim()) {
        showToast("Vui lòng nhập tên danh mục!", "error");
        return;
      }

      try {
        await addCustomCategory(currentUser.uid, catName, currentType);
        showToast("Tạo danh mục mới thành công!", "success");
        catNameInput.value = '';
        document.getElementById('modal-add-category').classList.add('hidden');
        await populateCategoryDropdown(currentType);
      } catch (err) {
        showToast("Lỗi thêm danh mục mới!", "error");
      }
    });
  }

  // 8. Confirm End Cycle Action ("Kết thúc tháng")
  const btnConfirmEndCycle = document.getElementById('btn-confirm-end-cycle-action');
  if (btnConfirmEndCycle) {
    btnConfirmEndCycle.addEventListener('click', async () => {
      if (!currentUser || !activeCycle) return;

      try {
        // End current cycle and start a new active cycle
        const newCycle = await endCurrentCycleAndStartNew(currentUser.uid, activeCycle.id);
        activeCycle = newCycle;

        updateCycleHeaderDisplay();
        document.getElementById('modal-confirm-end-cycle').classList.add('hidden');

        // Re-subscribe listeners to new active cycle
        subscribeToActiveCycle();

        showToast("Đã đóng kỳ cũ & chuyển sang kỳ tài chính mới!", "success");
      } catch (err) {
        console.error("Lỗi đóng kỳ:", err);
        showToast("Lỗi khi kết thúc tháng!", "error");
      }
    });
  }
}

/* ==========================================================================
   APP BOOTSTRAP
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI event listeners
  setupEventListeners();

  // Initialize Firebase Auth State Observer
  initAuthObserver(onUserLoggedIn, onUserLoggedOut);
});
