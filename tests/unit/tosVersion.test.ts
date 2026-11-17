import fs from 'fs';
import path from 'path';
import { CURRENT_TOS_VERSION } from '../../src/helpers/tosVersion';

const en = require('../../loc/en.json');
const ar = require('../../loc/ar.json');

const EN_MONTHS = 'January February March April May June July August September October November December'.split(' ');
const AR_MONTHS = 'يناير فبراير مارس أبريل مايو يونيو يوليو أغسطس سبتمبر أكتوبر نوفمبر ديسمبر'.split(' ');

const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '../../src/screens', ...parts), 'utf8');

describe('Terms of Service version', () => {
  const [year, month] = CURRENT_TOS_VERSION.split('-').map(Number);

  // A new "Last Updated" date without a new version would change the text without asking anyone to accept it again.
  it('matches every Last Updated date, in English and Arabic', () => {
    expect(en.cypherbox.tos.last_updated).toBe(`Last Updated: ${EN_MONTHS[month - 1]} ${year}`);
    expect(ar.cypherbox.tos.last_updated).toBe(`آخر تحديث: ${AR_MONTHS[month - 1]} ${year}`);
    expect(read('TermOfService', 'index.tsx')).toContain(`were last updated in ${EN_MONTHS[month - 1]} ${year}.`);
    expect(read('TermOfService', 'TermsArabic.tsx')).toContain(`كان في ${AR_MONTHS[month - 1]} ${year}.`);
  });

  it('is the one value the splash check and the Start screen both use', () => {
    for (const screen of ['SplashScreen', 'GetStartedScreen']) {
      const src = read(screen, 'index.tsx');
      expect(src).toMatch(/from '\.\.\/\.\.\/helpers\/tosVersion'/);
      expect(src).not.toMatch(/['"]\d{4}-\d{2}['"]/);
    }
  });
});
