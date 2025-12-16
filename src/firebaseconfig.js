// src/firebaseconfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging } from "firebase/messaging";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCc-QMneztyou0qbtnUnAp61ECGZtiAqjo",
  authDomain: "webappcadeteria.firebaseapp.com",
  projectId: "webappcadeteria",
  storageBucket: "webappcadeteria.firebasestorage.app",
  messagingSenderId: "918934733683",
  appId: "1:918934733683:web:d18ccd2d08fdbe2e7b7b06",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const messaging = getMessaging(app);
export const functions = getFunctions(app, "southamerica-east1");
