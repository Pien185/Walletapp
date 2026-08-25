// ==========================================================================
// FIRESTORE DATABASE SERVICE MODULE
// Real-time synchronization & CRUD operations on Firestore collections
// ==========================================================================

import { 
  db, 
  collection, 
  doc, 
  addDoc, 
  getDocs, 
  getDoc,
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp 
} from './firebase-config.js';

// No default categories - user creates custom categories from scratch
export const DEFAULT_SYSTEM_CATEGORIES = [];

/**
 * Promise timeout helper to avoid hanging on slow network or restricted rules
 */
function withTimeout(promise, ms = 3000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore operation timed out')), ms))
  ]);
}

/* ==========================================================================
   1. CATEGORY MANAGEMENT (Collection: "categories")
   ========================================================================== */

/**
 * Fetch categories created by user, filtered by type ("chi" or "thu")
 */
export async function getCategoriesByType(type) {
  try {
    const catRef = collection(db, 'categories');
    const q = query(catRef, where('type', '==', type));
    const snapshot = await withTimeout(getDocs(q), 3000);

    const categories = [];
    snapshot.forEach(docSnap => {
      categories.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort categories alphabetically by name
    categories.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

    return categories;
  } catch (err) {
    console.warn("Lỗi lấy danh mục từ Firestore:", err.message);
    return [];
  }
}

/**
 * Add a new custom category
 */
export async function addCustomCategory(name, type) {
  try {
    const catRef = collection(db, 'categories');
    const newDoc = await addDoc(catRef, {
      name: name.trim(),
      type,
      isSystem: false,
      createdAt: serverTimestamp()
    });
    return { id: newDoc.id, name: name.trim(), type, isSystem: false };
  } catch (err) {
    console.error("Lỗi thêm danh mục mới:", err);
    throw err;
  }
}

/**
 * Delete a custom category by Document ID
 */
export async function deleteCategory(catId) {
  try {
    const catRef = doc(db, 'categories', catId);
    await deleteDoc(catRef);
    return true;
  } catch (err) {
    console.error("Lỗi xóa danh mục:", err);
    throw err;
  }
}

/**
 * Clear all old default system categories from Firestore if any exist
 */
export async function clearAllSystemCategories() {
  try {
    const catRef = collection(db, 'categories');
    const q = query(catRef, where('isSystem', '==', true));
    const snapshot = await withTimeout(getDocs(q), 3000);
    const deletePromises = [];
    snapshot.forEach(docSnap => {
      deletePromises.push(deleteDoc(doc(db, 'categories', docSnap.id)));
    });
    await Promise.all(deletePromises);
  } catch (err) {
    console.warn("Xóa danh mục hệ thống cũ:", err.message);
  }
}

/* ==========================================================================
   2. FINANCIAL CYCLE MANAGEMENT (Collection: "cycles")
   ========================================================================== */

/**
 * Get current active cycle, or create initial "Kỳ 1" if none exists
 */
export async function getActiveCycle() {
  const now = new Date();
  const fallbackCycle = {
    id: 'active_cycle',
    name: `Kỳ 1 (${now.getMonth() + 1}/${now.getFullYear()})`,
    startDate: Timestamp.fromDate(now),
    endDate: null,
    isActive: true
  };

  try {
    const cyclesRef = collection(db, 'cycles');
    const q = query(cyclesRef, where('isActive', '==', true));
    const snapshot = await withTimeout(getDocs(q), 3000);

    if (!snapshot.empty) {
      const docSnap = snapshot.docs[0];
      return { id: docSnap.id, ...docSnap.data() };
    }

    // No active cycle exists, calculate total cycle count to determine cycle number
    const allCyclesSnap = await withTimeout(getDocs(cyclesRef), 3000).catch(() => ({ size: 0 }));
    const cycleNum = (allCyclesSnap.size || 0) + 1;
    const cycleName = `Kỳ ${cycleNum} (${now.getMonth() + 1}/${now.getFullYear()})`;

    const newCycleDoc = await addDoc(cyclesRef, {
      name: cycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true,
      createdAt: serverTimestamp()
    });

    return {
      id: newCycleDoc.id,
      name: cycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true
    };
  } catch (err) {
    console.warn("Dùng kỳ mặc định do Firestore chưa phản hồi:", err.message);
    return fallbackCycle;
  }
}

/**
 * End current cycle and start a new active cycle ("Kết thúc tháng")
 */
export async function endCurrentCycleAndStartNew(currentCycleId) {
  try {
    const now = new Date();
    // 1. Close current cycle if exists
    if (currentCycleId && currentCycleId !== 'active_cycle') {
      const currentCycleRef = doc(db, 'cycles', currentCycleId);
      await updateDoc(currentCycleRef, {
        isActive: false,
        endDate: Timestamp.fromDate(now)
      }).catch(() => {});
    }

    // 2. Count total cycles for next cycle naming
    const cyclesRef = collection(db, 'cycles');
    const allCyclesSnap = await getDocs(cyclesRef).catch(() => ({ size: 1 }));
    const nextNum = (allCyclesSnap.size || 1) + 1;
    const nextCycleName = `Kỳ ${nextNum} (${now.getMonth() + 1}/${now.getFullYear()})`;

    // 3. Create new active cycle
    const newCycleDoc = await addDoc(cyclesRef, {
      name: nextCycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true,
      createdAt: serverTimestamp()
    });

    return {
      id: newCycleDoc.id,
      name: nextCycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true
    };
  } catch (err) {
    console.error("Lỗi đóng kỳ tài chính:", err);
    throw err;
  }
}

/**
 * Fetch all cycles for historical comparison stats
 */
export async function getAllCycles() {
  try {
    const cyclesRef = collection(db, 'cycles');
    const snapshot = await withTimeout(getDocs(cyclesRef), 3000);
    const cycles = [];
    snapshot.forEach(docSnap => {
      cycles.push({ id: docSnap.id, ...docSnap.data() });
    });
    // Sort by startDate
    cycles.sort((a, b) => {
      const tA = a.startDate?.toDate ? a.startDate.toDate().getTime() : 0;
      const tB = b.startDate?.toDate ? b.startDate.toDate().getTime() : 0;
      return tA - tB;
    });
    return cycles;
  } catch (err) {
    console.warn("Lỗi lấy danh sách kỳ:", err.message);
    const now = new Date();
    return [{
      id: 'active_cycle',
      name: `Kỳ 1 (${now.getMonth() + 1}/${now.getFullYear()})`,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true
    }];
  }
}

/* ==========================================================================
   3. TRANSACTIONS CRUD & REAL-TIME LISTENERS (Collection: "transactions")
   ========================================================================== */

/**
 * Add a new transaction (Expense or Income) directly to "transactions" collection
 * Supports 2-way debt: "Cho mượn" (lend) and "Đi vay" (borrow)
 * @param {Object} txData
 * @returns {Promise<string>} Created Document ID
 */
export async function addTransaction({ amount, type, category, note, date, cycleId, location = null, userId = null }) {
  try {
    const txRef = collection(db, 'transactions');

    // 2-Way Debt Detection:
    const isLend = (type === 'chi' && category === 'Cho mượn');
    const isBorrow = (type === 'thu' && category === 'Đi vay');

    const isLoan = isLend || isBorrow;
    let loanKind = null;
    if (isLend) loanKind = 'lend';
    if (isBorrow) loanKind = 'borrow';

    const loanStatus = isLoan ? 'nợ' : null;
    const txDate = date instanceof Date ? date : new Date(date);

    const docRef = await addDoc(txRef, {
      amount: Number(amount),
      type, // "chi" (Expense) or "thu" (Income)
      category: category || 'Khác',
      note: note ? note.trim() : '',
      date: Timestamp.fromDate(txDate),
      cycleId: cycleId || 'active_cycle',
      isLoan,
      loanKind,   // 'lend' (người khác nợ tôi) | 'borrow' (tôi nợ người khác) | null
      loanStatus, // 'nợ' | 'đã_trả' | null
      location: location ? {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude)
      } : null,
      userId: userId || 'default_user',
      createdAt: serverTimestamp()
    });

    return docRef.id;
  } catch (err) {
    console.error("Lỗi thêm giao dịch vào Firestore:", err);
    throw err;
  }
}

/**
 * Listen to real-time transactions with onSnapshot
 * @param {string} cycleId 
 * @param {Function} onUpdate Callback with real-time transactions array
 * @returns {Function} Unsubscribe function
 */
export function subscribeCycleTransactions(cycleId, onUpdate) {
  const txRef = collection(db, 'transactions');
  
  let q;
  if (cycleId && cycleId !== 'active_cycle') {
    q = query(
      txRef,
      where('cycleId', '==', cycleId)
    );
  } else {
    q = query(txRef);
  }

  return onSnapshot(q, (snapshot) => {
    const transactions = [];
    snapshot.forEach(docSnap => {
      transactions.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort descending by date
    transactions.sort((a, b) => {
      const timeA = a.date?.toDate ? a.date.toDate().getTime() : (a.date ? new Date(a.date).getTime() : 0);
      const timeB = b.date?.toDate ? b.date.toDate().getTime() : (b.date ? new Date(b.date).getTime() : 0);
      return timeB - timeA;
    });

    onUpdate(transactions);
  }, (error) => {
    console.warn("Lắng nghe real-time transactions:", error.message);
  });
}

/**
 * Listen to real-time 2-way pending loans (Cho mượn & Tôi nợ)
 * @param {Function} onUpdate Callback with { lendLoans, borrowLoans, allLoans }
 * @returns {Function} Unsubscribe function
 */
export function subscribeAllLoans(onUpdate) {
  const txRef = collection(db, 'transactions');
  const q = query(
    txRef,
    where('isLoan', '==', true),
    where('loanStatus', '==', 'nợ')
  );

  return onSnapshot(q, (snapshot) => {
    const lendLoans = [];
    const borrowLoans = [];
    const allLoans = [];

    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      allLoans.push(data);

      if (data.loanKind === 'borrow' || data.category === 'Đi vay') {
        borrowLoans.push(data);
      } else {
        lendLoans.push(data);
      }
    });

    // Sort descending by date
    const sortByDate = (a, b) => {
      const timeA = a.date?.toDate ? a.date.toDate().getTime() : (a.date ? new Date(a.date).getTime() : 0);
      const timeB = b.date?.toDate ? b.date.toDate().getTime() : (b.date ? new Date(b.date).getTime() : 0);
      return timeB - timeA;
    };

    lendLoans.sort(sortByDate);
    borrowLoans.sort(sortByDate);
    allLoans.sort(sortByDate);

    onUpdate({ lendLoans, borrowLoans, allLoans });
  }, (error) => {
    console.warn("Lắng nghe sổ nợ 2 chiều:", error.message);
  });
}

/**
 * Update an existing transaction by Document ID
 * @param {string} txId Firestore Document ID
 * @param {Object} updatedFields Fields to update
 */
export async function updateTransaction(txId, { amount, type, category, note, date }) {
  try {
    const txRef = doc(db, 'transactions', txId);
    const txDate = date instanceof Date ? date : new Date(date);

    const isLend = (type === 'chi' && category === 'Cho mượn');
    const isBorrow = (type === 'thu' && category === 'Đi vay');
    const isLoan = isLend || isBorrow;

    let loanKind = null;
    if (isLend) loanKind = 'lend';
    if (isBorrow) loanKind = 'borrow';

    const updatePayload = {
      amount: Number(amount),
      type,
      category,
      note: note ? note.trim() : '',
      date: Timestamp.fromDate(txDate),
      isLoan,
      loanKind
    };

    if (isLoan) {
      const currentDoc = await getDoc(txRef).catch(() => null);
      if (currentDoc && currentDoc.exists()) {
        const data = currentDoc.data();
        if (!data.loanStatus) {
          updatePayload.loanStatus = 'nợ';
        }
      } else {
        updatePayload.loanStatus = 'nợ';
      }
    }

    await updateDoc(txRef, updatePayload);
    return true;
  } catch (err) {
    console.error("Lỗi cập nhật giao dịch:", err);
    throw err;
  }
}

/**
 * Delete a transaction by Document ID
 * @param {string} txId Firestore Document ID
 */
export async function deleteTransaction(txId) {
  try {
    const txRef = doc(db, 'transactions', txId);
    await deleteDoc(txRef);
    return true;
  } catch (err) {
    console.error("Lỗi xóa giao dịch trên Firestore:", err);
    throw err;
  }
}

/**
 * Handle loan repayment for "Cho mượn" (Người khác trả tôi)
 */
export async function payLoanTransaction(loanTx, activeCycleId) {
  try {
    const originalTxRef = doc(db, 'transactions', loanTx.id);
    await updateDoc(originalTxRef, {
      loanStatus: 'đã_trả'
    });

    const txRef = collection(db, 'transactions');
    await addDoc(txRef, {
      amount: Number(loanTx.amount),
      type: 'thu',
      category: 'Thu hồi nợ',
      note: `Thu hồi nợ từ: ${loanTx.note || 'Khoản mượn ngày ' + (loanTx.date?.toDate ? new Date(loanTx.date.toDate()).toLocaleDateString('vi-VN') : '')}`,
      date: Timestamp.fromDate(new Date()),
      cycleId: activeCycleId || 'active_cycle',
      isLoan: false,
      loanStatus: null,
      createdAt: serverTimestamp()
    });

    return true;
  } catch (err) {
    console.error("Lỗi xử lý thu nợ:", err);
    throw err;
  }
}

/**
 * Handle repayment for "Tôi nợ" (Tôi trả nợ người khác)
 */
export async function payBorrowLoanTransaction(loanTx, activeCycleId) {
  try {
    const originalTxRef = doc(db, 'transactions', loanTx.id);
    await updateDoc(originalTxRef, {
      loanStatus: 'đã_trả'
    });

    const txRef = collection(db, 'transactions');
    await addDoc(txRef, {
      amount: Number(loanTx.amount),
      type: 'chi',
      category: 'Trả nợ',
      note: `Trả nợ cho: ${loanTx.note || 'Khoản vay ngày ' + (loanTx.date?.toDate ? new Date(loanTx.date.toDate()).toLocaleDateString('vi-VN') : '')}`,
      date: Timestamp.fromDate(new Date()),
      cycleId: activeCycleId || 'active_cycle',
      isLoan: false,
      loanStatus: null,
      createdAt: serverTimestamp()
    });

    return true;
  } catch (err) {
    console.error("Lỗi xử lý trả nợ:", err);
    throw err;
  }
}

/**
 * Get all transactions across all cycles for multi-cycle comparison stats
 */
export async function getAllTransactions() {
  try {
    const txRef = collection(db, 'transactions');
    const snapshot = await withTimeout(getDocs(txRef), 3000);
    const transactions = [];
    snapshot.forEach(docSnap => {
      transactions.push({ id: docSnap.id, ...docSnap.data() });
    });
    return transactions;
  } catch (err) {
    console.warn("Lỗi lấy toàn bộ giao dịch:", err.message);
    return [];
  }
}
