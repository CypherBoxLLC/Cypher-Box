import Lnurl from './lnurl';
import usePaymentLinkStore from '../src/stores/paymentLinkStore';
import { isSeedSignerLocked } from '../src/services/seedSignerLock';

const bitcoin = require('bitcoinjs-lib');
const bip21 = require('bip21');

class DeeplinkSchemaMatch {
  static hasSchema(schemaString) {
    if (typeof schemaString !== 'string' || schemaString.length <= 0) return false;
    const lowercaseString = schemaString.trim().toLowerCase();
    return lowercaseString.startsWith('bitcoin:') || lowercaseString.startsWith('lightning:') || lowercaseString.startsWith('cypherbox:');
  }

  /**
   * Examines the content of the event parameter.
   * If the content is recognizable, create a dictionary with the respective
   * navigation dictionary required by react-navigation
   *
   * A bitcoin: or lightning: link is paid like a scanned QR code: it opens the home screen, whose "Scan with" picker
   * asks which wallet pays it. BlueWallet's other links (its widget, Lightning browser, server settings, wallet
   * imports) open nothing, and neither does a file: Cypher Box takes files only through its own "open file" buttons.
   *
   * @param event {{url: string}} URL deeplink as passed to app, e.g. `bitcoin:bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7?amount=666&label=Yo`
   * @param completionHandler {function} Callback that returns [string, params: object]
   */
  static navigationRouteFor(event, completionHandler) {
    if (event.url === null) {
      return;
    }
    if (typeof event.url !== 'string') {
      return;
    }

    if (event.url.toLowerCase().startsWith('cypherbox:bitcoin:') || event.url.toLowerCase().startsWith('cypherbox:lightning:')) {
      event.url = event.url.substring('cypherbox:'.length);
    }

    if (DeeplinkSchemaMatch.isPaymentLink(event.url)) {
      // a seed-signer pays nothing
      if (isSeedSignerLocked()) return;
      usePaymentLinkStore.getState().setLink(event.url.trim().replace(/^(bitcoin|lightning):\/\//i, '$1:'));
      completionHandler(['HomeScreen']);
    }
  }

  /**
   * A bitcoin: or lightning: link to pay: an address, an invoice, an LNURL or a Lightning address, or a bitcoin: link
   * that carries an invoice too. Bare text is not a link.
   *
   * @param url {string}
   * @return {boolean}
   */
  static isPaymentLink(url) {
    const lowercaseUrl = url.trim().toLowerCase();
    if (lowercaseUrl.startsWith('bitcoin:')) {
      return DeeplinkSchemaMatch.isBitcoinAddress(url.trim()) || !!DeeplinkSchemaMatch.isBothBitcoinAndLightning(url.trim());
    }
    if (lowercaseUrl.startsWith('lightning:')) {
      const destination = url.trim().replace(/^lightning:(\/\/)?/i, '');
      return (
        DeeplinkSchemaMatch.isLightningInvoice(destination) ||
        DeeplinkSchemaMatch.isLnUrl(destination) ||
        Lnurl.isLightningAddress(destination)
      );
    }
    return false;
  }

  /**
   * Extracts server from a deeplink like `cypherbox:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As`
   * returns FALSE if none found
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getServerFromSetElectrumServerAction(url) {
    if (!url.startsWith('cypherbox:setelectrumserver') && !url.startsWith('setelectrumserver')) return false;
    const splt = url.split('server=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  /**
   * Extracts url from a deeplink like `cypherbox:setlndhuburl?url=https%3A%2F%2Flndhub.herokuapp.com`
   * returns FALSE if none found
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getUrlFromSetLndhubUrlAction(url) {
    if (!url.startsWith('cypherbox:setlndhuburl') && !url.startsWith('setlndhuburl')) return false;
    const splt = url.split('url=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  static isTXNFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('.txn')
    );
  }

  static isPossiblySignedPSBTFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('-signed.psbt')
    );
  }

  static isPossiblyPSBTFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('.psbt')
    );
  }

  static isBitcoinAddress(address) {
    address = address.replace('://', ':').replace('bitcoin:', '').replace('BITCOIN:', '').replace('bitcoin=', '').split('?')[0];
    let isValidBitcoinAddress = false;
    try {
      bitcoin.address.toOutputScript(address);
      isValidBitcoinAddress = true;
    } catch (err) {
      isValidBitcoinAddress = false;
    }
    return isValidBitcoinAddress;
  }

  static isLightningInvoice(invoice) {
    let isValidLightningInvoice = false;
    if (
      invoice.toLowerCase().startsWith('lightning:lnb') ||
      invoice.toLowerCase().startsWith('lightning://lnb') ||
      invoice.toLowerCase().startsWith('lnb')
    ) {
      isValidLightningInvoice = true;
    }
    return isValidLightningInvoice;
  }

  static isLnUrl(text) {
    return Lnurl.isLnurl(text);
  }

  static isBothBitcoinAndLightning(url) {
    if (url.includes('lightning') && (url.includes('bitcoin') || url.includes('BITCOIN'))) {
      const txInfo = url.split(/(bitcoin:\/\/|BITCOIN:\/\/|bitcoin:|BITCOIN:|lightning:|lightning=|bitcoin=)+/);
      let btc;
      let lndInvoice;
      for (const [index, value] of txInfo.entries()) {
        try {
          // Inside try-catch. We dont wan't to  crash in case of an out-of-bounds error.
          if (value.startsWith('bitcoin') || value.startsWith('BITCOIN')) {
            btc = `bitcoin:${txInfo[index + 1]}`;
            if (!DeeplinkSchemaMatch.isBitcoinAddress(btc)) {
              btc = false;
              break;
            }
          } else if (value.startsWith('lightning')) {
            const lnpart = txInfo[index + 1].split('&').find(el => el.toLowerCase().startsWith('ln'));
            lndInvoice = `lightning:${lnpart}`;
            if (!this.isLightningInvoice(lndInvoice)) {
              lndInvoice = false;
              break;
            }
          }
        } catch (e) {
          console.log(e);
        }
        if (btc && lndInvoice) break;
      }
      if (btc && lndInvoice) {
        return { bitcoin: btc, lndInvoice };
      } else {
        return undefined;
      }
    }
    return undefined;
  }

  static bip21decode(uri) {
    if (!uri) return {};
    let replacedUri = uri;
    for (const replaceMe of ['BITCOIN://', 'bitcoin://', 'BITCOIN:']) {
      replacedUri = replacedUri.replace(replaceMe, 'bitcoin:');
    }

    return bip21.decode(replacedUri);
  }

  static bip21encode() {
    const argumentsArray = Array.from(arguments);
    for (const argument of argumentsArray) {
      if (String(argument.label).replace(' ', '').length === 0) {
        delete argument.label;
      }
      if (!(Number(argument.amount) > 0)) {
        delete argument.amount;
      }
    }
    return bip21.encode.apply(bip21, argumentsArray);
  }

  static decodeBitcoinUri(uri) {
    let amount = '';
    let parsedBitcoinUri = null;
    let address = uri || '';
    let memo = '';
    let payjoinUrl = '';
    try {
      parsedBitcoinUri = DeeplinkSchemaMatch.bip21decode(uri);
      address = 'address' in parsedBitcoinUri ? parsedBitcoinUri.address : address;
      if ('options' in parsedBitcoinUri) {
        if ('amount' in parsedBitcoinUri.options) {
          amount = parsedBitcoinUri.options.amount.toString();
          amount = parsedBitcoinUri.options.amount;
        }
        if ('label' in parsedBitcoinUri.options) {
          memo = parsedBitcoinUri.options.label || memo;
        }
        if ('pj' in parsedBitcoinUri.options) {
          const pjCandidate = parsedBitcoinUri.options.pj;
          // BIP78: the payjoin endpoint must be HTTPS (HTTP only for .onion,
          // which this build does not support). A cleartext or non-HTTP pj=
          // endpoint would receive the PSBT in the clear, so drop it here and
          // fall back to a normal (non-payjoin) send.
          if (typeof pjCandidate === 'string' && /^https:\/\/.+/.test(pjCandidate)) {
            payjoinUrl = pjCandidate;
          }
        }
      }
    } catch (_) { }
    return { address, amount, memo, payjoinUrl };
  }
}

export default DeeplinkSchemaMatch;
