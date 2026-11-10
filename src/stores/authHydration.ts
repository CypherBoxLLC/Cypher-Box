import { AppState, AppStateStatus } from "react-native";
import useAuthStore from "./authStore";

// Recover the auth store's hydration after a failed first attempt.
//
// zustand hydrates the store once at creation. If that happens during a
// background wake while the phone is locked, the Keychain key is unreadable,
// authPersistStorage.getItem throws, and the store stays unhydrated with writes
// blocked (correct: nothing is lost, but the store is still showing defaults).
// If the process then survives into the foreground, nothing would re-run
// hydration on its own, so the app would stay "logged out" with writes blocked
// until the process restarts.
//
// This re-runs hydration whenever the app becomes active, until it succeeds.
// On a normal foreground launch the first attempt already succeeded and this is
// a no-op.

let wired = false;

function tryRehydrate(): void {
    if (useAuthStore.persist.hasHydrated()) return;
    // rehydrate() re-reads through authPersistStorage; on success the store's
    // onRehydrateStorage enables writes. On another read failure it stays
    // unhydrated and we try again on the next foreground.
    void useAuthStore.persist.rehydrate();
}

export function startAuthHydration(): void {
    if (wired) return;
    wired = true;
    AppState.addEventListener("change", (status: AppStateStatus) => {
        if (status === "active") tryRehydrate();
    });
    // Also attempt immediately in case we are already active and the first
    // (creation-time) attempt failed.
    tryRehydrate();
}
