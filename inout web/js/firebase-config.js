// ==========================================================================
// FIREBASE CONFIGURATION & INITIALIZATION (MODULE SDK V9)
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
  getFirestore, 
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
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Firebase Project Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDT83rV011mjAW0YwzfwErR3cY3OGgWhJ0",
  authDomain: "wallet-app-380d6.firebaseapp.com",
  projectId: "wallet-app-380d6",
  storageBucket: "wallet-app-380d6.firebasestorage.app",
  messagingSenderId: "85932900415",
  appId: "1:85932900415:web:77176c5ed3424ed870788a",
  measurementId: "G-YHSBHC116E"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Export Firebase Instances & Firestore Utilities
export {
  app,
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
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
};
