/**
 * Tor-for-Vaults POC harness (throwaway — claude/tor-vaults-poc worktree only).
 *
 * Proves the two POC pass criteria on the iOS simulator:
 *   #1  TorPoc.start() bootstraps embedded Tor (Tor.framework) under RN 0.76 new arch.
 *   #2  A .onion Electrum server answers server.version through the local SOCKS port.
 *
 * Stage A first hits a rock-stable onion (DuckDuckGo) so a dead Electrum server
 * can't masquerade as "Tor is broken". Stage B is the real target.
 *
 * Everything logs with the [TorPOC] prefix — watch Metro / `npx react-native log-ios`.
 */
import { NativeModules, NativeEventEmitter } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';

const { TorPoc } = NativeModules;

const STABLE_ONION = 'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion';

// Mainnet Electrum onion servers (plaintext TCP port; onion provides the crypto).
// From spesmilo/electrum mainnet servers.json. First that answers wins.
const ELECTRUM_ONIONS: Array<{ host: string; port: number }> = [
  { host: 'bejqtnc64qttdempkczylydg7l3ordwugbdar7yqbndck53ukx7wnwad.onion', port: 50001 },
  { host: 'venmrle3xuwkgkd42wg7f735l6cghst3sdfa3w3ryib2rochfhld6lid.onion', port: 50001 },
  { host: 'wsw6tua3xl24gsmi264zaep6seppjyrkyucpsmuxnjzyt3f3j6swshad.onion', port: 50001 },
];

const log = (...a: any[]) => console.log('[TorPOC]', ...a);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Open a TCP socket to the local Tor SOCKS5 port and CONNECT to destHost:destPort. */
function socksConnect(socksPort: number, destHost: string, destPort: number, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    let stage: 'greet' | 'connect' | 'done' = 'greet';
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch {}
      reject(new Error(`SOCKS connect to ${destHost}:${destPort} timed out`));
    }, timeoutMs);

    const socket = TcpSocket.createConnection({ host: '127.0.0.1', port: socksPort, tls: false }, () => {
      // greeting: VER=5, 1 method, NO-AUTH(0x00)
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on('data', (data: any) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (stage === 'greet') {
        if (buf[0] !== 0x05 || buf[1] !== 0x00) {
          clearTimeout(timer); socket.destroy();
          return reject(new Error(`SOCKS greeting rejected: ${buf[0]},${buf[1]}`));
        }
        // CONNECT (CMD=1), ATYP=domain(3)
        const hostBytes = Buffer.from(destHost, 'utf8');
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
          hostBytes,
          Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff]),
        ]);
        stage = 'connect';
        socket.write(req);
      } else if (stage === 'connect') {
        if (buf[1] !== 0x00) {
          clearTimeout(timer); socket.destroy();
          return reject(new Error(`SOCKS CONNECT failed, REP=${buf[1]}`));
        }
        stage = 'done';
        clearTimeout(timer);
        resolve(socket); // tunnel is open; caller now owns data events
      }
    });
    socket.on('error', (e: any) => { clearTimeout(timer); reject(new Error('socket error: ' + (e?.message || e))); });
    socket.on('close', () => { if (stage !== 'done') { clearTimeout(timer); reject(new Error('socket closed before tunnel open')); } });
  });
}

/** Stage A: prove onion routing works against a stable onion. */
async function checkStableOnion(socksPort: number, timeoutMs = 9000): Promise<boolean> {
  const socket = await socksConnect(socksPort, STABLE_ONION, 80, timeoutMs);
  return new Promise((resolve) => {
    let got = false;
    socket.on('data', (d: any) => {
      if (!got) { got = true; log('Stage A OK: onion responded', (Buffer.isBuffer(d) ? d : Buffer.from(d)).slice(0, 24).toString()); socket.destroy(); resolve(true); }
    });
    socket.on('error', () => resolve(got));
    socket.write(Buffer.from(`HEAD / HTTP/1.0\r\nHost: ${STABLE_ONION}\r\n\r\n`, 'utf8'));
    setTimeout(() => { if (!got) { socket.destroy(); resolve(false); } }, timeoutMs);
  });
}

/** Stage B: real target — server.version against an onion Electrum server. */
async function checkElectrumOnion(socksPort: number): Promise<boolean> {
  for (const { host, port } of ELECTRUM_ONIONS) {
    try {
      log('Stage B: connecting to electrum onion', host, port);
      const socket = await socksConnect(socksPort, host, port);
      const ok: boolean = await new Promise((resolve) => {
        let answered = false;
        socket.on('data', (d: any) => {
          const text = (Buffer.isBuffer(d) ? d : Buffer.from(d)).toString('utf8');
          if (!answered) { answered = true; log('Stage B OK: electrum replied:', text.trim().slice(0, 200)); socket.destroy(); resolve(true); }
        });
        socket.on('error', () => resolve(answered));
        socket.write(Buffer.from('{"id":1,"method":"server.version","params":["torpoc","1.4"]}\n', 'utf8'));
        setTimeout(() => { if (!answered) { socket.destroy(); resolve(false); } }, 25000);
      });
      if (ok) return true;
      log('Stage B: no answer from', host, '— trying next');
    } catch (e: any) {
      log('Stage B: failed for', host, '-', e?.message || e);
    }
  }
  return false;
}

/** Entry point. Call once from index.js behind a flag. */
export async function runTorPoc(): Promise<void> {
  try {
    if (!TorPoc) { log('FAIL: NativeModules.TorPoc is undefined — native module not linked'); return; }
    const emitter = new NativeEventEmitter(TorPoc);
    const sub = emitter.addListener('torStatus', (e) => log('status:', e.stage, e.detail));

    log('starting embedded Tor…');
    const t0 = Date.now();
    const { socksPort } = await TorPoc.start();
    log(`Tor ready in ${((Date.now() - t0) / 1000).toFixed(1)}s, SOCKS on 127.0.0.1:${socksPort}`);

    // Tor may still be bootstrapping when SOCKS first listens. Retry the stable
    // onion probe until it routes — a successful onion connection is the real
    // proof Tor bootstrapped (Criterion #1) and onion routing works.
    log('warming up Tor circuit (retry stable onion until it routes)…');
    let a = false;
    for (let i = 1; i <= 20 && !a; i++) {
      try { a = await checkStableOnion(socksPort); } catch { a = false; }
      if (!a) { log(`circuit not ready, retry ${i}/20`); await sleep(3000); }
    }
    const b = a ? await checkElectrumOnion(socksPort) : false;

    log('==================== RESULT ====================');
    log(`Native bridge + embedded Tor (new arch):   PASS (thread up, SOCKS listening)`);
    log(`Criterion #1 (Tor bootstrapped + routing): ${a ? 'PASS' : 'FAIL'}`);
    log(`Criterion #2 (onion Electrum round-trip):  ${b ? 'PASS' : 'FAIL'}`);
    log(`OVERALL: ${a && b ? 'GO — build the production module' : 'INVESTIGATE'}`);
    log('================================================');
    sub.remove();
  } catch (e: any) {
    log('FAIL:', e?.code || '', e?.message || e);
    log('==================== RESULT ====================');
    log('Criterion #1 (Tor bootstrap on new arch): FAIL — see error above');
    log('================================================');
  }
}
