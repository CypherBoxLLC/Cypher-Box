import * as NavigationService from '../../NavigationService';
import { CommonActions } from '@react-navigation/native';

// Screens that have been relocated into a nested navigator but whose
// call sites we don't want to touch. When an external caller does
// `dispatchNavigate('SavingVaultIntro')`, React Navigation can't find
// that route at the top level anymore (the nested navigator isn't
// mounted yet), so we translate it here:
//   dispatchNavigate('SavingVaultIntro')
//     → navigate('HotVaultFlow', { screen: 'SavingVaultIntro', params: ... })
//
// Why a lookup table rather than per-call updates:
//   - 5+ call sites across HomeScreen, BottomBar, ColdVaultIntro, etc.
//   - Mixing direct + nested forms in the codebase is a recipe for
//     future bugs where someone adds a 6th call site forgetting the
//     nesting. Centralizing means "dispatchNavigate by name" always
//     just works.
//   - See Navigation.js → HotVaultFlow for why these screens are nested
//     (Fabric slowness in @react-navigation/stack's card wrapper).
const NESTED_ROUTE_PARENT: Record<string, string> = {
  SavingVaultIntro: 'HotVaultFlow',
  SavingVault: 'HotVaultFlow',
  SavingVaultCreated: 'HotVaultFlow',
};

export default function dispatchNavigate(routeName: string, params?: any) {
  const parent = NESTED_ROUTE_PARENT[routeName];
  if (parent) {
    NavigationService.dispatch(
      CommonActions.navigate({
        name: parent,
        params: {
          screen: routeName,
          params: params,
        },
      }),
    );
    return;
  }
  NavigationService.dispatch(
    CommonActions.navigate({
      name: routeName,
      params: params
    }),
  );
};

export function dispatchReset(routeName: string, params?: any) {
  NavigationService.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: routeName, params }],
    })
  );
};

export const resetAndNavigate = (parentRouteName: string, nextRouteName: string, params?: any) => {
  NavigationService.dispatch(CommonActions.reset({
    index: 1,
    routes: [
      { name: parentRouteName },
      { name: nextRouteName, params },
    ],
  }));
};
