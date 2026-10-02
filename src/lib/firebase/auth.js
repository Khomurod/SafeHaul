import { auth } from './config.js';
import { signOut } from "firebase/auth";

export function handleLogout() {
    signOut(auth).catch((error) => {
        console.error("Error signing out:", error);
    });
}
