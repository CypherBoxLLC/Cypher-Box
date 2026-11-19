/**
 * Addresses are shown in full (v0.1.13, 2026-11-14).
 *
 * On the vault send screen a fixed 38pt pill showed the first 30 or so characters of the destination and cut off the
 * rest, the part the user checks. Five more screens cut addresses to their first and last 6 characters (or 40 in the
 * middle), which is what a look-alike address imitates. Addresses now show in full everywhere; a Lightning invoice,
 * hundreds of characters long, keeps a short start…end form.
 */

import fs from 'fs';
import path from 'path';
import { displayDestination, isLightningRequest, paidOutputAddress } from '../../src/helpers/addressDisplay';

const P2WPKH = 'bc1qtvss0yhz2thsjsq3cedc9j0a92hyywetkudq24';
const P2TR = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
const LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const NESTED = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const LIQUID =
  'lq1qqvxk052kf3qtkxmrakx50a9gc3smqad2ync54hzntjt980kfej9kkfe0247rp5h4yzmdftsahhw64uy8pzfe7cpg4fgykm7cv';
const BOLT11 =
  'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';

describe('displayDestination', () => {
  it('shows every kind of address in full', () => {
    for (const address of [P2WPKH, P2TR, LEGACY, NESTED, LIQUID, P2WPKH.toUpperCase()]) {
      expect(displayDestination(address)).toBe(address);
    }
  });

  it('shows a Bark address and a Lightning address in full', () => {
    const bark = 'ark1' + 'q'.repeat(110);
    expect(displayDestination(bark)).toBe(bark);
    expect(displayDestination('satoshi@strike.me')).toBe('satoshi@strike.me');
  });

  it('keeps a Lightning invoice short, start and end', () => {
    expect(displayDestination(BOLT11)).toBe(`${BOLT11.slice(0, 12)}…${BOLT11.slice(-8)}`);
    expect(displayDestination(BOLT11.toUpperCase())).toBe(`${BOLT11.toUpperCase().slice(0, 12)}…${BOLT11.toUpperCase().slice(-8)}`);
    const uri = `lightning:${BOLT11}`;
    expect(displayDestination(uri)).toBe(`${uri.slice(0, 12)}…${uri.slice(-8)}`);
  });

  it('trims, and never throws on a missing value', () => {
    expect(displayDestination(`  ${P2WPKH}\n`)).toBe(P2WPKH);
    expect(displayDestination(undefined)).toBe('');
    expect(displayDestination(null)).toBe('');
  });
});

describe('isLightningRequest', () => {
  it('knows invoices, offers and LNURL', () => {
    for (const s of [BOLT11, 'lntb1u1pdummy', 'lntbs10u1pdummy', 'lnbcrt1pdummy', 'LNURL1DP68GURN8GHJ7', 'lno1qgsq', 'lightning:lnbc1pdummy']) {
      expect(isLightningRequest(s)).toBe(true);
    }
  });

  it('does not take an address for one, a Liquid lq1 one included', () => {
    for (const s of [P2WPKH, P2TR, LEGACY, NESTED, LIQUID, 'satoshi@strike.me', '', undefined]) {
      expect(isLightningRequest(s)).toBe(false);
    }
  });
});

describe('paidOutputAddress (History details, "Received to")', () => {
  const ours = 'bc1qours0000000000000000000000000000000000';
  const change = 'bc1qsenderschange000000000000000000000000';
  const recipient = 'bc1qrecipient000000000000000000000000000';
  const out = (address?: string) => ({ scriptPubKey: { addresses: address ? [address] : [] } });
  const owns = (address: string) => address === ours;

  it('on a receive, the output that came to the vault, even when the sender listed its change first', () => {
    expect(paidOutputAddress([out(change), out(ours)], owns, false)).toBe(ours);
  });

  it('on a send, the first output that left the vault, not the vault change listed before it', () => {
    expect(paidOutputAddress([out(ours), out(recipient)], owns, true)).toBe(recipient);
  });

  it('falls back to the first output when the vault cannot tell, or its check throws', () => {
    expect(paidOutputAddress([out(change), out(ours)], () => false, false)).toBe(change);
    expect(paidOutputAddress([out(change), out(ours)], () => { throw new Error('no keys'); }, false)).toBe(change);
  });

  it('skips outputs without an address, and is undefined with none at all', () => {
    expect(paidOutputAddress([out(), null, out(ours)], owns, false)).toBe(ours);
    expect(paidOutputAddress(undefined, owns, false)).toBeUndefined();
    expect(paidOutputAddress([], owns, true)).toBeUndefined();
  });
});

describe('the screens', () => {
  const REPO = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  const block = (source: string, key: string) => {
    const start = source.indexOf(`    ${key}: {`);
    return source.slice(start, source.indexOf('},', start));
  };

  it('vault send: the destination pill and the note field grow instead of cutting text off', () => {
    const styles = read('src/screens/ColdStorage/styles.ts');
    expect(block(styles, 'button')).toMatch(/minHeight: 38/);
    expect(block(styles, 'button')).not.toMatch(/\bheight:/);
    expect(block(styles, 'noteInput')).toMatch(/minHeight: 35/);
    expect(block(styles, 'noteInput')).not.toMatch(/\bheight:/);
    expect(read('src/screens/ColdStorage/index.tsx')).toMatch(
      /<Text bold style=\{\[styles\.destinationAddress, rtl\.ltrText\]\}>\{destinationAddress\}<\/Text>/,
    );
  });

  it('Connect Cold Vault: the paste card grows with a pasted key', () => {
    const screen = read('src/screens/ConnectColdStorage/index.tsx');
    expect(screen).toMatch(/address \? styles\.linearGradientInsideGrows : styles\.linearGradientInside/);
    expect(screen).toMatch(/linearStyle=\{address \? styles\.linearStyleGrows : styles\.linearStyle\}/);
    expect(screen).toMatch(/address \? styles\.insideViewGrows : styles\.insideView/);
    const styles = read('src/screens/ConnectColdStorage/styles.ts');
    for (const key of ['linearGradientInsideGrows', 'linearStyleGrows']) {
      expect(block(styles, key)).toMatch(/minHeight: 54/);
      expect(block(styles, key)).not.toMatch(/\bheight:/);
    }
  });

  it('Strike and CoinOS send: the whole address under the one-line field', () => {
    const screen = read('src/screens/Send/index.tsx');
    expect(screen).toMatch(/!isLightningRequest\(sender\) && \(\s*<Text[^>]*>\s*\{sender\.trim\(\)\}\s*<\/Text>/);
  });

  it('the screens that cut addresses short now use displayDestination, and none keeps its own shortening', () => {
    const screens = [
      'src/screens/Transaction/index.tsx',
      'src/screens/SendReceiveOnChain/index.tsx',
      'src/screens/QrScreen/index.tsx',
      'src/screens/CopyInvoice/index.tsx',
      'src/screens/Ark/ArkTransactionDetailsScreen/index.tsx',
    ];
    for (const rel of screens) {
      const source = read(rel);
      expect(source).toMatch(/displayDestination\(/);
      expect(source).not.toMatch(/substring\(0, 6\)/);
    }
    const details = read('src/screens/SendReceiveOnChain/index.tsx');
    expect(details).toMatch(/paidOutputAddress\(transaction\?\.outputs, \(address\) => !!wallet\?\.weOwnAddress\?\.\(address\), isSent\)/);
    expect(details).toMatch(/\{ address: displayDestination\(receivedTo\) \}/);
    expect(details).not.toMatch(/outputs\[0\]\??\.scriptPubKey/);
    const ark = read('src/screens/Ark/ArkTransactionDetailsScreen/index.tsx');
    expect(ark).not.toMatch(/truncateMiddle\((sentTo|receivedOn)\[0\]/);
    expect(read('src/screens/ReviewPayment/index.tsx')).not.toMatch(/shortenAddress/);
  });
});
