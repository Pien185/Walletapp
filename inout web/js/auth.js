// ==========================================================================
// AUTHENTICATION MODULE (PRIVATE APP - NO LOGIN REQUIRED)
// ==========================================================================

import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from './firebase-config.js';

// Default private user profile
const DEFAULT_USER = {
  uid: 'default_user',
  displayName: 'Chủ Ví',
  photoURL: 'https://ui-avatars.com/api/?name=Chu+Vi&background=6366F1&color=fff'
};

/**
 * Trigger Google Sign-In popup (optional fallback)
 */
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.warn("Chưa cấu hình Firebase Auth Google, sử dụng tài khoản mặc định:", error);
    return DEFAULT_USER;
  }
}

/**
 * Sign out current user
 */
export async function logoutUser() {
  // For private single user app, logout simply reloads or resets view
  window.location.reload();
}

/**
 * Initialize Auth State Observer / Direct Login for Private App
 * @param {Function} onUserLoggedIn Callback when user is authenticated
 * @param {Function} onUserLoggedOut Callback when user logs out
 */
export function initAuthObserver(onUserLoggedIn, onUserLoggedOut) {
  const authScreen = document.getElementById('auth-screen');
  const mainApp = document.getElementById('main-app');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');

  // Listen to Firebase auth if configured, otherwise default to single private user
  onAuthStateChanged(auth, (user) => {
    const activeUser = user || DEFAULT_USER;

    if (userAvatar) userAvatar.src = activeUser.photoURL || DEFAULT_USER.photoURL;
    if (userName) userName.textContent = activeUser.displayName || DEFAULT_USER.displayName;

    if (authScreen) authScreen.classList.add('hidden');
    if (mainApp) mainApp.classList.remove('hidden');

    if (typeof onUserLoggedIn === 'function') {
      onUserLoggedIn(activeUser);
    }
  });

  // Fallback: If Firebase Auth is unconfigured or slow, initialize directly with DEFAULT_USER
  setTimeout(() => {
    if (mainApp && mainApp.classList.contains('hidden')) {
      if (userAvatar) userAvatar.src = DEFAULT_USER.photoURL;
      if (userName) userName.textContent = DEFAULT_USER.displayName;

      if (authScreen) authScreen.classList.add('hidden');
      mainApp.classList.remove('hidden');

      if (typeof onUserLoggedIn === 'function') {
        onUserLoggedIn(DEFAULT_USER);
      }
    }
  }, 300);
}

