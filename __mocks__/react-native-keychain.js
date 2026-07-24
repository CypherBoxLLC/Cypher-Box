// In-memory react-native-keychain mock for jest.
const vault = new Map();

const ACCESSIBLE = {
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
};

async function getGenericPassword(options) {
  const service = options && options.service;
  if (service && vault.has(service)) {
    return { username: service, password: vault.get(service), service };
  }
  return false;
}

async function setGenericPassword(username, password, options) {
  const service = (options && options.service) || username;
  vault.set(service, password);
  return { service };
}

async function resetGenericPassword(options) {
  if (options && options.service) vault.delete(options.service);
  return true;
}

module.exports = {
  getGenericPassword,
  setGenericPassword,
  resetGenericPassword,
  ACCESSIBLE,
  __vault: vault,
};
