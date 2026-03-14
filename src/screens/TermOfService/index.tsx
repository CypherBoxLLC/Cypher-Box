import { ScreenLayout, Text } from '@Cypher/component-library';
import { GradientText } from '@Cypher/components';
import { colors } from '@Cypher/style-guide';
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';

const TermsOfService = () => {
    return (
        <ScreenLayout showToolbar disableScroll>
            <GradientText style={styles.title} center>Terms of Service & Privacy Policy</GradientText>
            <View style={styles.divider} />
            <ScrollView style={styles.container} showsVerticalScrollIndicator={true}
                indicatorStyle='white'
            >
                <View style={styles.section}>
                    <Text style={styles.paragraph}>
                        This is a contract (the “Agreement”) between you and Cypher Box LLC
                        (“Cypher Box” “we” or “us”), a company registered and incorporated
                        under the laws of Delaware whose registered office is 8 The Green,
                        Suite B. Dover, Delaware 19901, USA. References in this Agreement to
                        “you” and “your” are to the person with whom Cypher Box enters into
                        this Agreement. By checking the box, clicking on “Start”, “I
                        understand”, “next” or similar terms when you open the application and
                        go through the instructions and warnings with regards to using our
                        integrated third-party APIs, and Vaults, (all referred to as
                        ‘Services’) or by proceeding with a download or update when offered a
                        choice of proceeding or not, you are agreeing to be bound by the terms
                        and conditions found in this Agreement. You represent and warrant that
                        you have the power and capacity to enter into this Agreement.
                    </Text>
                </View>
                <View style={styles.section}>
                    <Text style={styles.subHeader}>1. Third-party Custodian Lightning Account(s)</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box lets you connect through API(s) (create account and/or
                        login) to one or more Bitcoin custodians that (if benevolent) allow
                        you to request sending and receiving payments quickly and cheaply in
                        Bitcoin (BTC) through their Lightning Network infrastructure. A
                        custodian is an entity that allow you to transact and accumulate
                        bitcoin (up to a certain subjective threshold) quickly and cheaply
                        depending on your jurisdiction. The funds stored on your custodian
                        'Lightning Account(s)' are technically under the full control of the
                        custodian, NOT OURS, NOT YOURS. The balance shown on your Checking
                        Account(s) may or may not be real Bitcoin. Despite our efforts in
                        choosing the most trusted and regulated Bitcoin custodians, we can
                        never be certain that when you use the 'Receive', 'Send', 'Top-up', or
                        'Withdraw' functions the custodian(s) will credit/debit your Checking
                        Account(s) balance(s) if you receive/send bitcoin from/to another user
                        or from/to your vault with the fees they advertise, or if they will
                        uphold their promise in keeping their internal ledger matched one to
                        one with their bitcoin reserves. Moreover, while we carefully selected
                        our custodians for reliability, we cannot guarantee a 24/7 uptime or
                        that your particular transactions will be processed by them.
                        Custodians might face liquidity issues or other technical problems
                        that can only be solved on their side, NOT OURS. A Bitcoin custodian,
                        just like a regular bank or exchange, can seize, freeze, or steal the
                        balance displayed in your Lightning Account. Custodians can even
                        sometimes get hacked. Cypher Box LLC is not liable for any funds
                        stolen by the custodian(s) we integrate with. If you face any problems
                        in Lightning Account(s) you should first login to your Custodian’s
                        website or mobile application and validate your balance and
                        transaction history from their side. Cypher Box is not liable for any
                        error that occurs within the custodian(s)’s ledger(s) or in the
                        transfer of requests and callbacks through their API. Due to all the
                        uncertainties mentioned above; we highly recommend that you read and
                        follow the instructions and only store a measured amount of bitcoin
                        inside your Lightning Account, use multiple custodian Lightning Accounts
                        to spread the counter-party risk, periodically monitor your Checking
                        Accounts’ balances and activities from the custodian(s) website or
                        application, and once you’re knowledgeable enough to understand
                        self-custody and the risks associated with holding your own keys,
                        withdraw your bitcoin into one of your Vaults preferably when your
                        balance reaches the threshold where it makes economic sense to pay for
                        Bitcoin Network fees and demand real ownership over your funds.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>2. Crypto Exchanges</Text>
                    <Text style={styles.paragraph}>
                        Some custodians in Cypher Box may give you the option to buy or sell
                        'bitcoin' for fiat currency depending on your jurisdiction. These
                        regulated exchanges may also run their own lightning infrastructure so
                        they may also allow you to transact in bitcoin quickly and cheaply.
                        However, all the risks, uncertainties, and guidelines mentioned above
                        with regular bitcoin custodians also apply to cryptocurrency exchanges.
                    </Text>
                    <Text style={styles.paragraph}>
                        Cypher Box LLC is also not liable for any financial losses due to a
                        failure or error in executing any trade happening between you and a
                        cryptocurrency exchange we have in our app.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>3. Self-custodial Vault(s)</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box enables you to create single, hierarchical deterministic
                        (HD), non-custodial wallet(s) (referred to as 'Vault(s)') for Bitcoin.
                        You can use these vaults to withdraw from your Lightning Account(s),
                        store, send, and receive the digital asset Bitcoin only (BTC). In order
                        to use the hot or cold storage Vault(s) you are expected to be fully
                        aware of the dangers associated with securing your 12-word backup
                        seedphrase. You are expected to know that; you should never lose access
                        to your seedphrase(s), you should write the words in their correct order
                        on a physical medium such as a paper or a metallic plate, you should
                        make multiple physical copies of them and store the copies in secure
                        locations, you should never share them with anyone including us, and you
                        should never ask us to recover your Vault(s) funds because the only
                        entity capable of doing so is the one that holds the private keys
                        represented in the form of a 12-word seedphrase which is YOU, NOT US.
                        These Vaults are intended for use by persons who are very knowledgeable
                        about cryptocurrency generally and HD non-custodial wallets in
                        particular. If you read our instructions and warnings carefully and
                        understand the risks associated with self-custody, you represent that
                        you qualify as such a person.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>4. Supported Digital Assets</Text>
                    <Text style={styles.paragraph}>
                        Our Services are for use with Bitcoin (BTC) only and any other digital
                        assets we may explicitly decide to support in the future at our
                        discretion (“Digital Assets”). We have no obligation to support any
                        digital assets (including but not limited to any forkcoins, altcoins,
                        airdrops or any other digital assets however named) other than Bitcoin
                        or any other digital asset we may explicitly decide to support in the
                        future at our discretion. We assume no responsibility or liability in
                        connection with any attempt to use your Vault for digital assets that we
                        do not support.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>5. Responsibility for Lightning Account(s) Credentials, Vault(s) Backup
                        Seedphrases, Passwords and Other Authentication Means</Text>
                    <Text style={styles.paragraph}>
                        Our Services provide a number of ways for you to secure your funds and
                        help ensure you, and only you, are able to access and transact through
                        Lightning Accounts and Vaults. These features include API authentication
                        tokens, backup seedphrases, passwords, biometrics, among other features.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>6. Mnemonics and Catastrophic Impact of Their Loss or Misappropriation</Text>
                    <Text style={styles.paragraph}>
                        If you use our Services to create a Vault, the software will use an
                        algorithm to generate a random 12-word phrase as a seed to a BIP39
                        hierarchical wallet. This 12-word phrase is called a backup seedphrase
                        and if reproduced exactly stores all the information needed to recover
                        your Vault(s) if access through the App or phone Password, face-ID or
                        other authentication means is lost or otherwise not available.
                        <Text>Cypher Box LLC does not store, have access to, or have any way or
                            means of recovering your backup seedphrase.</Text>
                        It is your responsibility to keep your seedphrase secure. You should not
                        provide it to anyone, including any Cypher Box LLC representative.
                    </Text>
                    <Text>
                        If you permanently forget or lose your backup seedphrase, you will NEVER
                        be able to recover any cryptocurrency in your Vault, and you will suffer
                        a complete, irrecoverable and catastrophic loss of all Digital Assets in
                        your Vault. It is your responsibility to safeguard and retain your
                        backup seedphrase. Cypher Box has no responsibility and will not be
                        liable for any loss or damage you suffer from the loss or
                        misappropriation of your seedphrases.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>7. Third Party Integrations</Text>
                    <Text style={styles.paragraph}>
                        Third Party Integrations Our Services support or are integrated with
                        third party services. We are not responsible for any third party
                        services and will not be liable for any loss or damage caused by third
                        party services.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>8. Changes to or Termination of our Services</Text>
                    <Text style={styles.paragraph}>
                        We may add or remove functions or features of our Services. You can stop
                        using our Services at any time. We may stop providing our Services at
                        any time at our discretion. If we stop providing our Services, for
                        whatever reason, we will endeavor to provide advance notice to you.
                        However, we will have no obligation to do so. If our Services are
                        terminated abruptly without notice, for whatever reason, you should
                        still be able to login to your Lightning Account(s) from your
                        custodian(s) from their website(s) or mobile application(s) if they’re
                        available, and you should be able to recover the funds stored in your
                        hot and cold Vaults’ addresses using your backup seedphrase(s). Cypher
                        Box LLC has no responsibility and will not be liable for any loss or
                        damage you suffer from the loss of access to or use of your Vault(s)
                        during any termination of our Services.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>9. Your Compliance with Applicable Laws</Text>
                    <Text style={styles.paragraph}>
                        You represent and warrant that you are using the Services, including any
                        non custodial Vault, in accordance with applicable law, and not for any
                        purpose not in compliance with applicable law, including but not limited
                        to illegal gambling, fraud, money laundering or terrorist activities.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>10. Limitation of Liability</Text>
                    <Text style={styles.paragraph}>
                        Exclusion and Limitation of Liability In no event will Cypher Box LLC,
                        its directors, officers, employees, suppliers, agents or affiliates be
                        liable for any loss or damages, including without limitation, direct,
                        indirect, special, consequential, exemplary or punitive loss or damages,
                        arising from or related to your use of the Services or a Vault,
                        including but not limited to loss of or inability to access or transact
                        data, profit, Digital Assets, or other digital assets or cryptocurrency.
                        Without limiting the generality of the foregoing, Cypher Box LLC and its
                        third-party service providers take no responsibility for and will not be
                        liable for any financial or other loss or damage arising from or related
                        to the use of our Services, including but not limited to any of the
                        following.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>Financial Risks</Text>
                    <View style={styles.listContainer}>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) access being "hacked".</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) being "bankrupt".</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) being "unavailable".</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) seizing or freezing your account.</Text>
                        <Text style={styles.listItem}>• Financial loss due to loss of access to your Lightning Account(s) credentials.</Text>
                        <Text style={styles.listItem}>• Financial loss due to custodian(s) censoring your transactions.</Text>
                        <Text style={styles.listItem}>• Financial loss due to Vault(s) access being "Brute-forced".</Text>
                        <Text style={styles.listItem}>• Financial loss due to server failure or data loss. (We don’t have a server)</Text>
                        <Text style={styles.listItem}>• Financial loss due to server hacks or unavailability.</Text>
                        <Text style={styles.listItem}>• Financial loss due to forgotten or lost seed phrases or passwords.</Text>
                        <Text style={styles.listItem}>• Financial loss due to inability to transact.</Text>
                        <Text style={styles.listItem}>• Financial loss due to errors calculating network fees.</Text>
                        <Text style={styles.listItem}>• Financial loss due to incorrectly constructed transactions or mistyped bitcoin addresses.</Text>
                        <Text style={styles.listItem}>• Financial loss due to "phishing" or other websites masquerading as Cypher Box LLC.</Text>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>11. Indemnification</Text>
                    <Text style={styles.paragraph}>
                        You will hold harmless and indemnify Cypher Box LLC, its directors,
                        officers, employees, suppliers, agents or affiliates from and against
                        any claim, suit or action arising from or related to your use of the
                        Services, including Lightning Account(s) and Vault(s), or violation of
                        this Agreement, including any liability arising from claims, losses,
                        damages, suits, judgments, litigation costs and attorneys’ fees.
                    </Text>
                </View>
                <View style={styles.section}>
                    <Text style={styles.subHeader}>12. What the Cypher Box LLC Does Not Do</Text>
                    <Text style={styles.paragraph}>
                        We do not issue or put into circulation a digital currency or redeem
                        or withdraw from circulation digital currency. We do not have access
                        to neither your Lightning Account(s) nor your Vaults) or any Digital
                        Assets stored in it. Any Digital Assets stored using the Services are
                        not in our control. As explained above, we do not store or have any
                        means of recovering your Lightning Account(s), private keys,
                        seedphrases, passwords. Cypher Box is not a bank, custodian, exchange,
                        financial intermediary or regulated financial institution. Cypher Box
                        does not have control over or take any responsibility for any
                        transactions made through our Services. Our Services are for supported
                        Digital Assets only. Any prices displayed are provided by 3rd party
                        services and are not indicative of the Digital Assets being backed by
                        any commodity or other form of money or having any other tangible
                        value at all. Cypher Box LLC makes no guarantees that Bitcoins or
                        other Digital Assets can be exchanged or sold at the price displayed.
                        We have no control over and do not make any representations regarding
                        the value of Digital Assets, or the operation of the underlying
                        software protocols which govern the operation of Digital Assets
                        supported on our platform. We assume no responsibility for the
                        operation of the underlying protocols and we are not able to guarantee
                        their functionality, security or availability.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>13. Information on our Website</Text>
                    <Text style={styles.paragraph}>
                        The information contained on our website is for general information
                        purposes only. The information is provided by Cypher Box LLC and while
                        we endeavor to keep the information up to date and correct, we make no
                        representations or warranties of any kind, express or implied, about
                        the completeness, accuracy, reliability, suitability or availability
                        with respect to the website or the information, products, services, or
                        related graphics contained on the website for any purpose. Any
                        reliance you place on such information is therefore strictly at your
                        own risk.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>14. Governing Law and Dispute Resolution</Text>
                    <Text style={styles.paragraph}>
                        This Agreement shall be governed by and in accordance with the laws of
                        Delaware, USA.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>15. Privacy Policy and Data Protection</Text>
                    <Text style={styles.paragraph}>
                        Cypher Box LLC does not collect or share your personal or financial
                        data through this app. However, the third-party custodians in our app
                        may collect or share your personal or financial data and activity
                        happening in your Lightning Account. Due to the transparent nature of
                        the Bitcoin Network, they may also have access to your vault addresses
                        and the balances they contain if you provide it to them through the
                        ‘Withdraw’ and ‘Top-up’ functions. Neither Cypher Box nor its
                        third-party custodians can have access to your 12-word seedphrase(s)
                        that protect your Vault(s).
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.subHeader}>16. Miscellaneous</Text>
                    <Text style={styles.paragraph}>
                        No action or inaction by Cypher Box LLC will be considered a waiver of
                        any right or obligation by Cypher Box LLC.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.paragraph}>
                        This Agreement may be amended by Cypher Box LLC by providing you
                        advance notice of any proposed change. If you do not agree to the
                        amended agreement then your sole remedy will be to stop using the
                        Services, including any Vault(s). You may not assign this Agreement.
                        Cypher Box LLC may assign this Agreement. This Agreement controls the
                        relationship between Cypher Box LLC and you. Your use of the Services,
                        any Lightning Account(s) or Vault(s) is subject to international export
                        controls and economic sanctions requirements. You agree that you will
                        comply with those requirements. You are not permitted to use any of
                        the Services if: (1) you are in, under the control of, or a national
                        or resident of Cuba, Iran, North Korea, Sudan, or Syria or any other
                        country subject to United States embargo or UN sanctions (a
                        "Sanctioned Country"), or if you are a person on the U.S. Treasury
                        Department's Specially Designated Nationals List or the U.S. Commerce
                        Department's Denied Persons List, Unverified List or Entity List, (a
                        "Sanctioned Person"); or (2) you intend to supply any Digital Assets
                        in Lightning Account(s) or Vault(s) to a Sanctioned Country (or a
                        national or resident of a Sanctioned Country) or Sanctioned Person.
                        All provisions of this Agreement which by their nature extend beyond
                        the expiration or termination of this Agreement, will continue to be
                        binding and operate after the termination or expiration of this
                        Agreement. If a particular term of this Agreement is determined to be
                        invalid or not enforceable under any applicable law, this will not
                        affect the validity of any other term. This Agreement (including
                        documents incorporated by reference in it) is the entire agreement
                        between Cypher Box LLC and you and supersedes any other agreement,
                        representations (or misrepresentations), or understanding, however
                        communicated.
                    </Text>
                </View>
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
        marginVertical: 20,
    },
    header: {
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 16,
        color: "#fff"

    },
    section: {
        marginBottom: 20,
    },
    subHeader: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 8,
        color: "#fff"
    },
    paragraph: {
        fontSize: 14,
        // lineHeight: 10,
        textAlign: 'justify',
        color: "#fff"
    },
    listContainer: {
        paddingLeft: 20,
    },
    listItem: {
        fontSize: 16,
        lineHeight: 24,
        marginBottom: 8,
        color: "#fff"
    },
    divider: {
        borderBottomWidth: 1,
        borderBottomColor: '#A3A3A3'
    }
});

export default TermsOfService;
