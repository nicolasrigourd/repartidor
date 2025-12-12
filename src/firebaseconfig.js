// src/firebaseconfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCc-QMneztyou0qbtnUnAp61ECGZtiAqjo",
  authDomain: "webappcadeteria.firebaseapp.com",
  projectId: "webappcadeteria",
  storageBucket: "webappcadeteria.firebasestorage.app",
  messagingSenderId: "918934733683",
  appId: "1:918934733683:web:d18ccd2d08fdbe2e7b7b06",
};

const app = initializeApp(firebaseConfig);

// ✅ esto es lo que te faltaba
export const db = getFirestore(app);

// (opcional) si en algún lado querés usar el app
export default app;
