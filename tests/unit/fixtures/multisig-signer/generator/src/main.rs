//! Independent expected values for the Offline Seed-Signer's multisig tests (tests/unit/multisigSigner.test.ts and
//! tests/unit/multisigPolicy.test.ts).
//!
//! Everything here comes from rust-bitcoin 0.32, rust-miniscript 13.0 and libsecp256k1 (through rust-secp256k1), not
//! from the app's bitcoinjs, bip32 or noble code. Keys come from public BIP39 test phrases. To regenerate:
//!
//!     cargo run -q > ../fixtures.json
//!
//! It also checks BIP-129's own test vector and the Sparrow and Nunchuk exports kept in tests/unit/fixtures, and
//! panics if rust-miniscript disagrees with them.

use std::collections::BTreeMap;
use std::str::FromStr;

use bip39::Mnemonic;
use miniscript::bitcoin::bip32::{DerivationPath, Fingerprint, Xpriv, Xpub};
use miniscript::bitcoin::hashes::Hash;
use miniscript::bitcoin::psbt::{Psbt, PsbtSighashType};
use miniscript::bitcoin::secp256k1::{Message, Secp256k1};
use miniscript::bitcoin::sighash::{EcdsaSighashType, SighashCache};
use miniscript::bitcoin::{
    absolute, transaction, Address, Amount, Network, OutPoint, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Txid,
    Witness,
};
use miniscript::descriptor::{DefiniteDescriptorKey, Descriptor, DescriptorPublicKey};
use miniscript::psbt::PsbtExt;
use serde_json::{json, Value};

const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const LEGAL: &str = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const LETTER: &str = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const ZOO: &str = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const ALL: &str = "all all all all all all all all all all all all";
const OZONE: &str = "ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic";

struct Key {
    xprv: Xpriv,
    fp: Fingerprint,
}

fn master(phrase: &str, passphrase: &str) -> Key {
    let secp = Secp256k1::new();
    let seed = Mnemonic::parse_normalized(phrase).unwrap().to_seed(passphrase);
    let xprv = Xpriv::new_master(Network::Bitcoin, &seed).unwrap();
    let fp = xprv.fingerprint(&secp);
    Key { xprv, fp }
}

fn account(key: &Key, path: &str) -> (Xpriv, Xpub) {
    let secp = Secp256k1::new();
    let p = DerivationPath::from_str(path).unwrap();
    let xprv = key.xprv.derive_priv(&secp, &p).unwrap();
    (xprv, Xpub::from_priv(&secp, &xprv))
}

/// `[fp/48'/0'/0'/2']xpub` with the path written as in descriptors (apostrophes)
fn key_expr(key: &Key, path: &str) -> String {
    let (_, xpub) = account(key, path);
    format!("[{}{}]{}", key.fp, &path[1..], xpub)
}

fn multipath_desc(m: usize, keys: &[(&Key, &str)]) -> Descriptor<DescriptorPublicKey> {
    let parts: Vec<String> = keys.iter().map(|(k, p)| format!("{}/<0;1>/*", key_expr(k, p))).collect();
    Descriptor::from_str(&format!("wsh(sortedmulti({},{}))", m, parts.join(","))).unwrap()
}

fn single(desc: &Descriptor<DescriptorPublicKey>, branch: usize) -> Descriptor<DescriptorPublicKey> {
    desc.clone().into_single_descriptors().unwrap()[branch].clone()
}

fn at(desc: &Descriptor<DescriptorPublicKey>, branch: usize, index: u32) -> Descriptor<DefiniteDescriptorKey> {
    single(desc, branch).at_derivation_index(index).unwrap()
}

fn address(desc: &Descriptor<DescriptorPublicKey>, branch: usize, index: u32) -> String {
    at(desc, branch, index).address(Network::Bitcoin).unwrap().to_string()
}

fn witness_script(desc: &Descriptor<DescriptorPublicKey>, branch: usize, index: u32) -> String {
    hex(at(desc, branch, index).explicit_script().unwrap().as_bytes())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn txid(byte: u8) -> Txid {
    Txid::from_byte_array([byte; 32])
}

struct Spend {
    /// (txid byte, vout, branch, index, value) of each input, all from `wallet`
    inputs: Vec<(u8, u32, usize, u32, u64)>,
    /// (script, value, Some((descriptor, branch, index)) when the output gets key details)
    outputs: Vec<(ScriptBuf, u64, Option<(Descriptor<DescriptorPublicKey>, usize, u32)>)>,
}

fn build_psbt(wallet: &Descriptor<DescriptorPublicKey>, spend: &Spend) -> Psbt {
    let tx = Transaction {
        version: transaction::Version::TWO,
        lock_time: absolute::LockTime::ZERO,
        input: spend
            .inputs
            .iter()
            .map(|(t, vout, _, _, _)| TxIn {
                previous_output: OutPoint { txid: txid(*t), vout: *vout },
                script_sig: ScriptBuf::new(),
                sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                witness: Witness::new(),
            })
            .collect(),
        output: spend
            .outputs
            .iter()
            .map(|(script, value, _)| TxOut { value: Amount::from_sat(*value), script_pubkey: script.clone() })
            .collect(),
    };
    let mut psbt = Psbt::from_unsigned_tx(tx).unwrap();
    for (i, (_, _, branch, index, value)) in spend.inputs.iter().enumerate() {
        let d = at(wallet, *branch, *index);
        psbt.inputs[i].witness_utxo = Some(TxOut { value: Amount::from_sat(*value), script_pubkey: d.script_pubkey() });
        psbt.update_input_with_descriptor(i, &d).unwrap();
    }
    for (i, (_, _, details)) in spend.outputs.iter().enumerate() {
        if let Some((desc, branch, index)) = details {
            psbt.update_output_with_descriptor(i, &at(desc, *branch, *index)).unwrap();
        }
    }
    psbt
}

/// The same spend the way Nunchuk's FillPsbt leaves it: each input carries the whole previous transaction
/// (non_witness_utxo) and no witness_utxo. The previous transactions are made here, so the outpoints are their txids.
fn build_psbt_nonwitness(wallet: &Descriptor<DescriptorPublicKey>, spend: &Spend) -> (Psbt, Vec<String>) {
    let filler = Address::from_str("bc1qhu8jqyzfazgatpctqn44xr7pdd3mdx6qy2r6xa").unwrap().assume_checked().script_pubkey();
    let mut prevs = vec![];
    let inputs: Vec<TxIn> = spend
        .inputs
        .iter()
        .map(|(t, vout, branch, index, value)| {
            let mut output: Vec<TxOut> =
                (0..*vout).map(|_| TxOut { value: Amount::from_sat(1_000), script_pubkey: filler.clone() }).collect();
            output.push(TxOut { value: Amount::from_sat(*value), script_pubkey: at(wallet, *branch, *index).script_pubkey() });
            let prev = Transaction {
                version: transaction::Version::TWO,
                lock_time: absolute::LockTime::ZERO,
                input: vec![TxIn {
                    previous_output: OutPoint { txid: txid(*t), vout: 0 },
                    script_sig: ScriptBuf::new(),
                    sequence: Sequence::MAX,
                    witness: Witness::new(),
                }],
                output,
            };
            let txin = TxIn {
                previous_output: OutPoint { txid: prev.compute_txid(), vout: *vout },
                script_sig: ScriptBuf::new(),
                sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                witness: Witness::new(),
            };
            prevs.push(prev);
            txin
        })
        .collect();
    let tx = Transaction {
        version: transaction::Version::TWO,
        lock_time: absolute::LockTime::ZERO,
        input: inputs,
        output: spend
            .outputs
            .iter()
            .map(|(script, value, _)| TxOut { value: Amount::from_sat(*value), script_pubkey: script.clone() })
            .collect(),
    };
    let mut psbt = Psbt::from_unsigned_tx(tx).unwrap();
    for (i, (_, _, branch, index, _)) in spend.inputs.iter().enumerate() {
        psbt.inputs[i].non_witness_utxo = Some(prevs[i].clone());
        psbt.update_input_with_descriptor(i, &at(wallet, *branch, *index)).unwrap();
        // the updater may add the witness UTXO itself; Nunchuk's leaves only the whole previous transaction
        psbt.inputs[i].witness_utxo = None;
    }
    for (i, (_, _, details)) in spend.outputs.iter().enumerate() {
        if let Some((desc, branch, index)) = details {
            psbt.update_output_with_descriptor(i, &at(desc, *branch, *index)).unwrap();
        }
    }
    let txids = prevs.iter().map(|p| p.compute_txid().to_string()).collect();
    (psbt, txids)
}

/// Signs every input of `psbt` with `key` at `path/branch/index`, the way an independent cosigner would, and returns
/// each input's BIP143 sighash (hex) and the signature (DER + sighash byte, hex).
fn cosign(psbt: &mut Psbt, key: &Key, path: &str, spend: &Spend) -> Vec<(String, String, String)> {
    let secp = Secp256k1::new();
    let (acct, _) = account(key, path);
    let tx = psbt.unsigned_tx.clone();
    let mut cache = SighashCache::new(&tx);
    let mut out = vec![];
    for (i, (_, _, branch, index, value)) in spend.inputs.iter().enumerate() {
        let child = acct
            .derive_priv(&secp, &DerivationPath::from_str(&format!("m/{}/{}", branch, index)).unwrap())
            .unwrap();
        let ws = psbt.inputs[i].witness_script.clone().unwrap();
        let sighash = cache
            .p2wsh_signature_hash(i, &ws, Amount::from_sat(*value), EcdsaSighashType::All)
            .unwrap();
        let msg = Message::from_digest(sighash.to_byte_array());
        let sig = secp.sign_ecdsa(&msg, &child.private_key);
        let pubkey = miniscript::bitcoin::PublicKey::new(child.private_key.public_key(&secp));
        let esig = miniscript::bitcoin::ecdsa::Signature { signature: sig, sighash_type: EcdsaSighashType::All };
        psbt.inputs[i].partial_sigs.insert(pubkey, esig);
        out.push((hex(&sighash.to_byte_array()), hex(&esig.to_vec()), hex(&pubkey.to_bytes())));
    }
    out
}

fn main() {
    let secp = Secp256k1::new();
    let a = master(ABANDON, "");
    let a_trezor = master(ABANDON, "TREZOR");
    let b = master(LEGAL, "");
    let c = master(LETTER, "");
    let d = master(ZOO, "");
    let x = master(ALL, "");
    let y = master(OZONE, "");
    let p48 = "m/48'/0'/0'/2'";

    let mut out: BTreeMap<String, Value> = BTreeMap::new();
    out.insert(
        "_source".into(),
        json!("Made by generator/ (rust-bitcoin 0.32, rust-miniscript 13.0, libsecp256k1 through rust-secp256k1 0.29), not by the app's code. Keys come from public BIP39 test phrases. Regenerate with: cd generator && cargo run -q > ../fixtures.json"),
    );

    // the m/48'/0'/0'/2' key of every test phrase, and two other accounts used below
    let mut keys = serde_json::Map::new();
    for (name, k) in [("abandon", &a), ("abandonTrezor", &a_trezor), ("legal", &b), ("letter", &c), ("zoo", &d), ("all", &x), ("ozone", &y)] {
        let (_, xpub) = account(k, p48);
        keys.insert(name.into(), json!({ "fingerprint": k.fp.to_string(), "path": p48, "xpub": xpub.to_string() }));
    }
    let (_, a5) = account(&a, "m/48'/0'/5'/2'");
    keys.insert("abandonAccount5".into(), json!({ "fingerprint": a.fp.to_string(), "path": "m/48'/0'/5'/2'", "xpub": a5.to_string() }));
    let (_, b1) = account(&b, "m/48'/0'/1'/2'");
    keys.insert("legalAccount1".into(), json!({ "fingerprint": b.fp.to_string(), "path": "m/48'/0'/1'/2'", "xpub": b1.to_string() }));
    let (_, a84) = account(&a, "m/84'/0'/0'");
    keys.insert("abandonBip84".into(), json!({ "fingerprint": a.fp.to_string(), "path": "m/84'/0'/0'", "xpub": a84.to_string() }));
    out.insert("keys".into(), Value::Object(keys));

    // W1: the wallet the signer registers, 2 of 3 (abandon, legal, letter) at m/48'/0'/0'/2'
    let w1 = multipath_desc(2, &[(&a, p48), (&b, p48), (&c, p48)]);
    // W2: someone else's 2 of 3 that includes the signer's key (abandon) next to two keys it doesn't know
    let w2 = multipath_desc(2, &[(&a, p48), (&x, p48), (&y, p48)]);
    // W3: mixed paths, the signer's key at account 5 first, the others at account 0 and 1
    let w3 = multipath_desc(2, &[(&a, "m/48'/0'/5'/2'"), (&b, "m/48'/0'/1'/2'"), (&c, p48)]);
    // W4: 3 of 4 with the zoo key, for a different m-of-n
    let w4 = multipath_desc(3, &[(&a, p48), (&b, p48), (&c, p48), (&d, p48)]);
    // W5: 2 of 3 with the TREZOR-passphrase key, to show the passphrase is needed
    let w5 = multipath_desc(2, &[(&a_trezor, p48), (&b, p48), (&c, p48)]);

    let mut wallets = serde_json::Map::new();
    for (name, w) in [("w1", &w1), ("w2", &w2), ("w3", &w3), ("w4", &w4), ("w5", &w5)] {
        let receive = single(w, 0);
        let change = single(w, 1);
        let mut addrs = serde_json::Map::new();
        for i in [0u32, 1, 2, 3, 5, 12, 999, 1000] {
            addrs.insert(format!("receive{}", i), json!(address(w, 0, i)));
            addrs.insert(format!("change{}", i), json!(address(w, 1, i)));
        }
        wallets.insert(
            name.into(),
            json!({
                // Display writes the checksum
                "descriptor": w.to_string(),
                "receiveDescriptor": receive.to_string(),
                "changeDescriptor": change.to_string(),
                "addresses": addrs,
                "witnessScriptReceive0": witness_script(w, 0, 0),
                "witnessScriptChange5": witness_script(w, 1, 5),
            }),
        );
    }
    // the first 20 receive and change addresses of W1, for "Check an address"
    wallets["w1"]["receiveFirst20"] = json!((0..20).map(|i| address(&w1, 0, i)).collect::<Vec<_>>());
    wallets["w1"]["changeFirst20"] = json!((0..20).map(|i| address(&w1, 1, i)).collect::<Vec<_>>());
    out.insert("wallets".into(), Value::Object(wallets));

    // BIP-129's own NO_ENCRYPTION descriptor record, checked here: its first address must come out of rust-miniscript
    let bip129 = "wsh(sortedmulti(2,[1cf0bf7e/48'/0'/0'/2']xpub6FL8FhxNNUVnG64YurPd16AfGyvFLhh7S2uSsDqR3Qfcm6o9jtcMYwh6DvmcBF9qozxNQmTCVvWtxLpKTnhVLN3Pgnu2D3pAoXYFgVyd8Yz/**,[4fc1dd4a/48'/0'/0'/2']xpub6EebMbEps7ZcV3FYEnddRsvrFWDrt2tiPmCeM7pPXQEmphvq9ZfJ1LWFUDjf3vxCeBuPrfyGrMazWUsYsetrnHatQZVLJH7LsgCjtMqdzgj/**))";
    let bip129_receive: Descriptor<DescriptorPublicKey> = Descriptor::from_str(&bip129.replace("/**", "/0/*")).unwrap();
    let bip129_first = bip129_receive.at_derivation_index(0).unwrap().address(Network::Bitcoin).unwrap().to_string();
    assert_eq!(bip129_first, "bc1qrgc6p3kylfztu06ysl752gwwuekhvtfh9vr7zg43jvu60mutamcsv948ej");
    let bip129_change: Descriptor<DescriptorPublicKey> = Descriptor::from_str(&bip129.replace("/**", "/1/*")).unwrap();
    out.insert(
        "bip129".into(),
        json!({
            "template": bip129,
            "firstAddress": bip129_first,
            "receive1": bip129_receive.at_derivation_index(1).unwrap().address(Network::Bitcoin).unwrap().to_string(),
            "change0": bip129_change.at_derivation_index(0).unwrap().address(Network::Bitcoin).unwrap().to_string(),
        }),
    );

    // a payee outside every wallet here (BIP84 vector address of another phrase, a plain P2WPKH)
    let payee = Address::from_str("bc1qhu8jqyzfazgatpctqn44xr7pdd3mdx6qy2r6xa").unwrap().require_network(Network::Bitcoin).unwrap();
    let payee_script = payee.script_pubkey();

    let mut psbts = serde_json::Map::new();
    let mut add = |name: &str, wallet: &Descriptor<DescriptorPublicKey>, spend: Spend, cosigners: Vec<(&Key, &str)>, note: &str| {
        let unsigned = build_psbt(wallet, &spend);
        let mut entry = json!({ "note": note, "unsignedHex": hex(&unsigned.serialize()) });
        let fee: u64 = spend.inputs.iter().map(|i| i.4).sum::<u64>() - spend.outputs.iter().map(|o| o.1).sum::<u64>();
        entry["fee"] = json!(fee);
        entry["outputs"] = json!(spend
            .outputs
            .iter()
            .map(|(s, v, _)| json!({
                "address": Address::from_script(s, Network::Bitcoin).map(|a| a.to_string()).ok(),
                "value": v
            }))
            .collect::<Vec<_>>());
        // the signature an independent signer makes for each key, over rust-bitcoin's sighash
        let mut sigs = serde_json::Map::new();
        for (key, path) in cosigners {
            let mut copy = unsigned.clone();
            let s = cosign(&mut copy, key, path, &spend);
            sigs.insert(
                key.fp.to_string(),
                json!(s.iter().map(|(h, sig, pk)| json!({ "sighash": h, "signature": sig, "pubkey": pk })).collect::<Vec<_>>()),
            );
        }
        entry["signatures"] = Value::Object(sigs);
        psbts.insert(name.into(), entry);
    };

    let w1_change5 = at(&w1, 1, 5).script_pubkey();
    add(
        "w1Spend",
        &w1,
        Spend {
            inputs: vec![(0xa1, 0, 0, 0, 100_000), (0xa2, 1, 1, 3, 50_000)],
            outputs: vec![(payee_script.clone(), 120_000, None), (w1_change5.clone(), 29_400, Some((w1.clone(), 1, 5)))],
        },
        vec![(&a, p48), (&b, p48)],
        "W1 spend: payment and change at W1 /1/5 with key details on the change, inputs at /0/0 and /1/3",
    );
    add(
        "w1Sweep",
        &w1,
        Spend { inputs: vec![(0xa3, 2, 0, 12, 80_000)], outputs: vec![(payee_script.clone(), 79_000, None)] },
        vec![(&a, p48)],
        "W1 spend with no change",
    );
    add(
        "w1ChangeToW2",
        &w1,
        Spend {
            inputs: vec![(0xa1, 0, 0, 0, 100_000)],
            outputs: vec![(payee_script.clone(), 60_000, None), (at(&w2, 1, 5).script_pubkey(), 39_000, Some((w2.clone(), 1, 5)))],
        },
        vec![],
        "W1 spend whose 'change' pays W2 at /1/5: W2 includes the signer's key, so the output carries its fingerprint and path",
    );
    add(
        "w2Spend",
        &w2,
        Spend {
            inputs: vec![(0xb1, 0, 0, 0, 100_000)],
            outputs: vec![(payee_script.clone(), 60_000, None), (at(&w2, 1, 0).script_pubkey(), 39_000, Some((w2.clone(), 1, 0)))],
        },
        vec![],
        "a spend from W2, which the signer never registered",
    );
    add(
        "w3Spend",
        &w3,
        Spend {
            inputs: vec![(0xc1, 0, 0, 2, 70_000)],
            outputs: vec![(payee_script.clone(), 30_000, None), (at(&w3, 1, 1).script_pubkey(), 39_500, Some((w3.clone(), 1, 1)))],
        },
        vec![(&a, "m/48'/0'/5'/2'")],
        "W3 (mixed paths) spend with change",
    );
    add(
        "w4Spend",
        &w4,
        Spend {
            inputs: vec![(0xd1, 0, 0, 1, 200_000)],
            outputs: vec![(payee_script.clone(), 150_000, None), (at(&w4, 1, 0).script_pubkey(), 49_000, Some((w4.clone(), 1, 0)))],
        },
        vec![(&a, p48)],
        "W4 (3 of 4) spend with change",
    );
    add(
        "w5Spend",
        &w5,
        Spend {
            inputs: vec![(0xe1, 0, 0, 0, 100_000)],
            outputs: vec![(payee_script.clone(), 50_000, None), (at(&w5, 1, 0).script_pubkey(), 49_000, Some((w5.clone(), 1, 0)))],
        },
        vec![(&a_trezor, p48)],
        "W5 (TREZOR passphrase key) spend with change",
    );
    out.insert("psbts".into(), Value::Object(psbts));

    // a full round trip outside the app: W1 spend signed by abandon and legal, finalized by rust-miniscript, which
    // checks the witness satisfies the descriptor; the app's own signature must lead to the same transaction
    let spend = Spend {
        inputs: vec![(0xa1, 0, 0, 0, 100_000), (0xa2, 1, 1, 3, 50_000)],
        outputs: vec![(payee_script.clone(), 120_000, None), (w1_change5.clone(), 29_400, Some((w1.clone(), 1, 5)))],
    };
    let mut full = build_psbt(&w1, &spend);
    cosign(&mut full, &a, p48, &spend);
    cosign(&mut full, &b, p48, &spend);
    full.finalize_mut(&secp).unwrap();
    let tx = full.extract_tx_unchecked_fee_rate();
    out.insert(
        "w1SpendFinal".into(),
        json!({ "tx": miniscript::bitcoin::consensus::encode::serialize_hex(&tx), "txid": tx.compute_txid().to_string() }),
    );

    // W1 spend as Nunchuk fills it: whole previous transactions, no witness UTXOs; the signature for abandon over
    // rust-bitcoin's sighash (the input amounts come from the previous transactions)
    {
        let spend = Spend {
            inputs: vec![(0xf1, 1, 0, 1, 64_000)],
            outputs: vec![(payee_script.clone(), 40_000, None), (at(&w1, 1, 2).script_pubkey(), 23_200, Some((w1.clone(), 1, 2)))],
        };
        let (unsigned, prev_txids) = build_psbt_nonwitness(&w1, &spend);
        let mut copy = unsigned.clone();
        let sigs = cosign(&mut copy, &a, p48, &spend);
        out.insert(
            "w1SpendNonWitness".into(),
            json!({
                "note": "W1 spend with only non_witness_utxo on the input, as Nunchuk's FillPsbt leaves it",
                "unsignedHex": hex(&unsigned.serialize()),
                "prevTxids": prev_txids,
                "fee": 800,
                "signatures": { a.fp.to_string(): sigs.iter().map(|(h, sig, pk)| json!({ "sighash": h, "signature": sig, "pubkey": pk })).collect::<Vec<_>>() },
            }),
        );
    }

    // real exports kept in the repo (tests/unit/fixtures), checked here with rust-miniscript: Sparrow's Specter JSON
    // descriptor has no /0/* suffix and a checksum; Nunchuk's BSMS file uses /** and states its first address
    {
        let sparrow = "wsh(sortedmulti(2,[a3909080/48'/0'/0'/2']xpub6EJoguJn6okK6ymxkU53BZgjf4kqrL19uvTwqVnPRaV8qYvx1RhGtyKZxLhzY4YLCYtvB6DsGk1uR3GFBMvwgc5qz19WAxm2nSXZcoyNftY,[7ab71df0/48'/0'/0'/2']xpub6FL52qF9cn2nL7T8gv6gStR8GcezKF4LgY53VLbi5sqRjc4PpBuYFp3nfep884hkuF9dC7KZ11mkthE1NVzbX98QmoJQqBFxQbHnpJ5vQKB,[f11b9ff2/48'/0'/0'/2']xpub6ERjK6ubp5p7UUByXGadKvHcqEUMxvWPr7DkzqHz7GnnZEqdR9ffE3Y1DffYqRjJzeGWL1st1qH4kEaZCzjVnJoZ2PJUcnThi48D71zd6sJ))#8xvx6q6r";
        // parsing checks the checksum
        let _: Descriptor<DescriptorPublicKey> = Descriptor::from_str(sparrow).unwrap();
        let body = sparrow.split('#').next().unwrap();
        let inner = body.trim_start_matches("wsh(sortedmulti(2,").trim_end_matches("))");
        let with = |suffix: &str| -> Descriptor<DescriptorPublicKey> {
            let keys: Vec<String> = inner.split(',').map(|k| format!("{}{}", k, suffix)).collect();
            Descriptor::from_str(&format!("wsh(sortedmulti(2,{}))", keys.join(","))).unwrap()
        };
        let r = with("/0/*");
        let c = with("/1/*");
        let nunchuk_keys = [
            "[3f5e4e09/48'/0'/0']xpub6BtEVX9WezWA2EYa8Wf1rJTokXpF96Rmqr4JKoR3SbjGw1vCa3Qb91mKN1AqJnBzSpqy44tEMB27Khne6KBmNzurXigfis7F28X5dRLWGoY",
            "[b96bc7c7/48'/0'/0']xpub6CzCTuwFmAcBoxsfPLgiKfkJ2W3GbW1zxFKvCamZQ1J2XMobJR1gMNqP64pcFsy65ST4WcZtrCn99WXgLcWM6bqw6iFneAPTgJuLHggHD5S",
            "[44437f41/48'/0'/0']xpub6Cn4cYgRhXKnvNjE4ULP2mzWHFw4WtCyp1nBuE97SyZVTPwq5xWkKsTVe9c16XSTr6V9AKMDgizav7z69j4AREaMKoFzUDbdcZhVq5xaKMU",
        ];
        let nunchuk = |branch: &str| -> Descriptor<DescriptorPublicKey> {
            let keys: Vec<String> = nunchuk_keys.iter().map(|k| format!("{}/{}/*", k, branch)).collect();
            Descriptor::from_str(&format!("wsh(sortedmulti(2,{}))", keys.join(","))).unwrap()
        };
        let depths: Vec<u8> = nunchuk_keys
            .iter()
            .map(|k| Xpub::from_str(k.split(']').nth(1).unwrap()).unwrap().depth)
            .collect();
        out.insert(
            "realExports".into(),
            json!({
                "sparrowReceive0": r.at_derivation_index(0).unwrap().address(Network::Bitcoin).unwrap().to_string(),
                "sparrowReceive1": r.at_derivation_index(1).unwrap().address(Network::Bitcoin).unwrap().to_string(),
                "sparrowChange0": c.at_derivation_index(0).unwrap().address(Network::Bitcoin).unwrap().to_string(),
                "nunchukReceive0": nunchuk("0").at_derivation_index(0).unwrap().address(Network::Bitcoin).unwrap().to_string(),
                "nunchukChange0": nunchuk("1").at_derivation_index(0).unwrap().address(Network::Bitcoin).unwrap().to_string(),
                "nunchukKeyDepths": depths,
            }),
        );
    }

    let _ = PsbtSighashType::from(EcdsaSighashType::All);
    println!("{}", serde_json::to_string_pretty(&Value::Object(out.into_iter().collect())).unwrap());
}
