import { AppState, AppStateStatus } from "react-native";
import useAuthStore from "./authStore";

// Recover the auth store's hydration after a failed first attempt.
//
// zustand hydrates the store once at creation. If that happens before the
// Keychain key is readable, authPersistStorage.getItem throws and the store
// stays unhydrated with writes held (correct: nothing is written, but the
// store is still showing defaults). If the session then continues without the
// store ever re-reading, it would stay on defaults with writes held until the
// process restarts.
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
