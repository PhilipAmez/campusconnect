// firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBxEdvwsz94vSMx9zKf2RwaUhvM6plfMj8",
    authDomain: "campusconnect-cac42.firebaseapp.com",
    projectId: "campusconnect-cac42",
    storageBucket: "campusconnect-cac42.firebasestorage.app",
    messagingSenderId: "697670243248",
    appId: "1:697670243248:web:441a1b4f4d30a14a2e3c75",
    measurementId: "G-33LEKJRXDR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export what you need
export { auth, db };