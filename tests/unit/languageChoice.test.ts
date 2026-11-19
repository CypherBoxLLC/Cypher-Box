/**
 * The app offers English and Arabic. A language an older build saved from the phone, or one a fresh install would take
 * from it, that isn't offered (Spanish, Persian, Hebrew…) showed BlueWallet's partial translation, right-to-left for
 * some, with no matching choice in Settings. It becomes English; Arabic is kept or taken from the phone.
 */

const mockStore: Record<string, string> = {};
let mockLocales: { languageCode: string; countryCode: string; languageTag: string; isRTL: boolean }[] = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: jest.fn(async (key: string) => (key in mockStore ? mockStore[key] : null)),
        setItem: jest.fn(async (key: string, value: string) => {
            mockStore[key] = value;
        }),
        removeItem: jest.fn(async (key: string) => {
            delete mockStore[key];
        }),
    },
}));
jest.mock('react-native-localize', () => ({
    ...jest.requireActual('react-native-localize/mock'),
    getLocales: () => mockLocales,
}));

const phone = (languageCode: string, isRTL = false) => {
    mockLocales = [{ languageCode, countryCode: 'XX', languageTag: `${languageCode}-XX`, isRTL }];
};

/** Loads loc as a fresh launch would, and waits for its start-up language choice. */
const launch = async () => {
    let loc: any;
    jest.isolateModules(() => {
        loc = require('../../loc').default;
    });
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
    return { language: loc.getLanguage(), saved: mockStore.lang };
};

beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    phone('en');
});

describe('the language at launch', () => {
    it('turns a saved language the app no longer offers into English', async () => {
        mockStore.lang = 'es';
        expect(await launch()).toEqual({ language: 'en', saved: 'en' });
        mockStore.lang = 'he';
        expect(await launch()).toEqual({ language: 'en', saved: 'en' });
    });

    it('keeps a saved Arabic or English', async () => {
        mockStore.lang = 'ar';
        expect(await launch()).toEqual({ language: 'ar', saved: 'ar' });
        mockStore.lang = 'en';
        expect(await launch()).toEqual({ language: 'en', saved: 'en' });
    });

    it('takes Arabic from the phone on a fresh install', async () => {
        phone('ar', true);
        expect(await launch()).toEqual({ language: 'ar', saved: 'ar' });
    });

    it('uses English on a fresh install when the phone is in a language the app does not offer', async () => {
        phone('fa', true);
        expect(await launch()).toEqual({ language: 'en', saved: 'en' });
        delete mockStore.lang;
        phone('es');
        expect(await launch()).toEqual({ language: 'en', saved: 'en' });
    });
});
