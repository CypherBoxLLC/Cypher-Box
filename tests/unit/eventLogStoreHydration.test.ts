/**
 * Activity history (eventLogStore) when the encrypted store's key cannot be
 * read.
 *
 * The history is kept in the same encrypted store as the auth store, and on
 * a background wake on a locked iPhone its Keychain key is unreadable.
 * storageService.getItem turns that into null, so the history loaded as an
 * empty list and the next recordEvent in that process wrote the new list
 * over the saved one. The store now treats a failed read as "not loaded",
 * holds its writes until a load succeeds, and loads again on the next
 * foreground, keeping whatever was recorded in the meantime.
 */

export {};

const NAME = 'event-log-store';

/** The encrypted store's contents, by key; survives a reload of the module. */
const mockDisk = new Map<string, string>();
const mockKey = { readable: true };
let mockWrites = 0;

jest.mock('../../src/stores/storageService', () => {
    const unreadable = () => new Error('keychain read failed');
    return {
        __esModule: true,
        getStorage: async () => {
            if (!mockKey.readable) throw unreadable();
            return {};
        },
        // Like the real one: any failure, an unreadable key included, is null.
        getItem: async (name: string) => (mockKey.readable ? mockDisk.get(name) ?? null : null),
        setItem: async (name: string, value: string) => {
            if (!mockKey.readable) throw unreadable();
            mockWrites += 1;
            mockDisk.set(name, value);
        },
        removeItem: async (name: string) => {
            if (!mockKey.readable) throw unreadable();
            mockWrites += 1;
            mockDisk.delete(name);
        },
    };
});

type StoredEvent = { id: string; ts: number; kind: string };

const SAVED: StoredEvent[] = [
    { id: 'saved-2', ts: 2_000, kind: 'ark-created' },
    { id: 'saved-1', ts: 1_000, kind: 'hot-vault-created' },
];

function saveHistory(events: StoredEvent[]): string {
    const value = JSON.stringify({ state: { events }, version: 0 });
    mockDisk.set(NAME, value);
    return value;
}

function savedIds(): string[] {
    const raw = mockDisk.get(NAME);
    return raw ? JSON.parse(raw).state.events.map((e: StoredEvent) => e.id) : [];
}

const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
};

/** A fresh process: loads the store module, which starts its first load. */
function start() {
    jest.resetModules();
    return require('../../src/stores/eventLogStore').default;
}

beforeEach(() => {
    mockDisk.clear();
    mockKey.readable = true;
    mockWrites = 0;
});

describe('Activity history on a locked background wake', () => {
    it('leaves the saved history untouched when the load fails, whatever is recorded', async () => {
        const before = saveHistory(SAVED);
        mockKey.readable = false;
        const store = start();
        await settle();
        expect(store.persist.hasHydrated()).toBe(false);

        store.getState().recordEvent({ kind: 'ark-created' });
        store.getState().recordEvent({ kind: 'cold-vault-created' });
        await settle();
        // Unlocking does not let a held write through either.
        mockKey.readable = true;
        store.getState().recordEvent({ kind: 'ark-recovered' });
        await settle();

        expect(mockDisk.get(NAME)).toBe(before);
        expect(mockWrites).toBe(0);
    });

    it('loads it on a retry once the key is readable, keeping what was recorded meanwhile', async () => {
        saveHistory(SAVED);
        mockKey.readable = false;
        const store = start();
        await settle();
        store.getState().recordEvent({ kind: 'ark-created' });
        const recorded = store.getState().events[0].id;

        mockKey.readable = true;
        await store.persist.rehydrate();
        await settle();
        expect(store.persist.hasHydrated()).toBe(true);
        expect(store.getState().events.map((e: StoredEvent) => e.id)).toEqual([recorded, 'saved-2', 'saved-1']);
        expect(savedIds()).toEqual([recorded, 'saved-2', 'saved-1']);

        store.getState().recordEvent({ kind: 'cold-vault-created' });
        await settle();
        expect(savedIds()).toHaveLength(4);
        expect(savedIds().slice(1)).toEqual([recorded, 'saved-2', 'saved-1']);
    });

    it('loads it again when the app comes to the foreground', async () => {
        saveHistory(SAVED);
        mockKey.readable = false;
        const listeners: Array<(state: string) => void> = [];
        jest.resetModules();
        jest.doMock('react-native', () => ({
            AppState: {
                addEventListener: (_type: string, listener: (state: string) => void) => {
                    listeners.push(listener);
                    return { remove: () => undefined };
                },
            },
        }));
        jest.doMock('../../src/stores/authStore', () => ({
            __esModule: true,
            default: { persist: { hasHydrated: () => true, rehydrate: jest.fn() } },
        }));
        try {
            const { startAuthHydration } = require('../../src/stores/authHydration');
            const store = require('../../src/stores/eventLogStore').default;
            startAuthHydration();
            await settle();
            expect(store.persist.hasHydrated()).toBe(false); // still locked

            mockKey.readable = true;
            listeners.forEach(listener => listener('background'));
            await settle();
            expect(store.persist.hasHydrated()).toBe(false);

            listeners.forEach(listener => listener('active'));
            await settle();
            expect(store.persist.hasHydrated()).toBe(true);
            expect(store.getState().events.map((e: StoredEvent) => e.id)).toEqual(['saved-2', 'saved-1']);
            expect(mockWrites).toBe(0); // nothing new to save
        } finally {
            jest.dontMock('react-native');
            jest.dontMock('../../src/stores/authStore');
        }
    });
});

describe('Activity history on a normal launch', () => {
    it('loads the saved history and writes nothing until something is recorded', async () => {
        const before = saveHistory(SAVED);
        const store = start();
        await settle();
        expect(store.persist.hasHydrated()).toBe(true);
        expect(store.getState().events.map((e: StoredEvent) => e.id)).toEqual(['saved-2', 'saved-1']);
        expect(mockDisk.get(NAME)).toBe(before);

        store.getState().recordEvent({ kind: 'ark-created' });
        await settle();
        expect(savedIds()).toHaveLength(3);
        expect(savedIds().slice(1)).toEqual(['saved-2', 'saved-1']);
    });

    it('keeps an event recorded while the load was still under way', async () => {
        saveHistory(SAVED);
        const store = start();
        store.getState().recordEvent({ kind: 'ark-created' }); // before the load finishes
        const recorded = store.getState().events[0].id;
        await settle();
        expect(savedIds()).toEqual([recorded, 'saved-2', 'saved-1']);
    });

    it('starts saving on a first launch with nothing saved yet', async () => {
        const store = start();
        await settle();
        expect(store.persist.hasHydrated()).toBe(true);
        store.getState().recordEvent({ kind: 'hot-vault-created' });
        await settle();
        expect(savedIds()).toHaveLength(1);
    });
});
