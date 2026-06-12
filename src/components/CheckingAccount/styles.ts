// components/CheckingAccount/style.ts
import { StyleSheet } from 'react-native';
import colors from '@Cypher/style-guide/colors';

export default StyleSheet.create({
  loginOptionContainer: {
    marginVertical: 15,
    borderRadius: 20,
    alignSelf: 'center',
    width: '75%',
  },
  // Variant: LoginOption inside a row paired with a sibling Create
  // button. Replaces the standalone centered+75% width — the parent
  // flex container controls the split (LoginOption flex:2, Create flex:1).
  loginOptionContainerInRow: {
    flex: 2,
    marginVertical: 0,
    alignSelf: 'auto',
    width: undefined,
  },
  // Side "Create" CTA — same 80pt height as LoginOption so the row
  // reads as paired buttons. Pressed-state styling lives below.
  createButtonContainer: {
    flex: 1,
    borderRadius: 20,
  },
  createButtonGradient: {
    padding: 2,
    borderWidth: 2,
    borderColor: colors.pink.extralight,
    borderRadius: 20,
  },
  createButton: {
    backgroundColor: '#111111',
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  createButtonText: {
    fontSize: 18,
    color: colors.pink.extralight,
    lineHeight: 26,
    includeFontPadding: false,
  },
  // Side-by-side row holding [LoginOption, CreateButton]. Gap matches
  // the LoginOption's marginVertical so the visual rhythm of the
  // stacked custodial section stays consistent.
  providerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginVertical: 15,
  },
  experimentalNotice: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
  },
  experimentalIcon: {
    marginRight: 5,
  },
  experimentalText: {
    color: '#888',
    fontSize: 11,
    lineHeight: 16,
  },
  experimentalLink: {
    color: colors.ark.light,
    fontSize: 11,
    lineHeight: 16,
  },
  // Idle state — raised "sheet" affordance via outset drop shadow.
  // iOS uses native shadow*; Android uses elevation.
  loginOptionContainerRaised: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  // Pressed — collapses the shadow + scales down 3% so the sheet
  // appears to depress under the thumb. Activated by Pressable's
  // `pressed` callback in LoginOption.tsx.
  loginOptionContainerPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  loginOptionGradientPressed: {
    opacity: 0.92,
  },
  loginOptionPressed: {
    backgroundColor: '#1A1A1A',
  },
  loginOptionGradient: {
    padding: 2,
    borderWidth: 2,
    borderColor: colors.pink.extralight,
    borderRadius: 20
  },
  loginOption: {
    backgroundColor: '#111111',
    height: 80,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    padding: 0,
    gap: 14,
  },
  // Variant: spread layout for buttons that pair a labeled cluster
  // (icon + title) on the left with a brand wordmark on the right —
  // used by the Ark "Ark Vault ⚡  |  second.tech" button.
  loginOptionSpread: {
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    gap: 0,
  },
  labelCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  labelIcon: {
    width: 14,
    height: 18,
  },
  loginOptionLabel: {
    fontSize: 18,
    lineHeight: 24,
    includeFontPadding: false,
  },
  logo: {
    height: 30,
    width: 85,
  },
  registerPrompt: {
    alignItems: 'center',
    marginBottom: 40,
  },
  promptText: {
    color: colors.white,
    fontSize: 16,
    marginBottom: 5,
  },
  actionText: {
    color: colors.pink.extralight,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
