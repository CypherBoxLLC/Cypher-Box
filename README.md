# Cypher Box - A Fun Way to Play Bitcoin
Https://Cypherbox.io

[LICENSE](./LICENSE)

Forked from [BlueWallet](https://github.com/BlueWallet/BlueWallet) Release 6.5.1, tailored for onbaording newbies to advanced self-custody

Built with React Native, Electrum, and powered by Coinos.io API

---

# BUILD & RUN IT

Please refer to the `engines` field in `package.json` file for the minimum required versions of Node and npm. It is preferred that you use an even-numbered version of Node as these are LTS versions.

To view the version of Node and npm in your environment, run the following in your console:

`node --version && npm --version`
In your console:

* `https://github.com/Bamskki/Cypher-Box.git`
* `cd Cypher-Box` 
* `npm install`

Please make sure that your console is running the most stable versions of npm and node (even-numbered versions).

To run on Android:
You will now need to either connect an Android device to your computer or run an emulated Android device using AVD Manager which comes shipped with Android Studio. To run an emulator using AVD Manager:

1. Download and run Android Studio
2. Click on "Open an existing Android Studio Project"
3. Open build.gradle file under Cypher-Box/android/ folder
4. Android Studio will take some time to set things up. Once everything is set up, go to Tools -> AVD Manager. This option may take some time to appear in the menu if you're opening the project in a freshly-installed version of Android Studio.
5. Click on "Create Virtual Device..." and go through the steps to create a virtual device
6. Launch your newly created virtual device by clicking the Play button under Actions column
Once you connected an Android device or launched an emulator, run this:

`npx react-native run-android`
The above command will build the app and install it. Once you launch the app it will take some time for all of the dependencies to load. Once everything loads up, you should have the built app running.

To run on iOS:
* `npx pod-install`
* `npm start`

In another terminal window within the BlueWallet folder:

`npx react-native run-ios`

**To debug Cypher-Box on the iOS Simulator, you must choose a Rosetta-compatible iOS Simulator. This can be done by navigating to the Product menu in Xcode, selecting Destination Architectures, and then opting for "Show Both." This action will reveal the simulators that support Rosetta.**

* To run on macOS using Mac Catalyst:
* `npx pod-install`
* `npm start`

Open ios/BlueWallet.xcworkspace. Once the project loads, select the scheme/target BlueWallet-NoLDK. Click Run.

---

BlueWallet's [repo](https://github.com/BlueWallet/BlueWallet/)

Website: [cypherbox.io](cypherbox.io)

Community: [telegram group](https://t.me/BitcoinUserSupport)

---

Lightning Account:
* Create/login to Coinos.io 
* Send and receive lightning, Liquid, and onchain payments
* Create lightning address
* Payment history, Withdrawal Threshold reminder
* Withdraw to Vault
* Authentication token(s) for custodian API(s) are only accessable by the user

Hot Vault:
* Private keys never leave your device
* SegWit-first, Bip39, Replace-By-Fee, and Child-Pay-For-Parent support
* Coin control
* Top-up Lightning Account
* Send to Cold Vault

Cold Vault (watch-only):
* Private keys never leave your device
* SegWit-first, Bip39, Replace-By-Fee, and Child-Pay-For-Parent support
* Coin control
* Top-up Lightning Account
* PSBT
* Send to Hot Vault

---
Medium-term Development Milestones (last update 12th Feb '25)
**Global**
- ⭕ Plausiable Deniability

**Checking account**
- ⭕ Send Liquid
- ✅ Bolt 12
- ⭕ NWC and new integration API integrations

**Hot vault**
- ✅ Batching
- ⭕ Send change to Checking Account

**Cold vault**
- ⭕ Batching
- ⭕ Send change to Hot Vault
---
Technical debt:
- ⏱️ Notifications
- ⏱️ UI inconsistencies
- ⏱️ Recieve popup
- ⏱️ Checking Account settings 

# RESPONSIBLE DISCLOSURE
Found critical bugs/vulnerabilities?
- Please email info@cypherbox.io
- Please do not publicly disclose vulnerabilities until they have been resolved.
- Valid, responsible disclosures may qualify for a bounty reward based on the severity of the issue.
Thank you for helping us keep our project secure!





