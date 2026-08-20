// ==========================================================================
// FIRESTORE DATABASE SERVICE MODULE
// All paths scoped under users/{userId}/...
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

// Default system categories to seed for new users
const DEFAULT_SYSTEM_CATEGORIES = [
  // Chi tiêu (Expense)
  { name: 'Ăn uống', type: 'chi', isSystem: true },
  { name: 'Di chuyển', type: 'chi', isSystem: true },
  { name: 'Cho mượn', type: 'chi', isSystem: true }, // Special Loan Category
  { name: 'Mua sắm', type: 'chi', isSystem: true },
  { name: 'Hóa đơn & Dịch vụ', type: 'chi', isSystem: true },
  { name: 'Giải trí', type: 'chi', isSystem: true },
  { name: 'Khác (Chi)', type: 'chi', isSystem: true },

  // Thu nhập (Income)
  { name: 'Lương', type: 'thu', isSystem: true },
  { name: 'Thưởng', type: 'thu', isSystem: true },
  { name: 'Thu hồi nợ', type: 'thu', isSystem: true }, // Special Repayment Category
  { name: 'Khác (Thu)', type: 'thu', isSystem: true }
];

/* ==========================================================================
   1. CATEGORY MANAGEMENT
   ========================================================================== */

/**
 * Seed default categories if user has no categories setup yet
 */
export async function seedDefaultCategoriesIfEmpty(userId) {
  try {
    const catRef = collection(db, 'users', userId, 'categories');
    const snapshot = await getDocs(catRef);
    if (snapshot.empty) {
      console.log("Seeding default categories for user:", userId);
      const batchPromises = DEFAULT_SYSTEM_CATEGORIES.map(cat => addDoc(catRef, cat));
      await Promise.all(batchPromises);
    }
  } catch (err) {
    console.error("Lỗi khởi tạo danh mục mặc định:", err);
  }
}

/**
 * Fetch categories filtered by type ("chi" or "thu")
 */
export async function getCategoriesByType(userId, type) {
  try {
    await seedDefaultCategoriesIfEmpty(userId);
    const catRef = collection(db, 'users', userId, 'categories');
    const q = query(catRef, where('type', '==', type));
    const snapshot = await getDocs(q);
    const categories = [];
    snapshot.forEach(docSnap => {
      categories.push({ id: docSnap.id, ...docSnap.data() });
    });
    return categories;
  } catch (err) {
    console.error("Lỗi lấy danh mục:", err);
    return [];
  }
}

/**
 * Add a new custom category
 */
export async function addCustomCategory(userId, name, type) {
  try {
    const catRef = collection(db, 'users', userId, 'categories');
    const newDoc = await addDoc(catRef, {
      name: name.trim(),
      type,
      isSystem: false
    });
    return { id: newDoc.id, name: name.trim(), type, isSystem: false };
  } catch (err) {
    console.error("Lỗi thêm danh mục mới:", err);
    throw err;
  }
}

/* ==========================================================================
   2. FINANCIAL CYCLE MANAGEMENT
   ========================================================================== */

/**
 * Get current active cycle, or create initial "Kỳ 1" if none exists
 */
export async function getActiveCycle(userId) {
  try {
    const cyclesRef = collection(db, 'users', userId, 'cycles');
    const q = query(cyclesRef, where('isActive', '==', true));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const docSnap = snapshot.docs[0];
      return { id: docSnap.id, ...docSnap.data() };
    }

    // No active cycle exists, calculate total cycle count to determine cycle number
    const allCyclesSnap = await getDocs(cyclesRef);
    const cycleNum = allCyclesSnap.size + 1;
    const now = new Date();
    const cycleName = `Kỳ ${cycleNum} (${now.getMonth() + 1}/${now.getFullYear()})`;

    const newCycleDoc = await addDoc(cyclesRef, {
      name: cycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true
    });

    return {
      id: newCycleDoc.id,
      name: cycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true
    };
  } catch (err) {
    console.error("Lỗi lấy hoặc tạo kỳ tài chính:", err);
    throw err;
  }
}

/**
 * End current cycle and start a new active cycle ("Kết thúc tháng")
 */
export async function endCurrentCycleAndStartNew(userId, currentCycleId) {
  try {
    const now = new Date();
    // 1. Close current cycle
    const currentCycleRef = doc(db, 'users', userId, 'cycles', currentCycleId);
    await updateDoc(currentCycleRef, {
      isActive: false,
      endDate: Timestamp.fromDate(now)
    });

    // 2. Count total cycles for next cycle naming
    const cyclesRef = collection(db, 'users', userId, 'cycles');
    const allCyclesSnap = await getDocs(cyclesRef);
    const nextNum = allCyclesSnap.size + 1;
    const nextCycleName = `Kỳ ${nextNum} (${now.getMonth() + 1}/${now.getFullYear()})`;

    // 3. Create new active cycle
    const newCycleDoc = await addDoc(cyclesRef, {
      name: nextCycleName,
      startDate: Timestamp.fromDate(now),
      endDate: null,
      isActive: true
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
 * Fetch all cycles for historical stats
 */
export async function getAllCycles(userId) {
  try {
    const cyclesRef = collection(db, 'users', userId, 'cycles');
    const q = query(cyclesRef, orderBy('startDate', 'asc'));
    const snapshot = await getDocs(q);
    const cycles = [];
    snapshot.forEach(docSnap => {
      cycles.push({ id: docSnap.id, ...docSnap.data() });
    });
    return cycles;
  } catch (err) {
    console.error("Lỗi lấy danh sách kỳ:", err);
    return [];
  }
}

/* ==========================================================================
   3. TRANSACTIONS & LOAN MANAGEMENT
   ========================================================================== */

/**
 * Add a new transaction (Expense or Income)
 */
export async function addTransaction(userId, { amount, type, category, note, date, cycleId, location = null }) {
  try {
    const txRef = collection(db, 'users', userId, 'transactions');
    const isLoan = (type === 'chi' && category === 'Cho mượn');
    const loanStatus = isLoan ? 'nợ' : null;

    const docRef = await addDoc(txRef, {
      amount: Number(amount),
      type, // "chi" or "thu"
      category,
      note: note ? note.trim() : '',
      date: Timestamp.fromDate(new Date(date)),
      cycleId,
      isLoan,
      loanStatus,
      location: location ? {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude)
      } : null,
      createdAt: serverTimestamp()
    });

    return docRef.id;
  } catch (err) {
    console.error("Lỗi thêm giao dịch:", err);
    throw err;
  }
}

/**
 * Listen to real-time transactions for a specific cycle
 */
export function subscribeCycleTransactions(userId, cycleId, onUpdate) {
  const txRef = collection(db, 'users', userId, 'transactions');
  const q = query(
    txRef, 
    where('cycleId', '==', cycleId), 
    orderBy('date', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const transactions = [];
    snapshot.forEach(docSnap => {
      transactions.push({ id: docSnap.id, ...docSnap.data() });
    });
    onUpdate(transactions);
  }, (error) => {
    console.error("Lỗi lắng nghe giao dịch kỳ:", error);
  });
}

/**
 * Listen to real-time pending loans (isLoan == true and loanStatus == "nợ")
 */
export function subscribePendingLoans(userId, onUpdate) {
  const txRef = collection(db, 'users', userId, 'transactions');
  const q = query(
    txRef,
    where('isLoan', '==', true),
    where('loanStatus', '==', 'nợ')
  );

  return onSnapshot(q, (snapshot) => {
    const loans = [];
    snapshot.forEach(docSnap => {
      loans.push({ id: docSnap.id, ...docSnap.data() });
    });
    onUpdate(loans);
  }, (error) => {
    console.error("Lỗi lắng nghe sổ nợ:", error);
  });
}

/**
 * Handle loan repayment ("Đã trả" button in Modal)
 * Requirements:
 * 1. Change original loan transaction loanStatus to "đã_trả" (keep amount intact)
 * 2. Create a NEW transaction: type: "thu", category: "Thu hồi nợ", amount: original amount, tied to activeCycleId
 */
export async function payLoanTransaction(userId, loanTx, activeCycleId) {
  try {
    // 1. Update original loan transaction
    const originalTxRef = doc(db, 'users', userId, 'transactions', loanTx.id);
    await updateDoc(originalTxRef, {
      loanStatus: 'đã_trả'
    });

    // 2. Generate NEW Income transaction tied to CURRENT active cycle
    const txRef = collection(db, 'users', userId, 'transactions');
    await addDoc(txRef, {
      amount: Number(loanTx.amount),
      type: 'thu',
      category: 'Thu hồi nợ',
      note: `Thu hồi nợ: ${loanTx.note || 'Khoản mượn ngày ' + new Date(loanTx.date.toDate()).toLocaleDateString('vi-VN')}`,
      date: Timestamp.fromDate(new Date()),
      cycleId: activeCycleId,
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
 * Delete a transaction
 */
export async function deleteTransaction(userId, txId) {
  try {
    const txRef = doc(db, 'users', userId, 'transactions', txId);
    await deleteDoc(txRef);
    return true;
  } catch (err) {
    console.error("Lỗi xóa giao dịch:", err);
    throw err;
  }
}

/**
 * Get all transactions across all cycles for multi-cycle comparison stats
 */
export async function getAllUserTransactions(userId) {
  try {
    const txRef = collection(db, 'users', userId, 'transactions');
    const snapshot = await getDocs(txRef);
    const transactions = [];
    snapshot.forEach(docSnap => {
      transactions.push({ id: docSnap.id, ...docSnap.data() });
    });
    return transactions;
  } catch (err) {
    console.error("Lỗi lấy toàn bộ giao dịch:", err);
    return [];
  }
}
