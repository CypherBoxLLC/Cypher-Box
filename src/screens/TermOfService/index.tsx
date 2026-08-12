import { ScreenLayout, Text } from '@Cypher/component-library';
import { GradientText } from '@Cypher/components';
import { colors } from '@Cypher/style-guide';
import React from 'react';
import { View, StyleSheet, ScrollView, Linking } from 'react-native';

const ASP_TERMS_URL = 'https://second.tech/terms';

const TermsOfService = () => {
    const openAspTerms = () => {
        Linking.openURL(ASP_TERMS_URL);
    };

    return (
        <ScreenLayout showToolbar disableScroll>
            <GradientText style={styles.title} center>Terms of Service & Privacy Policy</GradientText>
            <Text style={styles.lastUpdated} center>Last Updated: August 2026</Text>
            <View style={styles.divider} />
            <ScrollView style={styles.container} showsVerticalScrollIndicator={true}
                indicatorStyle='white'
            >
                {/* ===== TERMS OF SERVICE ===== */}
                <Text style={styles.sectionTitle}>TERMS OF SERVICE</Text>

                <View style={styles.section}>
                    <Text style={styles.paragraph}>
                        This is a contract (the "Agreement") between you and Cypher Box LLC ("Cypher Box," "we," or "us"), a company registered and incorporated under the laws of Delaware whose registered office is 8 The Green, Suite B, Dover, Delaware 19901, USA. References in this Agreement to "you" and "your" are to the person with whom Cypher Box enters into this Agreement.
                    </Text>
                    <Text style={styles.paragraph}>
                        By checking the box, clicking on "Start," "I understand," "Next," or similar terms when you open the application and go through the instructions and warnings with regards to using our integrated third-party APIs and Vaults (all referred to as "Services"), or by proceeding with a download or update when offered a choice of proceeding or not, you are agreeing to be bound by the terms and conditions found in this Agreement. You represent and warrant that you have the power and capacity to enter into this Agreement.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>1. Third-Party Lightning Account(s)</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box lets you connect through API(s) (create account and/or login) to one or more Bitcoin custodians that (if benevolent) allow you to request sending and receiving payments quickly and cheaply in Bitcoin (BTC) through their Lightning Network infrastructure. Currently integrated custodians include:
                    </Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• CoinOS: A Lightning Network service provider accessible via username and password authentication.</Text>
                        <Text style={styles.listItem}>• Strike: A regulated cryptocurrency exchange accessible via OAuth 2.0 authentication.</Text>
                    </View>
                    <Text style={styles.paragraph}>
                        A custodian is an entity that allows you to transact and accumulate bitcoin (up to a certain subjective threshold) quickly and cheaply depending on your jurisdiction. The funds stored on your custodian Lightning Account(s) are technically under the full control of the custodian, NOT OURS, NOT YOURS. The balance shown on your Lightning Account(s) may or may not be real Bitcoin.
                    </Text>
                    <Text style={styles.paragraph}>
                        Despite our efforts in choosing trusted and regulated Bitcoin custodians, we can never be certain that when you use the "Receive," "Send," "Top-up," or "Withdraw" functions the custodian(s) will credit/debit your Lightning Account(s) balance(s) if you receive/send bitcoin from/to another user or from/to your Vault with the fees they advertise, or if they will uphold their promise in keeping their internal ledger matched one to one with their bitcoin reserves.
                    </Text>
                    <Text style={styles.paragraph}>
                        Moreover, while we carefully selected our custodians for reliability, we cannot guarantee 24/7 uptime or that your particular transactions will be processed by them. Custodians might face liquidity issues or other technical problems that can only be solved on their side, NOT OURS.
                    </Text>
                    <Text style={styles.paragraph}>
                        A Bitcoin custodian, just like a regular bank or exchange, can seize, freeze, or steal the balance displayed in your Lightning Account. Custodians can sometimes get hacked. Cypher Box LLC is not liable for any funds stolen by the custodian(s) we integrate with.
                    </Text>
                    <Text style={styles.paragraph}>
                        If you face any problems in Lightning Account(s), you should first login to your custodian's website or mobile application and validate your balance and transaction history from their side. Cypher Box is not liable for any error that occurs within the custodian(s)'s ledger(s) or in the transfer of requests and callbacks through their API.
                    </Text>
                    <Text style={styles.paragraph}>
                        Due to all the uncertainties mentioned above, we highly recommend that you: read and follow the instructions; only store a measured amount of bitcoin inside your Lightning Account; use multiple custodian Lightning Accounts to spread the counter-party risk; periodically monitor your Lightning Accounts' balances and activities from the custodian(s)' website or application; and once you're knowledgeable enough to understand self-custody, withdraw your bitcoin into one of your Vaults, preferably when your balance reaches the threshold where it makes economic sense to pay for Bitcoin Network fees and demand real ownership over your funds.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>2. Crypto Exchanges</Text>
                    <Text style={styles.paragraph}>
                        Some custodians in Cypher Box may give you the option to buy or sell bitcoin for fiat currency depending on your jurisdiction. These regulated exchanges may also run their own Lightning infrastructure, allowing you to transact in bitcoin quickly and cheaply. However, all the risks, uncertainties, and guidelines mentioned above with regular bitcoin custodians also apply to cryptocurrency exchanges.
                    </Text>
                    <Text style={styles.paragraph}>
                        Cypher Box LLC is not liable for any financial losses due to a failure or error in executing any trade happening between you and a cryptocurrency exchange available through our app.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>3. Self-Custodial Vault(s)</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box enables you to create single, hierarchical deterministic (HD), non-custodial wallet(s) (referred to as "Vault(s)") for Bitcoin. You can use these Vaults to withdraw from your Lightning Account(s), store, send, and receive the digital asset Bitcoin only (BTC). Section 5 below describes a separate non-custodial Lightning offering, the Bark Vault, which uses its own seedphrase and refresh mechanism.
                    </Text>
                    <Text style={styles.paragraph}>
                        In order to use the hot or cold storage Vault(s) you are expected to be fully aware of the dangers associated with securing your 12-word backup seedphrase. You are expected to know that: you should never lose access to your seedphrase(s); you should write the words in their correct order on a physical medium such as paper or a metallic plate; you should make multiple physical copies and store them in secure locations; you should never share them with anyone including us; and you should never ask us to recover your Vault(s) funds because the only entity capable of doing so is the one that holds the private keys represented in the form of a 12-word seedphrase, which is YOU, NOT US.
                    </Text>
                    <Text style={styles.paragraph}>
                        These Vaults are intended for use by persons who are knowledgeable about cryptocurrency generally and HD non-custodial wallets in particular. If you read our instructions and warnings carefully and understand the risks associated with self-custody, you represent that you qualify as such a person.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>4. UTXO Capsules, Top-Up, and Withdraw Functions</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box allows you to view and manage individual unspent transaction outputs ("UTXOs"), referred to in the app as "Capsules." When sending bitcoin from a Vault or topping up a Lightning Account from a Vault, you may be prompted to select specific Capsules to include in the transaction.
                    </Text>
                    <Text style={styles.paragraph}>
                        The Top-up function allows you to move bitcoin from a self-custodial Vault to a custodian Lightning Account by generating a Lightning invoice and constructing an on-chain transaction from your selected Capsules. The Withdraw function allows you to move bitcoin from a custodian Lightning Account to a self-custodial Vault.
                    </Text>
                    <Text style={styles.paragraph}>
                        You may configure automated withdrawal thresholds that trigger withdrawals from your Lightning Account(s) to your Vault(s) when your custodian balance exceeds a specified amount. You acknowledge that these automated withdrawals, once configured by you, will execute without per-transaction confirmation. You are responsible for setting appropriate thresholds and monitoring their operation.
                    </Text>
                    <Text style={styles.paragraph}>
                        Cypher Box LLC is not liable for any financial loss arising from incorrectly constructed transactions, incorrect Capsule selection, misconfigured thresholds, or network fee miscalculations associated with these functions.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>5. Non-Custodial Lightning Vault (Bark Vault)</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box enables you to create a non-custodial Lightning wallet (the "Bark Vault") that participates in a shared-signing Bitcoin protocol coordinated by a third-party Ark Service Provider ("ASP"). The ASP currently used by the Bark Vault is TwoND, Inc., doing business as Second ("Second"), which operates the Ark server at ark.second.tech.
                    </Text>
                    <Text style={styles.paragraph}>
                        Unlike the third-party custodian Lightning Accounts described in Section 1, the ASP never takes custody of your Bark Vault funds and cannot unilaterally spend them. Every movement of your funds requires a signature that only you can produce. That guarantee is narrower than it may first appear, and you should read the rest of this section before funding a Bark Vault. In particular, the ASP can decline to co-sign your transactions, and it can sweep a VTXO that you allow to expire.
                    </Text>
                    <Text style={styles.paragraph}>
                        The Bark Vault relies on the ASP's software development kit ("ASP's SDK") to construct co-signed virtual transaction outputs ("VTXOs") that represent your balance. The ASP serves as a coordinator and liquidity provider for these VTXOs but never holds custody of your private keys. Cypher Box LLC is not affiliated with the ASP and has no control over its operations, uptime, availability, fees, or decision to continue providing service.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Seedphrase generation and backup.
                    </Text>
                    <Text style={styles.paragraph}>
                        When you create a Bark Vault, the application generates a 12-word backup seedphrase locally on your device. The seedphrase is stored in encrypted local storage. You may optionally enable an additional encrypted backup file to be stored in your device's cloud storage service (iCloud on iOS, Google Drive on Android), at your configuration. The backup file is encrypted on your device before upload. Cypher Box LLC does not have access to your seedphrase, your encrypted backup file, or the encryption key. The ASP does not have access either. If you lose access to your seedphrase and all backup copies, your Bark Vault funds will be irrecoverable.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        VTXO expiry and refresh.
                    </Text>
                    <Text style={styles.paragraph}>
                        Funds in a Bark Vault are organized as VTXOs, each with an expiry timestamp set by the ASP when the VTXO is created. Before a VTXO expires, you must either refresh it into a new VTXO (which extends its expiry) or perform an on-chain exit. To assist you, Cypher Box:
                    </Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• Schedules local device notifications to alert you approximately twenty-four (24) hours and six (6) hours before any of your VTXOs are due to expire;</Text>
                        <Text style={styles.listItem}>• Offers an optional auto-refresh function that attempts to refresh VTXOs in the background, subject to your device's operating-system constraints including battery optimization, background-task scheduling, network availability, and similar limitations outside our control;</Text>
                        <Text style={styles.listItem}>• Provides a manual refresh action accessible from the Bark Vault interface.</Text>
                    </View>
                    <Text style={styles.paragraph}>
                        You are responsible for periodically opening the application and acting on expiry notifications. If you do not refresh a VTXO before its expiry and do not perform an on-chain exit, the Ark protocol permits the ASP to sweep the bitcoin that VTXO represents. Under the ASP's own terms, the ASP has no obligation to return swept funds to you, although it may choose to do so at its sole discretion. Cypher Box LLC has no responsibility and will not be liable for any loss arising from a missed refresh, an unacknowledged notification, a disabled notification, or any other failure on your part to act on an expiry warning.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        What the ASP can do without your cooperation.
                    </Text>
                    <Text style={styles.paragraph}>
                        Although the ASP cannot take custody of or unilaterally spend your funds, under its own terms it reserves the right, at its sole discretion and without notice, to refuse to process any operation, to block access from any region or IP address, to decline to co-sign transactions to or from any bitcoin address, and to suspend its service in whole or in part. It may do so for sanctions compliance, for regulatory or licensing reasons, or for any other reason it considers necessary. The practical effect is that the ASP can prevent you from sending, receiving, or refreshing through the Bark Vault even though it cannot take your funds. Your recourse in that situation is the on-chain exit described below, and that recourse depends on your VTXOs not having expired. Cypher Box LLC does not control and cannot influence any such decision by the ASP, and will not be liable for any loss or inability to transact arising from it.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Trustless on-chain exit.
                    </Text>
                    <Text style={styles.paragraph}>
                        At any time, you may initiate an on-chain exit through the application. This process broadcasts the Bitcoin transactions necessary to move your Bark Vault funds to a regular on-chain Bitcoin address that you control, without requiring the cooperation of the ASP or Cypher Box LLC. The exit is subject to Bitcoin Network fees and confirmation times. The same option is available as an emergency recourse if the ASP becomes unavailable, refuses to cooperate, or discontinues its service.
                    </Text>
                    <Text style={styles.paragraph}>
                        The exit relies on pre-signed Bitcoin transactions associated with your live VTXOs, and those transactions must confirm on the Bitcoin Network before the associated VTXOs expire. An exit is therefore something to start early, not at the last moment. Once a VTXO has expired, the exit path for that VTXO may no longer be available to you, and the bitcoin it represented may already have been swept by the ASP. Cypher Box LLC will not be liable for any loss arising from an exit begun too late to confirm, or from Bitcoin Network fee conditions or congestion that delay confirmation.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        ASP dependency for day-to-day operations.
                    </Text>
                    <Text style={styles.paragraph}>
                        Although the ASP cannot take custody of your funds, the ASP's availability is necessary for ordinary Bark Vault operations including receives, sends, refreshes, and Lightning routing. If the ASP becomes unavailable, unreliable, or chooses to discontinue service, you may temporarily lose the ability to transact through the Bark Vault and may need to perform an on-chain exit to retain access to your funds. Cypher Box LLC is not liable for any loss, inability to transact, or any inconvenience arising from the ASP's operational decisions, downtime, fees, or discontinuation of service.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        The ASP's own terms.
                    </Text>
                    <Text style={styles.paragraph}>
                        When you use the Bark Vault, your device connects directly to the ASP's Ark server, and the ASP treats you as a user of its own service under its own terms, currently published at:
                    </Text>
                    <Text style={styles.link} onPress={openAspTerms}>
                        {ASP_TERMS_URL}
                    </Text>
                    <Text style={styles.paragraph}>
                        Those terms are an agreement between you and the ASP. They are not part of this Agreement, and Cypher Box LLC is not a party to them. They contain the ASP's own provisions on VTXO expiry and sweeping, sanctions representations, disclaimers of warranty, limits on the ASP's liability, and a binding arbitration agreement with a class action waiver. You should read them before funding a Bark Vault. Cypher Box LLC did not negotiate those terms, cannot vary them on your behalf, and has no control over the ASP's decision to change them.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>6. Supported Digital Assets</Text>
                    <Text style={styles.paragraph}>
                        Our Services are for use with Bitcoin (BTC) only and any other digital assets we may explicitly decide to support in the future at our discretion ("Digital Assets"). We have no obligation to support any digital assets (including but not limited to any forkcoins, altcoins, airdrops, or any other digital assets however named) other than Bitcoin or any other digital asset we may explicitly decide to support in the future at our discretion. We assume no responsibility or liability in connection with any attempt to use your Vault for digital assets that we do not support.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>7. Responsibility for Lightning Account(s) Credentials, Vault(s) Backup Seedphrases, Passwords, and Other Authentication Means</Text>
                    <Text style={styles.paragraph}>
                        Our Services provide a number of ways for you to secure your funds and help ensure you, and only you, are able to access and transact through Lightning Accounts and Vaults. These features include API authentication tokens, backup seedphrases, passwords, biometrics, among other features.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>8. Mnemonics and Catastrophic Impact of Their Loss or Misappropriation</Text>
                    <Text style={styles.paragraph}>
                        If you use our Services to create a Vault, the software will use an algorithm to generate a random 12-word phrase as a seed to a BIP39 hierarchical wallet. This 12-word phrase is called a backup seedphrase, and if reproduced exactly, stores all the information needed to recover your Vault(s) if access through the App or phone password, Face ID, or other authentication means is lost or otherwise not available.
                    </Text>
                    <Text style={styles.paragraph}>
                        When you create a hot storage Vault, you may optionally supply your own randomness (entropy) for the 12-word seedphrase using the in-app dice or coin entropy tool, instead of relying solely on your device's random number generator. If you choose this option, the security of your Vault depends entirely on the quality and unpredictability of the randomness you provide. You are responsible for generating sufficient, genuinely random entropy: predictable, patterned, biased, or reused inputs can produce a weak seedphrase that a third party may be able to guess or reproduce, which can result in the theft or complete loss of your funds. Cypher Box LLC has no responsibility and will not be liable for any loss arising from insufficient or predictable entropy that you choose to provide.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Cypher Box LLC does not store, have access to, or have any way or means of recovering your backup seedphrase.
                    </Text>
                    <Text style={styles.paragraph}>
                        It is your responsibility to keep your seedphrase secure. You should not provide it to anyone, including any Cypher Box LLC representative.
                    </Text>
                    <Text style={styles.paragraph}>
                        If you permanently forget or lose your backup seedphrase, you will NEVER be able to recover any cryptocurrency in your Vault, and you will suffer a complete, irrecoverable, and catastrophic loss of all Digital Assets in your Vault. It is your responsibility to safeguard and retain your backup seedphrase. Cypher Box has no responsibility and will not be liable for any loss or damage you suffer from the loss or misappropriation of your seedphrases.
                    </Text>
                    <Text style={styles.paragraph}>
                        You may also optionally protect a hot storage Vault with a BIP39 passphrase (sometimes called a "25th word"). A passphrase is applied on top of your 12-word seedphrase and is NEVER stored, transmitted, displayed after creation, or backed up anywhere by the App, by Cypher Box LLC, or by any third party. It is something that only you know. Recovering a passphrase-protected Vault requires BOTH the exact 12-word seedphrase AND the exact passphrase, which is case-sensitive and space-sensitive. If you permanently forget or lose your passphrase, you will NEVER be able to recover any cryptocurrency in that Vault EVEN IF you still possess the correct 12-word seedphrase, and you will suffer a complete, irrecoverable, and catastrophic loss of all Digital Assets in that Vault. It is your responsibility to memorize your passphrase and to record it, together with your seedphrase, on your physical backup. Cypher Box LLC does not store, have access to, or have any means of recovering your passphrase, and has no responsibility and will not be liable for any loss or damage you suffer from the loss or misappropriation of your passphrase.
                    </Text>
                    <Text style={styles.paragraph}>
                        The same risks and responsibilities apply to the seedphrase of any Bark Vault you create under Section 5. The Bark Vault seedphrase is generated and stored separately from your other Vault seedphrases. The optional encrypted cloud backup described in Section 5 is provided for your convenience and does not change the foregoing: Cypher Box LLC does not have access to the backup file or the encryption key, and is not liable for any loss arising from the loss of access to your cloud storage account, the loss of the encryption material protecting the backup, or any failure of the cloud storage service.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>9. Third-Party Integrations</Text>
                    <Text style={styles.paragraph}>
                        Our Services support or are integrated with third-party services, including but not limited to CoinOS, Strike, the Ark Service Provider used by the Bark Vault (Second, at https://second.tech/terms), the ASP's SDK that runs locally on your device, and Google reCAPTCHA (used during CoinOS authentication). We are not responsible for any third-party services and will not be liable for any loss or damage caused by third-party services. Your use of third-party services through our app is also subject to those services' own terms of service and privacy policies, which are agreements between you and that third party rather than between you and Cypher Box LLC. You are responsible for reading them.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>10. Exchange Rates and Price Display</Text>
                    <Text style={styles.paragraph}>
                        Our Services display bitcoin-to-fiat exchange rates obtained from third-party sources including our integrated custodians. These rates are provided for informational purposes only and may not reflect real-time market prices. Cypher Box LLC makes no guarantees regarding the accuracy, timeliness, or completeness of any displayed exchange rates. Rates used in automated threshold calculations, transaction previews, or balance displays may differ from rates available elsewhere. Cypher Box LLC is not liable for any financial loss arising from reliance on displayed exchange rates or from discrepancies between displayed rates and actual transaction rates applied by custodians.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>11. Changes to or Termination of Our Services</Text>
                    <Text style={styles.paragraph}>
                        We may add or remove functions or features of our Services. You can stop using our Services at any time. We may stop providing our Services at any time at our discretion. If we stop providing our Services, for whatever reason, we will endeavor to provide advance notice to you. However, we will have no obligation to do so.
                    </Text>
                    <Text style={styles.paragraph}>
                        If our Services are terminated abruptly without notice, for whatever reason, you should still be able to login to your Lightning Account(s) from your custodian(s) through their website(s) or mobile application(s) if they are available, and you should be able to recover the funds stored in your hot and cold Vaults' addresses using your backup seedphrase(s). Cypher Box LLC has no responsibility and will not be liable for any loss or damage you suffer from the loss of access to or use of your Vault(s) during any termination of our Services.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>12. Your Compliance with Applicable Laws</Text>
                    <Text style={styles.paragraph}>
                        You represent and warrant that you are using the Services, including any non-custodial Vault, in accordance with applicable law, and not for any purpose not in compliance with applicable law, including but not limited to illegal gambling, fraud, money laundering, or terrorist activities.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>13. Limitation of Liability</Text>
                    <Text style={styles.paragraph}>
                        In no event will Cypher Box LLC, its directors, officers, employees, suppliers, agents, or affiliates be liable for any loss or damages, including without limitation direct, indirect, special, consequential, exemplary, or punitive loss or damages, arising from or related to your use of the Services or a Vault, including but not limited to loss of or inability to access or transact data, profit, Digital Assets, or other digital assets or cryptocurrency.
                    </Text>
                    <Text style={styles.paragraph}>
                        Without limiting the generality of the foregoing, Cypher Box LLC and its third-party service providers take no responsibility for and will not be liable for any financial or other loss or damage arising from or related to the use of our Services, including but not limited to any of the following:
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Financial Risks:
                    </Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) access being hacked.</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) being bankrupt.</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) being unavailable.</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) seizing or freezing your account.</Text>
                        <Text style={styles.listItem}>• Financial loss due to loss of access to your Lightning Account(s) credentials.</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) censoring your transactions.</Text>
                        <Text style={styles.listItem}>• Financial loss due to Vault(s) access being brute-forced.</Text>
                        <Text style={styles.listItem}>• Financial loss due to forgotten or lost seedphrases or passwords.</Text>
                        <Text style={styles.listItem}>• Financial loss due to a forgotten or lost hot storage Vault passphrase, even where the 12-word seedphrase is still held.</Text>
                        <Text style={styles.listItem}>• Financial loss due to weak, predictable, or insufficient entropy that you supply when generating a seedphrase.</Text>
                        <Text style={styles.listItem}>• Financial loss due to inability to transact.</Text>
                        <Text style={styles.listItem}>• Financial loss due to errors calculating network fees.</Text>
                        <Text style={styles.listItem}>• Financial loss due to incorrectly constructed transactions or mistyped bitcoin addresses.</Text>
                        <Text style={styles.listItem}>• Financial loss due to phishing or other websites masquerading as Cypher Box LLC.</Text>
                        <Text style={styles.listItem}>• Financial loss due to inaccurate exchange rate data from third-party sources.</Text>
                        <Text style={styles.listItem}>• Financial loss due to misconfigured automated withdrawal thresholds.</Text>
                        <Text style={styles.listItem}>• Financial loss due to a VTXO expiring before refresh or on-chain exit, including the Ark Service Provider sweeping the bitcoin that VTXO represented.</Text>
                        <Text style={styles.listItem}>• Financial loss due to a missed, dismissed, disabled, or otherwise unacknowledged Bark Vault expiry notification.</Text>
                        <Text style={styles.listItem}>• Financial loss due to the Ark Service Provider's unavailability, fee changes, protocol changes, or discontinuation of service.</Text>
                        <Text style={styles.listItem}>• Financial loss due to the Ark Service Provider declining to co-sign a transaction, refusing to process an operation, or blocking access by region or IP address.</Text>
                        <Text style={styles.listItem}>• Financial loss due to an on-chain exit begun too late to confirm before VTXO expiry, or delayed by Bitcoin Network fee conditions or congestion.</Text>
                        <Text style={styles.listItem}>• Financial loss due to loss of access to your Bark Vault seedphrase, the encrypted local backup, or the encrypted cloud backup, or to your iCloud or Google Drive account.</Text>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>14. Indemnification</Text>
                    <Text style={styles.paragraph}>
                        You will hold harmless and indemnify Cypher Box LLC, its directors, officers, employees, suppliers, agents, or affiliates from and against any claim, suit, or action arising from or related to your use of the Services, including Lightning Account(s) and Vault(s), or violation of this Agreement, including any liability arising from claims, losses, damages, suits, judgments, litigation costs, and attorneys' fees.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>15. What Cypher Box LLC Does Not Do</Text>
                    <Text style={styles.paragraph}>
                        We do not issue or put into circulation a digital currency or redeem or withdraw from circulation digital currency. We do not have access to your Lightning Account(s), your Vault(s), or any Digital Assets stored in them. Any Digital Assets stored using the Services are not in our control.
                    </Text>
                    <Text style={styles.paragraph}>
                        As explained above, we do not store or have any means of recovering your Lightning Account(s) private keys, seedphrases, or passwords. Cypher Box is not a bank, custodian, exchange, financial intermediary, or regulated financial institution. Cypher Box does not have control over or take any responsibility for any transactions made through our Services.
                    </Text>
                    <Text style={styles.paragraph}>
                        Our Services are for supported Digital Assets only. Any prices displayed are provided by third-party services and are not indicative of the Digital Assets being backed by any commodity or other form of money or having any other tangible value at all. Cypher Box LLC makes no guarantees that Bitcoins or other Digital Assets can be exchanged or sold at the price displayed.
                    </Text>
                    <Text style={styles.paragraph}>
                        We have no control over and do not make any representations regarding the value of Digital Assets or the operation of the underlying software protocols which govern the operation of Digital Assets supported on our platform. We assume no responsibility for the operation of the underlying protocols and we are not able to guarantee their functionality, security, or availability.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>16. Information on Our Website</Text>
                    <Text style={styles.paragraph}>
                        The information contained on our website is for general information purposes only. The information is provided by Cypher Box LLC and while we endeavor to keep the information up to date and correct, we make no representations or warranties of any kind, express or implied, about the completeness, accuracy, reliability, suitability, or availability with respect to the website or the information, products, services, or related graphics contained on the website for any purpose. Any reliance you place on such information is therefore strictly at your own risk.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>17. Governing Law and Dispute Resolution</Text>
                    <Text style={styles.paragraph}>
                        This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, USA, without regard to its conflict of law provisions.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Arbitration:
                    </Text>
                    <Text style={styles.paragraph}>
                        Any dispute, controversy, or claim arising out of or relating to this Agreement or your use of the Services shall be resolved by binding arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules. The arbitration shall take place in Delaware, USA. The arbitrator's award shall be final and binding and may be entered as a judgment in any court of competent jurisdiction.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Class Action Waiver:
                    </Text>
                    <Text style={styles.paragraph}>
                        You agree that any dispute resolution proceedings will be conducted only on an individual basis and not in a class, consolidated, or representative action. You waive any right to participate in a class action lawsuit or class-wide arbitration against Cypher Box LLC.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Small Claims Exception:
                    </Text>
                    <Text style={styles.paragraph}>
                        Notwithstanding the above, either party may bring an individual action in small claims court for disputes within the court's jurisdictional limits.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>18. Miscellaneous</Text>
                    <Text style={styles.paragraph}>
                        No action or inaction by Cypher Box LLC will be considered a waiver of any right or obligation by Cypher Box LLC.
                    </Text>
                    <Text style={styles.paragraph}>
                        This Agreement may be amended by Cypher Box LLC by providing you advance notice of any proposed change. If you do not agree to the amended agreement, then your sole remedy will be to stop using the Services, including any Vault(s). You may not assign this Agreement. Cypher Box LLC may assign this Agreement. This Agreement controls the relationship between Cypher Box LLC and you.
                    </Text>
                    <Text style={styles.paragraph}>
                        Your use of the Services, any Lightning Account(s), or Vault(s) is subject to international export controls and economic sanctions requirements. You agree that you will comply with those requirements. You are not permitted to use any of the Services if: (1) you are in, under the control of, or a national or resident of Cuba, Iran, or North Korea, or any other country or region subject to comprehensive United States embargo or UN sanctions (a "Sanctioned Country"), or if you are a person on the U.S. Treasury Department's Specially Designated Nationals List or the U.S. Commerce Department's Denied Persons List, Unverified List, or Entity List (a "Sanctioned Person"); or (2) you intend to supply any Digital Assets in Lightning Account(s) or Vault(s) to a Sanctioned Country (or a national or resident of a Sanctioned Country) or Sanctioned Person.
                    </Text>
                    <Text style={styles.paragraph}>
                        All provisions of this Agreement which by their nature extend beyond the expiration or termination of this Agreement will continue to be binding and operate after the termination or expiration of this Agreement. If a particular term of this Agreement is determined to be invalid or not enforceable under any applicable law, this will not affect the validity of any other term. This Agreement (including documents incorporated by reference in it) is the entire agreement between Cypher Box LLC and you and supersedes any other agreement, representations (or misrepresentations), or understanding, however communicated.
                    </Text>
                </View>

                {/* ===== PRIVACY POLICY ===== */}
                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>PRIVACY POLICY</Text>

                <View style={styles.section}>
                    <Text style={styles.paragraph}>
                        Cypher Box LLC ("Cypher Box," "we," "us") is committed to transparency about how data is handled when you use our app. This Privacy Policy describes what data is collected, by whom, and for what purpose.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>1. Data We Do Not Collect</Text>
                    <Text style={styles.paragraph}>Cypher Box does not collect, store, or have access to:</Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• Your Vault backup seedphrases or private keys</Text>
                        <Text style={styles.listItem}>• Your Lightning Account passwords (these are stored locally on your device)</Text>
                        <Text style={styles.listItem}>• Your transaction history or wallet balances</Text>
                        <Text style={styles.listItem}>• Your personal identity information</Text>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>2. Data Stored Locally on Your Device</Text>
                    <Text style={styles.paragraph}>
                        The following data is stored locally on your device using encrypted storage and/or the operating system's secure keychain. This data does not leave your device and is not transmitted to Cypher Box servers:
                    </Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• CoinOS credentials (username and password): stored in the iOS Keychain / Android Keystore</Text>
                        <Text style={styles.listItem}>• Authentication tokens for CoinOS and Strike: stored in encrypted local storage</Text>
                        <Text style={styles.listItem}>• Vault private keys and seedphrases: stored in encrypted local storage</Text>
                        <Text style={styles.listItem}>• Bark Vault private keys and seedphrase: stored in the iOS Keychain / Android Keystore</Text>
                        <Text style={styles.listItem}>• Bark Vault wallet state (signed VTXOs, refresh history, ASP coordination data needed by the ASP's SDK to operate): stored in encrypted local storage</Text>
                        <Text style={styles.listItem}>• App preferences and settings: such as withdrawal thresholds, reserve amounts, and UI state</Text>
                    </View>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Optional cloud backup of the Bark Vault.
                    </Text>
                    <Text style={styles.paragraph}>
                        If you opt in, an encrypted backup file containing your Bark Vault state is uploaded to your device's iCloud (iOS) or Google Drive (Android) account. The file is encrypted on your device before upload using a key derived from your Bark Vault seedphrase. Neither Cypher Box LLC nor the cloud storage provider can read the contents of this file without your seedphrase. You can disable cloud backup at any time from the Bark Vault settings. The local backup remains on your device regardless of whether cloud backup is enabled.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>3. Data Collected by Cypher Box Services (Optional)</Text>
                    <Text style={styles.paragraph}>
                        If you choose to enable push notifications, Cypher Box operates a notification relay server that receives and processes:
                    </Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• Your Lightning Account username</Text>
                        <Text style={styles.listItem}>• A temporary authentication token</Text>
                        <Text style={styles.listItem}>• Your device platform (iOS or Android)</Text>
                        <Text style={styles.listItem}>• Your device push notification token (APNs or FCM)</Text>
                    </View>
                    <Text style={styles.paragraph}>
                        This data is used solely to deliver push notifications to your device. Push notifications are optional and can be disabled at any time. We do not use this data for any other purpose.
                    </Text>
                    <Text style={styles.paragraph}>
                        If you choose to log in to Strike, Cypher Box operates an OAuth 2.0 authentication server that temporarily processes your Strike OAuth session data during the authentication handshake. This data is used solely to complete the authentication process. We do not persistently store your Strike credentials or session data on our servers.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>4. Data Collected by Third Parties Through Our App</Text>
                    <Text style={styles.paragraph}>
                        When you use certain features, third-party services may collect data directly:
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        CoinOS (when you create or log in to a CoinOS Lightning Account):
                    </Text>
                    <Text style={styles.paragraph}>
                        CoinOS may collect your username, transaction history, and account activity. Please refer to CoinOS's own privacy policy for details.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Strike (when you log in to a Strike account):
                    </Text>
                    <Text style={styles.paragraph}>
                        Strike may collect personal and financial data in accordance with their regulatory obligations. Please refer to Strike's own privacy policy for details.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Google reCAPTCHA (during CoinOS login):
                    </Text>
                    <Text style={styles.paragraph}>
                        CoinOS requires Google reCAPTCHA verification for authentication. When this occurs, Google may collect device identifiers, IP addresses, browser/device fingerprints, and interaction data. This data is collected and processed by Google according to Google's Privacy Policy. Cypher Box does not have access to the data Google collects through reCAPTCHA.
                    </Text>
                    <Text style={[styles.paragraph, styles.bold]}>
                        Ark Service Provider (when you use the Bark Vault):
                    </Text>
                    <Text style={styles.paragraph}>
                        The Bark Vault communicates with an ASP to coordinate VTXO creation, refresh rounds, Lightning routing, and on-chain exit. The ASP receives the cryptographic data necessary to construct and co-sign these transactions, including pubkeys, signatures, VTXO structures, and protocol-level coordination messages. Because the ASP coordinates every ordinary Bark Vault operation, it is in a position to observe your payment activity over time. The ASP does not require an account, username, email address, or other personal identifier from you, and Cypher Box does not transmit any personal information about you to the ASP. Network-level metadata such as your IP address may be visible to the ASP unless you route your connection through a privacy network.
                    </Text>
                    <Text style={styles.paragraph}>
                        The ASP publishes terms of service at https://second.tech/terms. As of the date of this Privacy Policy it does not publish a separate privacy policy, and its terms do not describe what it logs or how long it retains it. Cypher Box LLC has no visibility into and no control over the ASP's data practices.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>5. Data Collected via the Bitcoin Network</Text>
                    <Text style={styles.paragraph}>
                        Due to the transparent nature of the Bitcoin blockchain, when you use the "Withdraw" or "Top-up" functions, your Vault addresses and the balances they contain may become visible to your custodian(s) and to any party that monitors the Bitcoin Network. Neither Cypher Box nor its third-party custodians can have access to your 12-word seedphrase(s) that protect your Vault(s).
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>6. Data Sharing</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box LLC does not sell, rent, or share your personal data with third parties for marketing or advertising purposes. Data is shared only as described in this policy, with custodians when you initiate transactions, and with service providers as necessary for the features you choose to use.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>7. Data Retention</Text>
                    <Text style={styles.paragraph}>
                        Locally stored data remains on your device until you uninstall the app or manually clear app data. Data transmitted to our push notification or OAuth servers is not persistently stored beyond the duration of the active session or notification delivery.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>8. Children</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box is rated for general audiences in app stores. However, the self-custodial Vault features involve significant financial responsibility. Parents and guardians should be aware that use of Lightning Account(s) connected to third-party custodians may be subject to those custodians' own age requirements and identity verification policies.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>9. Changes to This Privacy Policy</Text>
                    <Text style={styles.paragraph}>
                        We may update this Privacy Policy from time to time. We will notify you of any material changes through the app or by other reasonable means. Your continued use of the Services after such changes constitutes your acceptance of the updated Privacy Policy.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>10. Contact</Text>
                    <Text style={styles.paragraph}>
                        If you have questions about this Privacy Policy, you may contact us at: info@cypherbox.io
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.paragraph, { fontStyle: 'italic' }]}>
                        This Agreement and Privacy Policy were last updated in August 2026.
                    </Text>
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>
        </ScreenLayout>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        paddingHorizontal: 40
    },
    title: {
        color: colors.pink.default,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 18,
        marginTop: 20,
        marginBottom: 4,
    },
    lastUpdated: {
        fontSize: 12,
        color: '#888',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#fff',
        marginTop: 16,
        marginBottom: 16,
        textAlign: 'center',
    },
    section: {
        marginBottom: 20,
    },
    subHeader: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 8,
        color: '#fff',
    },
    paragraph: {
        fontSize: 14,
        textAlign: 'justify',
        color: '#fff',
        marginBottom: 8,
    },
    bold: {
        fontWeight: 'bold',
    },
    link: {
        fontSize: 14,
        color: colors.pink.default,
        textDecorationLine: 'underline',
        marginBottom: 8,
    },
    listContainer: {
        paddingLeft: 20,
        marginBottom: 8,
    },
    listItem: {
        fontSize: 14,
        lineHeight: 22,
        marginBottom: 4,
        color: '#fff',
    },
    divider: {
        borderBottomWidth: 1,
        borderBottomColor: '#A3A3A3',
        marginVertical: 8,
    },
});

export default TermsOfService;
