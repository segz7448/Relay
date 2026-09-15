// utils/useNetworkStatus.js
//
// Wraps @react-native-community/netinfo the same defensive way
// utils/haptics.js wraps expo-haptics: if the native module isn't
// linked/installed on a given build, we assume "online" instead of
// crashing or nagging with a false offline banner.

import { useEffect, useState } from 'react';

let netInfoModule = null;
let netInfoLoadAttempted = false;

async function loadNetInfo() {
  if (netInfoLoadAttempted) return netInfoModule;
  netInfoLoadAttempted = true;
  try {
    netInfoModule = await import('@react-native-community/netinfo');
  } catch {
    netInfoModule = null;
  }
  return netInfoModule;
}

export function useNetworkStatus() {
  // Optimistic default — never show "offline" before we've actually
  // heard otherwise.
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;

    loadNetInfo().then((mod) => {
      if (cancelled || !mod?.default) return;
      const NetInfo = mod.default;
      unsubscribe = NetInfo.addEventListener((state) => {
        // `isConnected === false` is the only confident "offline" signal;
        // null/undefined mid-check should never flip the banner on.
        setIsOffline(state.isConnected === false);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { isOffline };
}
