import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
  connectFirestoreEmulator,
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

// Initialize Firestore
export const db = getFirestore(app);

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    // Multiple tabs open, persistence can only be enabled in one tab at a time
    console.warn("Firestore persistence failed: Multiple tabs open");
  } else if (err.code === "unimplemented") {
    // The current browser doesn't support persistence
    console.warn("Firestore persistence not supported in this browser");
  }
});

export default app;
