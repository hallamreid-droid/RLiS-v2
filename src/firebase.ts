import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
// To get these values:
// 1. Go to https://console.firebase.google.com/
// 2. Click "Create a project" (or select existing)
// 3. Go to Project Settings (gear icon) > General
// 4. Scroll to "Your apps" > Click web icon (</>)
// 5. Register app, copy the config values below
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBqyoZm-JHdCk7AHh5xcjRhT_NZfcNHZt8",
  authDomain: "rlis-59edc.firebaseapp.com",
  projectId: "rlis-59edc",
  storageBucket: "rlis-59edc.firebasestorage.app",
  messagingSenderId: "767766922360",
  appId: "1:767766922360:web:e54799758a9b054ffe998d",
  measurementId: "G-VT86DMC351",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Firestore with an offline cache shared by every open tab.
// (The old enableIndexedDbPersistence only worked in one tab; any other tab
// silently ran without a cache, so its unsynced writes were lost on refresh.)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export default app;
