import {
  ARK_BACKUP_DECRYPT_FAILED,
  ARK_BACKUP_ENTRY_WRONG_SHAPE,
  ARK_BACKUP_MALFORMED,
  ARK_BACKUP_NO_CIPHERTEXT,
  ARK_BACKUP_NO_FILES,
} from '@Cypher/services/ark/backup';
import loc from '../../../../loc';

/**
 * A backup file's error in the app's language, for the "Backup file is corrupt" message. backup.ts throws these in
 * English, which the logs keep, so they're translated here, where they're shown. A message it doesn't know (the ones
 * already translated where they're thrown, or bark's own) is returned as it is.
 */
export default function backupErrorText(message: string): string {
  const errors = loc.cypherbox.services.ark_backup;
  const known: Record<string, string> = {
    [ARK_BACKUP_MALFORMED]: errors.malformed,
    [ARK_BACKUP_NO_CIPHERTEXT]: errors.missing_ciphertext,
    [ARK_BACKUP_DECRYPT_FAILED]: errors.decrypt_failed,
    [ARK_BACKUP_NO_FILES]: errors.no_files,
    [ARK_BACKUP_ENTRY_WRONG_SHAPE]: errors.entry_wrong_shape,
  };
  if (known[message]) return known[message];
  const version = /^Unsupported backup version (.*); this build understands v(\d+)-v(\d+)$/.exec(message);
  if (version) {
    return String(loc.formatString(errors.unsupported_version, { version: version[1], oldest: version[2], newest: version[3] }));
  }
  const path = /^Manifest contains unsafe path: ([\s\S]*)$/.exec(message);
  if (path) return String(loc.formatString(errors.unsafe_path, { path: path[1] }));
  return message;
}
