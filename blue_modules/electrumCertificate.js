/**
 * Telling a refused server certificate from a server that is simply down.
 *
 * Every Electrum TLS connection checks the server's certificate (GuardedElectrumClient): it must come from an authority
 * the phone trusts and name the host dialed. When it doesn't, the failure arrives as whatever the platform says, and the
 * user has to do something different about it than about a dead server, so it is told apart here:
 * - Android (react-native-tcp-socket) hands JS the native exception's text as a string, e.g.
 *   "java.security.cert.CertPathValidatorException: Trust anchor for certification path not found." for a self-signed
 *   certificate, or "Hostname x.example not verified: ..." for one issued to another name.
 * - iOS hands over the NSError's description, e.g. "The operation couldn’t be completed. (kCFStreamErrorDomainSSL error
 *   -9807.)" (errSSLXCertChainInvalid; -9843 is errSSLHostNameMismatch).
 * - node (unit tests, scripts) gives an Error with a code such as DEPTH_ZERO_SELF_SIGNED_CERT, CERT_HAS_EXPIRED or
 *   ERR_TLS_CERT_ALTNAME_INVALID ("Hostname/IP does not match certificate's altnames").
 */
const CERTIFICATE_ERROR =
  /certificat|trust anchor|not verified|subjectaltname|altnames|self.signed|sslhandshake|sslpeerunverified|kcfstreamerrordomainssl|osstatus error -98\d\d|cert_|_cert\b|hostname_mismatch/i;

/**
 * @param e {Error|string|*} what the socket reported
 * @returns {boolean} whether the connection failed because the server's certificate was refused
 */
function isCertificateError(e) {
  if (!e) return false;
  const text = typeof e === 'string' ? e : `${e.code || ''} ${e.message || ''}`;
  return CERTIFICATE_ERROR.test(text);
}

/** A server answered, but its certificate was refused, so nothing was sent to it. */
class ElectrumCertificateError extends Error {
  constructor(host, port, cause) {
    super(`Certificate of ${host}:${port} refused: ${typeof cause === 'string' ? cause : cause?.message || cause}`);
    this.name = 'ElectrumCertificateError';
    this.host = host;
    this.port = port;
  }
}

module.exports = { isCertificateError, ElectrumCertificateError };
