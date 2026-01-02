import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyC5qgzd11MXEZ2wvyu6wnotdeMrFCd9woo",
    authDomain: "suivi-heures-33270.firebaseapp.com",
    projectId: "suivi-heures-33270",
    storageBucket: "suivi-heures-33270.firebasestorage.app",
    messagingSenderId: "1006232941254",
    appId: "1:1006232941254:web:90164012168094e327ddc7"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);