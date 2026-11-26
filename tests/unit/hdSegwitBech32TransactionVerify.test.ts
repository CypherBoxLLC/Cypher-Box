import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairInterface } from 'ecpair';

import { HDSegwitBech32Transaction, HDSegwitBech32Wallet, TxVerificationError } from '../../class';
import ecc from '../../blue_modules/noble_ecc';

// what a (possibly malicious) Electrum server answers, keyed by txid
const mockServerHex: Record<string, any> = {};
const mockServerVerbose: Record<string, any> = {};
// local cache of raw hex answers, like the Realm cache in BlueElectrum
const mockCachedHex: Record<string, any> = {};

jest.mock('../../blue_modules/BlueElectrum', () => ({
  // our argument order is (txids, batchsize, verbose); upstream BlueWallet's is (txids, verbose, batchsize)
  multiGetTransactionByTxid: jest.fn(async (txids: string[], _batchsize?: number, verbose: boolean = true) => {
    const ret: Record<string, any> = {};
    for (const txid of txids) {
      const value = verbose ? mockServerVerbose[txid] : (mockCachedHex[txid] ?? mockServerHex[txid]);
      if (value) ret[txid] = value;
      if (value && !verbose) mockCachedHex[txid] = value;
    }
    return ret;
  }),
  forgetCachedTransactions: jest.fn(async (txids: string[]) => {
    for (const txid of txids) delete mockCachedHex[txid];
  }),
  // getChangeAddressAsync() asks whether each change address was used; offline, none is
  getTransactionsByAddress: jest.fn(async () => []),
}));

const ECPair = ECPairFactory(ecc);

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ATTACKER = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

function reversedHex(hash: Buffer) {
  return Buffer.from(hash).reverse().toString('hex');
}

function addressOf(script: Buffer): string | undefined {
  try {
    return bitcoin.address.fromOutputScript(script);
  } catch (_) {
    return undefined; // e.g. OP_RETURN
  }
}

// server-decoded json of a tx, with an option to lie about where outputs go
function verboseOf(tx: bitcoin.Transaction, outputAddress?: string) {
  return {
    txid: tx.getId(),
    confirmations: 0,
    vout: tx.outs.map((o, n) => {
      const address = outputAddress ?? addressOf(o.script);
      return { value: o.value / 1e8, n, scriptPubKey: address ? { addresses: [address] } : {} };
    }),
  };
}

function serve(tx: bitcoin.Transaction, opts: { asTxid?: string; verbose?: any } = {}) {
  const txid = opts.asTxid ?? tx.getId();
  mockServerHex[txid] = tx.toHex();
  mockServerVerbose[txid] = opts.verbose ?? verboseOf(tx);
}

function outputAddresses(tx: bitcoin.Transaction) {
  return tx.outs.map(o => bitcoin.address.fromOutputScript(o.script));
}

function setup() {
  for (const map of [mockServerHex, mockServerVerbose, mockCachedHex]) {
    for (const k of Object.keys(map)) delete map[k];
  }

  const wallet = new HDSegwitBech32Wallet();
  wallet.setSecret(MNEMONIC);
  const ourAddress = wallet._getExternalAddressByIndex(0);

  // tx funding our wallet
  const fundingTx = new bitcoin.Transaction();
  fundingTx.version = 2;
  fundingTx.addInput(Buffer.alloc(32, 0x11), 0);
  fundingTx.addOutput(bitcoin.address.toOutputScript(ourAddress), 100_000);
  serve(fundingTx);

  // our genuine payment (tx1)
  const { tx } = wallet.createTransaction(
    [{ txid: fundingTx.getId(), txId: fundingTx.getId(), vout: 0, value: 100_000, address: ourAddress }] as any,
    [{ address: RECIPIENT, value: 50_000 }],
    2,
    wallet._getInternalAddressByIndex(0),
    HDSegwitBech32Wallet.defaultRBFSequence,
    false,
    0,
  );
  assert(tx);
  const tx1 = bitcoin.Transaction.fromHex(tx.toHex());
  const payIndex = outputAddresses(tx1).indexOf(RECIPIENT);
  assert(payIndex !== -1);

  // forged conflicting tx2: same inputs and witness as tx1, but the payment goes to the attacker
  const tx2 = bitcoin.Transaction.fromHex(tx1.toHex());
  tx2.outs[payIndex].script = bitcoin.address.toOutputScript(ATTACKER);

  return { wallet, fundingTx, tx1, tx2, ourAddress };
}

// re-signs the only input of `tx` (spending `prevValue` sats) with `keyPair` and serves it
function resign(tx: bitcoin.Transaction, keyPair: ECPairInterface, hashType: number, prevValue = 100_000) {
  const hash = tx.hashForWitnessV0(0, bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey }).output!, prevValue, hashType);
  tx.ins[0].witness = [bitcoin.script.signature.encode(keyPair.sign(hash), hashType), keyPair.publicKey];
  serve(tx);
}

function ourKey(wallet: HDSegwitBech32Wallet) {
  return ECPair.fromWIF(wallet._getWIFByIndex(false, 0) as string);
}

describe('HDSegwitBech32Transaction vs malicious Electrum server (GHSA-6jp4-8v48-cc5v)', () => {
  it('bumps, cancels and CPFPs a genuine tx', async () => {
    const { wallet, tx1 } = setup();
    serve(tx1);
    const t = () => new HDSegwitBech32Transaction(null, tx1.getId(), wallet);

    const { tx: bumped } = await t().createRBFbumpFee(10);
    assert.ok(outputAddresses(bumped!).includes(RECIPIENT));

    const { tx: cancelled } = await t().createRBFcancelTx(10);
    assert.strictEqual(cancelled!.outs.length, 1);
    assert.ok(wallet.weOwnAddress(outputAddresses(cancelled!)[0]));

    const { tx: child } = await t().createCPFPbumpFee(10);
    assert.strictEqual(reversedHex(child!.ins[0].hash), tx1.getId());
  });

  it('refuses to bump or cancel a forged tx: our inputs, but signatures dont match its outputs', async () => {
    const { wallet, tx2 } = setup();
    serve(tx2); // server swallowed tx1 and shows tx2 in our history instead
    const t = () => new HDSegwitBech32Transaction(null, tx2.getId(), wallet);
    await assert.rejects(t().createRBFbumpFee(10), TxVerificationError);
    await assert.rejects(t().createRBFcancelTx(10), TxVerificationError);
    await assert.rejects(t().getInfo(), TxVerificationError);
  });

  it('refuses a forged tx signed with our key but SIGHASH_NONE: such signature does not commit to outputs', async () => {
    const { wallet, tx2 } = setup();
    resign(tx2, ourKey(wallet), bitcoin.Transaction.SIGHASH_NONE);
    await assert.rejects(new HDSegwitBech32Transaction(null, tx2.getId(), wallet).createRBFbumpFee(10), TxVerificationError);
  });

  it("refuses a forged tx validly signed with attacker's own key", async () => {
    const { wallet, tx2 } = setup();
    resign(tx2, ECPair.makeRandom(), bitcoin.Transaction.SIGHASH_ALL);
    await assert.rejects(new HDSegwitBech32Transaction(null, tx2.getId(), wallet).createRBFbumpFee(10), TxVerificationError);
  });

  it('takes outputs from the raw tx, not from server-decoded json', async () => {
    const { wallet, tx1 } = setup();
    serve(tx1, { verbose: verboseOf(tx1, ATTACKER) }); // genuine hex, lying json
    const t = new HDSegwitBech32Transaction(null, tx1.getId(), wallet);
    assert.strictEqual(await t.getRemoteConfirmationsNum(), 0); // the json is still what confirmations come from
    const { tx } = await t.createRBFbumpFee(10);
    assert.ok(outputAddresses(tx!).includes(RECIPIENT));
    assert.ok(!outputAddresses(tx!).includes(ATTACKER));
  });

  it('refuses a tx (or a previous tx) whose hex does not match the txid, and drops it from the cache', async () => {
    const { wallet, fundingTx, tx1, tx2, ourAddress } = setup();
    serve(tx2, { asTxid: tx1.getId() });
    await assert.rejects(new HDSegwitBech32Transaction(null, tx1.getId(), wallet).createRBFbumpFee(10), TxVerificationError);
    assert.strictEqual(mockCachedHex[tx1.getId()], undefined);

    serve(tx1);
    const fakeFunding = new bitcoin.Transaction();
    fakeFunding.addInput(Buffer.alloc(32, 0x22), 0);
    fakeFunding.addOutput(bitcoin.address.toOutputScript(ourAddress), 1_000_000);
    serve(fakeFunding, { asTxid: fundingTx.getId() });
    await assert.rejects(new HDSegwitBech32Transaction(null, tx1.getId(), wallet).createRBFbumpFee(10), TxVerificationError);
    assert.strictEqual(mockCachedHex[fundingTx.getId()], undefined);
  });

  it('drops a bad cached copy, so a fresh one is fetched next time', async () => {
    const { wallet, tx1 } = setup();
    serve(tx1);
    const tampered = bitcoin.Transaction.fromHex(tx1.toHex());
    tampered.ins[0].witness[0] = Buffer.alloc(71, 1); // same txid, bad signature
    assert.strictEqual(tampered.getId(), tx1.getId());
    mockCachedHex[tx1.getId()] = tampered.toHex();

    await assert.rejects(new HDSegwitBech32Transaction(null, tx1.getId(), wallet).createRBFbumpFee(10), TxVerificationError);
    assert.strictEqual(mockCachedHex[tx1.getId()], undefined);
    await new HDSegwitBech32Transaction(null, tx1.getId(), wallet).createRBFbumpFee(10);
    assert.strictEqual(mockCachedHex[tx1.getId()], tx1.toHex());

    const padded = bitcoin.Transaction.fromHex(tx1.toHex());
    padded.ins[0].witness.push(Buffer.alloc(500)); // same txid, signature still valid, but vsize is bigger
    assert.strictEqual(padded.getId(), tx1.getId());
    mockCachedHex[tx1.getId()] = padded.toHex();
    await assert.rejects(new HDSegwitBech32Transaction(null, tx1.getId(), wallet).createRBFbumpFee(10), TxVerificationError);
    assert.strictEqual(mockCachedHex[tx1.getId()], undefined);
  });

  it('allows CPFP of an incoming tx, inputs we dont own are not checked', async () => {
    const { wallet, ourAddress } = setup();
    const foreignFunding = new bitcoin.Transaction();
    foreignFunding.addInput(Buffer.alloc(32, 0x33), 0);
    foreignFunding.addOutput(bitcoin.address.toOutputScript(RECIPIENT), 200_000);
    serve(foreignFunding);
    const incoming = new bitcoin.Transaction();
    incoming.addInput(foreignFunding.getHash(), 0);
    incoming.ins[0].witness = [Buffer.alloc(71), Buffer.alloc(33)];
    incoming.addOutput(bitcoin.address.toOutputScript(ourAddress), 199_000);
    serve(incoming);

    const t = () => new HDSegwitBech32Transaction(null, incoming.getId(), wallet);
    const { fee, utxos, unconfirmedUtxos, targets } = await t().getInfo();
    assert.strictEqual(fee, 1000);
    assert.deepStrictEqual(utxos, []);
    assert.deepStrictEqual(targets, []);
    assert.deepStrictEqual(unconfirmedUtxos, [{ vout: 0, value: 199_000, txId: incoming.getId(), address: ourAddress }]);
    const { tx: child } = await t().createCPFPbumpFee(10);
    assert.strictEqual(reversedHex(child!.ins[0].hash), incoming.getId());
    // but RBF needs all inputs to be ours
    await assert.rejects(t().createRBFbumpFee(10), /inputs/);
    await assert.rejects(t().createRBFcancelTx(10), /inputs/);
  });

  it('refuses CPFP when a previous tx is withheld or outputs exceed inputs (fee would be negative)', async () => {
    const { wallet, ourAddress } = setup();
    const incoming = new bitcoin.Transaction();
    incoming.addInput(Buffer.alloc(32, 0x44), 0);
    incoming.addOutput(bitcoin.address.toOutputScript(ourAddress), 1_000_000);
    serve(incoming); // previous tx is not served
    await assert.rejects(new HDSegwitBech32Transaction(null, incoming.getId(), wallet).createCPFPbumpFee(10), TxVerificationError);

    const foreignFunding = new bitcoin.Transaction();
    foreignFunding.addInput(Buffer.alloc(32, 0x55), 0);
    foreignFunding.addOutput(bitcoin.address.toOutputScript(RECIPIENT), 100);
    serve(foreignFunding);
    incoming.ins[0].hash = foreignFunding.getHash();
    serve(incoming);
    await assert.rejects(new HDSegwitBech32Transaction(null, incoming.getId(), wallet).createCPFPbumpFee(10), TxVerificationError);
  });

  it('refuses to bump a tx with an output that has no address (OP_RETURN), with a clear error that is not a verification one', async () => {
    const { wallet, fundingTx, ourAddress } = setup();
    const opReturn = Buffer.from('6a4c50' + '00'.repeat(80), 'hex');
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(fundingTx.getHash(), 0, HDSegwitBech32Wallet.defaultRBFSequence);
    tx.addOutput(opReturn, 0);
    tx.addOutput(bitcoin.address.toOutputScript(RECIPIENT), 99_000);
    resign(tx, ourKey(wallet), bitcoin.Transaction.SIGHASH_ALL); // genuinely ours

    const t = () => new HDSegwitBech32Transaction(null, tx.getId(), wallet);
    const { fee, utxos, targets } = await t().getInfo();
    assert.strictEqual(fee, 1000);
    assert.strictEqual(utxos.length, 1);
    assert.deepStrictEqual(targets, [
      { value: 0, script: { hex: opReturn.toString('hex') } },
      { value: 99_000, address: RECIPIENT },
    ]);
    await assert.rejects(t().createRBFbumpFee(10), /OP_RETURN/);
    await assert.rejects(t().createRBFbumpFee(10), e => !(e instanceof TxVerificationError));
    // cancelling pays only ourselves, so it needs no re-created outputs
    const { tx: cancelled } = await t().createRBFcancelTx(10);
    assert.ok(wallet.weOwnAddress(outputAddresses(cancelled!)[0]));
    assert.strictEqual(ourAddress, wallet._getExternalAddressByIndex(0));
  });

  it('CPFPs an incoming tx that also carries an OP_RETURN output', async () => {
    const { wallet, ourAddress } = setup();
    const foreignFunding = new bitcoin.Transaction();
    foreignFunding.addInput(Buffer.alloc(32, 0x66), 0);
    foreignFunding.addOutput(bitcoin.address.toOutputScript(RECIPIENT), 200_000);
    serve(foreignFunding);
    const incoming = new bitcoin.Transaction();
    incoming.addInput(foreignFunding.getHash(), 0);
    incoming.ins[0].witness = [Buffer.alloc(71), Buffer.alloc(33)];
    incoming.addOutput(Buffer.from('6a0401020304', 'hex'), 0);
    incoming.addOutput(bitcoin.address.toOutputScript(ourAddress), 199_000);
    serve(incoming);

    const { tx: child } = await new HDSegwitBech32Transaction(null, incoming.getId(), wallet).createCPFPbumpFee(10);
    assert.strictEqual(reversedHex(child!.ins[0].hash), incoming.getId());
    assert.strictEqual(child!.ins[0].index, 1);
  });
});
