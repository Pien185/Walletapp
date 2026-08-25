// ==========================================================================
// AUTHENTICATION MODULE (USERNAME & PASSWORD VIA auth.txt)
// ==========================================================================

const DEFAULT_AVATAR_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><rect width="100%" height="100%" rx="50%" fill="%231E293B"/><circle cx="12" cy="9" r="4" fill="%23818CF8"/><path d="M12 14c-4.5 0-7 2.8-7 4.5V20h14v-1.5c0-1.7-2.5-4.5-7-4.5z" fill="%23818CF8"/></svg>';

const SESSION_KEY = 'wallet_app_auth_session';

/**
 * Fetch and parse credentials from auth.txt
 */
export async function getValidCredentials() {
  try {
    const response = await fetch('./auth.txt', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error("Không thể đọc file auth.txt");
    }
    const text = await response.text();
    const lines = text.split('\n');

    let validUsername = 'admin';
    let validPassword = '123';

    lines.forEach(line => {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith('#')) return;

      if (cleanLine.includes('=')) {
        const [key, ...rest] = cleanLine.split('=');
        const val = rest.join('=').trim();
        if (key.trim().toLowerCase() === 'username') validUsername = val;
        if (key.trim().toLowerCase() === 'password') validPassword = val;
      } else if (cleanLine.includes(':')) {
        const [u, p] = cleanLine.split(':');
        if (u) validUsername = u.trim();
        if (p) validPassword = p.trim();
      }
    });

    return { username: validUsername, password: validPassword };
  } catch (err) {
    console.warn("Dùng tài khoản mặc định do không đọc được auth.txt:", err.message);
    return { username: 'admin', password: '123' };
  }
}

/**
 * Login with username and password against auth.txt
 */
export async function loginWithCredentials(usernameInput, passwordInput) {
  const validCreds = await getValidCredentials();

  const inputU = (usernameInput || '').trim();
  const inputP = (passwordInput || '').trim();

  if (!inputU || !inputP) {
    throw new Error("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!");
  }

  if (inputU === validCreds.username && inputP === validCreds.password) {
    const userSession = {
      uid: 'user_' + inputU,
      username: inputU,
      displayName: inputU,
      photoURL: DEFAULT_AVATAR_SVG,
      loginAt: new Date().toISOString()
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
    return userSession;
  } else {
    throw new Error("Tên đăng nhập hoặc mật khẩu không đúng!");
  }
}

/**
 * Get current authenticated user session if exists
 */
export function getCurrentSession() {
  try {
    const sessionStr = localStorage.getItem(SESSION_KEY);
    if (!sessionStr) return null;
    return JSON.parse(sessionStr);
  } catch (e) {
    return null;
  }
}

/**
 * Sign out current user
 */
export function logoutUser() {
  localStorage.removeItem(SESSION_KEY);
  window.location.reload();
}

/**
 * Initialize Auth State & UI view
 */
export function initAuthObserver(onUserLoggedIn, onUserLoggedOut) {
  const authScreen = document.getElementById('auth-screen');
  const mainApp = document.getElementById('main-app');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');

  const activeSession = getCurrentSession();

  if (activeSession) {
    // User is already logged in
    if (userAvatar) userAvatar.src = activeSession.photoURL || DEFAULT_AVATAR_SVG;
    if (userName) userName.textContent = activeSession.displayName || activeSession.username || 'Chủ Ví';

    if (authScreen) authScreen.classList.add('hidden');
    if (mainApp) mainApp.classList.remove('hidden');

    if (typeof onUserLoggedIn === 'function') {
      onUserLoggedIn(activeSession);
    }
  } else {
    // Show login screen
    if (authScreen) authScreen.classList.remove('hidden');
    if (mainApp) mainApp.classList.add('hidden');

    if (typeof onUserLoggedOut === 'function') {
      onUserLoggedOut();
    }
  }
}
