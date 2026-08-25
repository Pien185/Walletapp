// ==========================================================================
// MAIN APPLICATION & UI ORCHESTRATOR
// Real-time Firestore Sync, 2-Way Debt Book & auth.txt Login System
// ==========================================================================

import { loginWithCredentials, logoutUser, initAuthObserver } from './auth.js';
import { 
  DEFAULT_SYSTEM_CATEGORIES,
  getActiveCycle, 
  endCurrentCycleAndStartNew, 
  getAllCycles,
  getCategoriesByType, 
  addCustomCategory, 
  clearAllSystemCategories,
  addTransaction, 
  updateTransaction,
  deleteTransaction,
  subscribeCycleTransactions, 
  subscribeAllLoans, 
  payLoanTransaction,
  payBorrowLoanTransaction,
  getAllTransactions
} from './db.js';
import { updateExpensePieChart, updateCyclesBarChart } from './charts.js';

// Application State Variables
let currentUser = null;
let activeCycle = null;
let currentType = 'chi'; // Default 'chi' (Expense) for main form
let editFormType = 'chi'; // Type for Edit Modal
let currentTransactions = [];
let currentLoanTab = 'lend'; // 'lend' (Cho mượn) | 'borrow' (Tôi nợ)
let cachedLendLoans = [];
let cachedBorrowLoans = [];
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
function setupAmountInputMask(inputId) {
  const amountInput = document.getElementById(inputId);
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
 * Get numeric amount from formatted input
 */
function getRawAmountValue(inputId) {
  const amountInput = document.getElementById(inputId);
  if (!amountInput || !amountInput.value) return 0;
  return parseInt(amountInput.value.replace(/\D/g, ''), 10) || 0;
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
      { timeout: 5000, enableHighAccuracy: true }
    );
  });
}

/* ==========================================================================
   UI CONTROLLERS & DATA SYNC
   ========================================================================== */

/**
 * Populate Category select element with user-created categories from Firestore
 */
async function populateCategoryDropdown(selectId, type, selectedCategory = '') {
  const select = document.getElementById(selectId);
  if (!select) return;

  try {
    const categories = await getCategoriesByType(type);
    if (categories && categories.length > 0) {
      select.innerHTML = `<option value="" disabled ${!selectedCategory ? 'selected' : ''}>-- Chọn danh mục --</option>`;
      categories.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.name;
        opt.textContent = cat.name;
        if (selectedCategory && cat.name === selectedCategory) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    } else {
      select.innerHTML = '<option value="" disabled selected>-- Chưa có danh mục (Bấm + Danh mục mới) --</option>';
    }
  } catch (err) {
    select.innerHTML = '<option value="" disabled selected>-- Chưa có danh mục (Bấm + Danh mục mới) --</option>';
  }
}

/**
 * Update header with active cycle name
 */
function updateCycleHeaderDisplay() {
  const cycleDisplay = document.getElementById('cycle-name-display');
  if (cycleDisplay) {
    if (activeCycle && activeCycle.name) {
      cycleDisplay.textContent = activeCycle.name;
    } else {
      const now = new Date();
      cycleDisplay.textContent = `Kỳ 1 (${now.getMonth() + 1}/${now.getFullYear()})`;
    }
  }
}

/**
 * Initialize app upon user login
 */
async function onUserLoggedIn(user) {
  currentUser = user;
  console.log("Khởi chạy phiên làm việc cho:", user.username || user.displayName);

  // 1. Initial UI display
  const now = new Date();
  if (!activeCycle) {
    activeCycle = {
      id: 'active_cycle',
      name: `Kỳ 1 (${now.getMonth() + 1}/${now.getFullYear()})`,
      isActive: true
    };
  }
  updateCycleHeaderDisplay();

  // 2. Clear any old default system categories and load user categories
  clearAllSystemCategories().then(() => {
    populateCategoryDropdown('select-category', currentType);
  }).catch(() => {
    populateCategoryDropdown('select-category', currentType);
  });

  // 3. Fetch active cycle from Firestore in background
  try {
    const fetchedCycle = await getActiveCycle();
    if (fetchedCycle) {
      activeCycle = fetchedCycle;
      updateCycleHeaderDisplay();
    }
  } catch (e) {
    console.warn("Sử dụng kỳ tài chính mặc định");
  }

  // 4. Subscribe to active cycle transactions with real-time onSnapshot
  subscribeToActiveCycle();

  // 5. Subscribe to 2-way pending loans with real-time onSnapshot
  subscribeToLoans();

  // 6. Refresh charts
  refreshCharts();
}

/**
 * Cleanup app upon user logout
 */
function onUserLoggedOut() {
  currentUser = null;
  activeCycle = null;
  currentTransactions = [];
  cachedLendLoans = [];
  cachedBorrowLoans = [];

  if (unsubscribeCycleTxs) unsubscribeCycleTxs();
  if (unsubscribeLoans) unsubscribeLoans();

  console.log("Đã kết thúc phiên làm việc");
}

/**
 * Subscribe real-time listener to active cycle transactions on Firestore
 */
function subscribeToActiveCycle() {
  if (!activeCycle) return;

  if (unsubscribeCycleTxs) unsubscribeCycleTxs();

  unsubscribeCycleTxs = subscribeCycleTransactions(activeCycle.id, (txs) => {
    currentTransactions = txs;
    renderTransactionsHistoryList(txs);
    renderCycleSummaryBanner(txs);
    refreshCharts();
  });
}

/**
 * Subscribe real-time listener to 2-way pending loans on Firestore
 */
function subscribeToLoans() {
  if (unsubscribeLoans) unsubscribeLoans();

  unsubscribeLoans = subscribeAllLoans(({ lendLoans, borrowLoans, allLoans }) => {
    cachedLendLoans = lendLoans;
    cachedBorrowLoans = borrowLoans;
    updateLoanBadges(lendLoans.length, borrowLoans.length, allLoans.length);
    renderLoanBookModalContent();
  });
}

/**
 * Update Pending Loans Badges
 */
function updateLoanBadges(lendCount, borrowCount, totalCount) {
  const mainBadge = document.getElementById('loan-count-badge');
  const lendBadge = document.getElementById('lend-count-badge');
  const borrowBadge = document.getElementById('borrow-count-badge');

  if (mainBadge) {
    if (totalCount > 0) {
      mainBadge.textContent = totalCount;
      mainBadge.classList.remove('hidden');
    } else {
      mainBadge.classList.add('hidden');
    }
  }

  if (lendBadge) lendBadge.textContent = lendCount;
  if (borrowBadge) borrowBadge.textContent = borrowCount;
}

/**
 * Render 2-Way Loan Book Modal Content based on active tab
 */
function renderLoanBookModalContent() {
  const container = document.getElementById('loan-items-list');
  const summaryBar = document.getElementById('loan-summary-bar');
  const summaryTotal = document.getElementById('loan-summary-total');
  const summaryLabel = summaryBar?.querySelector('.loan-summary-label');

  if (!container) return;

  const isLendTab = (currentLoanTab === 'lend');
  const items = isLendTab ? cachedLendLoans : cachedBorrowLoans;

  // Update Summary Bar
  if (summaryBar && summaryTotal && summaryLabel) {
    summaryBar.className = `loan-summary-bar ${isLendTab ? 'lend' : 'borrow'}`;
    summaryLabel.textContent = isLendTab ? 'Tổng tiền người khác nợ tôi:' : 'Tổng tiền tôi đang nợ người khác:';
    
    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    summaryTotal.textContent = formatVND(totalAmount);
  }

  // Render Empty State
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-circle-check" style="font-size: 36px; color: #10B981; margin-bottom: 8px;"></i>
        <p>${isLendTab ? 'Không có ai nợ bạn khoản nào.' : 'Tuyệt vời! Bạn không nợ ai khoản nào.'}</p>
      </div>
    `;
    return;
  }

  // Render Items List
  container.innerHTML = '';

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = `loan-card ${isLendTab ? 'lend' : 'borrow'}`;

    const loanDate = item.date?.toDate ? new Date(item.date.toDate()).toLocaleDateString('vi-VN') : (item.date ? new Date(item.date).toLocaleDateString('vi-VN') : '');
    const defaultTitle = isLendTab ? 'Khoản cho mượn' : 'Khoản đi vay';

    const buttonHtml = isLendTab ? `
      <button class="btn-pay-loan" data-id="${item.id}">
        <i class="fa-solid fa-check"></i> Đã Thu Nợ
      </button>
    ` : `
      <button class="btn-pay-borrow" data-id="${item.id}">
        <i class="fa-solid fa-check-double"></i> Đã Trả Nợ
      </button>
    `;

    card.innerHTML = `
      <div class="loan-card-info">
        <span class="loan-card-note">${item.note || defaultTitle}</span>
        <span class="loan-card-date">${isLendTab ? 'Ngày cho mượn' : 'Ngày vay'}: ${loanDate}</span>
        <span class="loan-card-amount">${formatVND(item.amount)}</span>
      </div>
      ${buttonHtml}
    `;

    // Attach Click Handler
    if (isLendTab) {
      const payBtn = card.querySelector('.btn-pay-loan');
      if (payBtn) payBtn.addEventListener('click', () => handlePayLendLoan(item));
    } else {
      const payBorrowBtn = card.querySelector('.btn-pay-borrow');
      if (payBorrowBtn) payBorrowBtn.addEventListener('click', () => handlePayBorrowLoan(item));
    }

    container.appendChild(card);
  });
}

/**
 * Handle Loan Repayment Action for "Cho mượn" (Thu nợ từ người khác)
 */
async function handlePayLendLoan(loan) {
  if (!activeCycle) return;
  try {
    await payLoanTransaction(loan, activeCycle.id);
    showToast(`Đã ghi nhận thu hồi khoản nợ ${formatVND(loan.amount)}!`, "success");
  } catch (err) {
    console.error("Lỗi cập nhật thu nợ:", err);
    showToast("Lỗi xử lý thu nợ. Vui lòng thử lại!", "error");
  }
}

/**
 * Handle Loan Repayment Action for "Tôi nợ" (Tôi trả nợ cho người khác)
 */
async function handlePayBorrowLoan(loan) {
  if (!activeCycle) return;
  try {
    await payBorrowLoanTransaction(loan, activeCycle.id);
    showToast(`Đã ghi nhận trả khoản nợ ${formatVND(loan.amount)}!`, "success");
  } catch (err) {
    console.error("Lỗi cập nhật trả nợ:", err);
    showToast("Lỗi xử lý trả nợ. Vui lòng thử lại!", "error");
  }
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

    const isLend = tx.isLoan && (tx.loanKind === 'lend' || tx.category === 'Cho mượn');
    const isBorrow = tx.isLoan && (tx.loanKind === 'borrow' || tx.category === 'Đi vay');

    let iconTypeClass = tx.type;
    let iconSymbol = tx.type === 'thu' ? 'fa-arrow-up' : 'fa-arrow-down';
    if (isLend) {
      iconTypeClass = 'loan';
      iconSymbol = 'fa-hand-holding-dollar';
    } else if (isBorrow) {
      iconTypeClass = 'loan';
      iconSymbol = 'fa-file-invoice-dollar';
    }

    const txDate = tx.date?.toDate ? new Date(tx.date.toDate()).toLocaleDateString('vi-VN') : (tx.date ? new Date(tx.date).toLocaleDateString('vi-VN') : '');
    const formattedAmount = `${tx.type === 'thu' ? '+' : '-'}${formatVND(tx.amount)}`;

    let loanTagHTML = '';
    if (isLend || isBorrow) {
      const statusText = tx.loanStatus === 'đã_trả' ? (isLend ? 'Đã thu' : 'Đã trả') : (isLend ? 'Chưa thu' : 'Chưa trả');
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
        <div class="tx-actions">
          <button class="btn-edit-tx" data-id="${tx.id}" title="Sửa giao dịch">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn-delete-tx" data-id="${tx.id}" title="Xóa giao dịch">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;

    // Attach Edit listener
    const editBtn = item.querySelector('.btn-edit-tx');
    if (editBtn) {
      editBtn.addEventListener('click', () => openEditTransactionModal(tx));
    }

    // Attach Delete listener
    const deleteBtn = item.querySelector('.btn-delete-tx');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => handleDeleteTransaction(tx.id));
    }

    container.appendChild(item);
  });
}

/**
 * Open Modal to edit a transaction
 */
async function openEditTransactionModal(tx) {
  const modal = document.getElementById('modal-edit-transaction');
  if (!modal) return;

  // Set fields
  document.getElementById('edit-tx-id').value = tx.id;
  document.getElementById('edit-amount').value = Number(tx.amount || 0).toLocaleString('vi-VN');
  document.getElementById('edit-note').value = tx.note || '';

  // Format date to YYYY-MM-DD
  let dateVal = '';
  if (tx.date?.toDate) {
    dateVal = tx.date.toDate().toISOString().split('T')[0];
  } else if (tx.date) {
    dateVal = new Date(tx.date).toISOString().split('T')[0];
  }
  document.getElementById('edit-date').value = dateVal;

  // Set Edit Type
  editFormType = tx.type || 'chi';
  const btnEditChi = document.getElementById('edit-type-chi');
  const btnEditThu = document.getElementById('edit-type-thu');

  if (editFormType === 'thu') {
    btnEditThu.className = 'switch-btn active-thu';
    btnEditChi.className = 'switch-btn';
  } else {
    btnEditChi.className = 'switch-btn active-chi';
    btnEditThu.className = 'switch-btn';
  }

  // Populate Categories and select current category
  await populateCategoryDropdown('edit-category', editFormType, tx.category);

  modal.classList.remove('hidden');
}

/**
 * Handle Transaction Deletion with Document ID on Firestore
 */
async function handleDeleteTransaction(txId) {
  if (!confirm("Bạn có chắc muốn xóa giao dịch này khỏi Firestore không?")) return;
  try {
    await deleteTransaction(txId);
    showToast("Đã xóa giao dịch thành công!", "success");
  } catch (err) {
    console.error("Lỗi xóa giao dịch:", err);
    showToast("Không thể xóa giao dịch trên Firestore!", "error");
  }
}

/**
 * Refresh Chart Visualizations (Tab 3: Statistics)
 */
async function refreshCharts() {
  const pieCanvas = document.getElementById('chart-pie-expense');
  const barCanvas = document.getElementById('chart-bar-cycles');

  // Update Pie Chart for active cycle
  if (pieCanvas) {
    updateExpensePieChart(pieCanvas, currentTransactions);
  }

  // Update Bar Chart for multi-cycle comparison
  if (barCanvas) {
    const allCycles = await getAllCycles();
    const allTxs = await getAllTransactions();
    updateCyclesBarChart(barCanvas, allCycles, allTxs);
  }
}

/* ==========================================================================
   EVENT LISTENERS INITIALIZATION
   ========================================================================== */

function setupEventListeners() {
  // Set default date to today immediately
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

  // 1. Username & Password Login Form Submit
  const formLogin = document.getElementById('form-login');
  const loginErrorMsg = document.getElementById('login-error-msg');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username').value;
      const passwordInput = document.getElementById('login-password').value;

      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

      try {
        const user = await loginWithCredentials(usernameInput, passwordInput);
        showToast("Đăng nhập thành công!", "success");
        initAuthObserver(onUserLoggedIn, onUserLoggedOut);
      } catch (err) {
        if (loginErrorMsg) {
          loginErrorMsg.querySelector('span').textContent = err.message || "Tên đăng nhập hoặc mật khẩu không đúng!";
          loginErrorMsg.classList.remove('hidden');
        }
      }
    });
  }

  // Toggle Password Visibility Button
  const btnTogglePw = document.getElementById('btn-toggle-password');
  const loginPwInput = document.getElementById('login-password');
  if (btnTogglePw && loginPwInput) {
    btnTogglePw.addEventListener('click', () => {
      const isPassword = (loginPwInput.type === 'password');
      loginPwInput.type = isPassword ? 'text' : 'password';
      btnTogglePw.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });
  }

  // Logout Button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm("Bạn có chắc muốn đăng xuất không?")) {
        logoutUser();
      }
    });
  }

  // 2. Tab Navigation Bar Switching (Bottom Nav)
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

  // 3. Type Switch Buttons in Input Tab (CHI TIÊU vs THU NHẬP)
  const btnChi = document.getElementById('type-chi');
  const btnThu = document.getElementById('type-thu');

  if (btnChi && btnThu) {
    btnChi.addEventListener('click', () => {
      currentType = 'chi';
      btnChi.className = 'switch-btn active-chi';
      btnThu.className = 'switch-btn';
      populateCategoryDropdown('select-category', 'chi');
    });

    btnThu.addEventListener('click', () => {
      currentType = 'thu';
      btnThu.className = 'switch-btn active-thu';
      btnChi.className = 'switch-btn';
      populateCategoryDropdown('select-category', 'thu');
    });
  }

  // 4. Edit Modal Type Switch Buttons
  const btnEditChi = document.getElementById('edit-type-chi');
  const btnEditThu = document.getElementById('edit-type-thu');

  if (btnEditChi && btnEditThu) {
    btnEditChi.addEventListener('click', () => {
      editFormType = 'chi';
      btnEditChi.className = 'switch-btn active-chi';
      btnEditThu.className = 'switch-btn';
      populateCategoryDropdown('edit-category', 'chi');
    });

    btnEditThu.addEventListener('click', () => {
      editFormType = 'thu';
      btnEditThu.className = 'switch-btn active-thu';
      btnEditChi.className = 'switch-btn';
      populateCategoryDropdown('edit-category', 'thu');
    });
  }

  // 5. Loan Modal 2-Tab Switching (Cho mượn vs Tôi nợ)
  const tabBtnLend = document.getElementById('tab-loan-lend');
  const tabBtnBorrow = document.getElementById('tab-loan-borrow');

  if (tabBtnLend && tabBtnBorrow) {
    tabBtnLend.addEventListener('click', () => {
      currentLoanTab = 'lend';
      tabBtnLend.classList.add('active');
      tabBtnBorrow.classList.remove('active');
      renderLoanBookModalContent();
    });

    tabBtnBorrow.addEventListener('click', () => {
      currentLoanTab = 'borrow';
      tabBtnBorrow.classList.add('active');
      tabBtnLend.classList.remove('active');
      renderLoanBookModalContent();
    });
  }

  // 6. Setup Currency Input Masking for both main and edit forms
  setupAmountInputMask('input-amount');
  setupAmountInputMask('edit-amount');

  // 7. Submit Transaction Form (Add New)
  const formTx = document.getElementById('form-transaction');
  if (formTx) {
    formTx.addEventListener('submit', async (e) => {
      e.preventDefault();

      const amount = getRawAmountValue('input-amount');
      const categorySelect = document.getElementById('select-category');
      const category = categorySelect ? categorySelect.value : '';
      const noteInput = document.getElementById('input-note');
      const note = noteInput ? noteInput.value : '';
      const dateInput = document.getElementById('input-date');
      const checkboxNow = document.getElementById('checkbox-now');
      const checkboxGps = document.getElementById('checkbox-gps');
      const gpsStatusText = document.getElementById('gps-status-text');

      // Calculate Date Timestamp
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

      // Fetch GPS location if checkbox is checked
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
        await addTransaction({
          amount,
          type: currentType,
          category,
          note,
          date: txDate,
          cycleId: activeCycle ? activeCycle.id : 'active_cycle',
          location,
          userId: currentUser ? (currentUser.username || currentUser.uid) : 'default_user'
        });

        showToast(location ? "Đã lưu giao dịch & đính kèm vị trí GPS lên Firestore!" : "Đã lưu giao dịch lên Firestore!", "success");

        // Reset Form Fields
        document.getElementById('input-amount').value = '';
        if (noteInput) noteInput.value = '';
        if (categorySelect.options.length > 1) {
          categorySelect.selectedIndex = 1;
        }
        if (gpsStatusText) gpsStatusText.textContent = "Tự động lấy vị trí khi lưu";

      } catch (err) {
        showToast("Lỗi lưu giao dịch lên Firestore!", "error");
      }
    });
  }

  // 8. Submit Edit Transaction Form (Update Document on Firestore)
  const formEditTx = document.getElementById('form-edit-transaction');
  if (formEditTx) {
    formEditTx.addEventListener('submit', async (e) => {
      e.preventDefault();
      const txId = document.getElementById('edit-tx-id').value;
      const amount = getRawAmountValue('edit-amount');
      const categorySelect = document.getElementById('edit-category');
      const category = categorySelect ? categorySelect.value : '';
      const note = document.getElementById('edit-note').value;
      const dateVal = document.getElementById('edit-date').value;

      if (!txId) {
        showToast("Không tìm thấy mã giao dịch!", "error");
        return;
      }

      if (amount <= 0) {
        showToast("Vui lòng nhập số tiền hợp lệ!", "error");
        return;
      }

      if (!category) {
        showToast("Vui lòng chọn danh mục!", "error");
        return;
      }

      const txDate = dateVal ? new Date(dateVal) : new Date();

      try {
        await updateTransaction(txId, {
          amount,
          type: editFormType,
          category,
          note,
          date: txDate
        });

        showToast("Đã cập nhật giao dịch thành công!", "success");
        document.getElementById('modal-edit-transaction').classList.add('hidden');
      } catch (err) {
        console.error("Lỗi cập nhật giao dịch:", err);
        showToast("Không thể cập nhật giao dịch trên Firestore!", "error");
      }
    });
  }

  // 9. Modal Open/Close Controls
  // Sổ nợ Modal Trigger
  const btnOpenLoanModal = document.getElementById('btn-open-loan-modal');
  if (btnOpenLoanModal) {
    btnOpenLoanModal.addEventListener('click', () => {
      renderLoanBookModalContent();
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

  // 10. Add Custom Category Form Submit
  const formAddCat = document.getElementById('form-add-category');
  if (formAddCat) {
    formAddCat.addEventListener('submit', async (e) => {
      e.preventDefault();

      const catNameInput = document.getElementById('new-cat-name');
      const catName = catNameInput ? catNameInput.value : '';

      if (!catName.trim()) {
        showToast("Vui lòng nhập tên danh mục!", "error");
        return;
      }

      try {
        await addCustomCategory(catName, currentType);
        showToast(`Đã tạo danh mục "${catName}" thành công!`, "success");
        catNameInput.value = '';
        document.getElementById('modal-add-category').classList.add('hidden');
        await populateCategoryDropdown('select-category', currentType, catName.trim());
      } catch (err) {
        showToast("Lỗi thêm danh mục mới!", "error");
      }
    });
  }

  // 11. Confirm End Cycle Action ("Kết thúc tháng")
  const btnConfirmEndCycle = document.getElementById('btn-confirm-end-cycle-action');
  if (btnConfirmEndCycle) {
    btnConfirmEndCycle.addEventListener('click', async () => {
      try {
        // End current cycle and start a new active cycle in Firestore
        const currentId = activeCycle ? activeCycle.id : 'active_cycle';
        const newCycle = await endCurrentCycleAndStartNew(currentId);
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
  // 1. Instantly populate default categories
  populateCategoryDropdown('select-category', 'chi');

  // 2. Set default date and listeners
  setupEventListeners();

  // 3. Initialize Auth State Observer (Username/Password from auth.txt)
  initAuthObserver(onUserLoggedIn, onUserLoggedOut);
});
