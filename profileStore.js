// profileStore.js
//
// The person's own display profile (photo/name/username/bio/email) shown
// at the top of Settings and edited on the Edit Profile screen. This is
// now a thin adapter over accountsStore — "the profile" is just the
// active account's display fields — kept as its own module with the same
// useProfile()/ProfileProvider shape it always had, so every screen that
// reads useProfile() (Settings, Edit Profile, etc.) keeps working
// unmodified now that each account carries its own profile instead of
// there being one global one.

import { createContext, useContext, useMemo, useCallback } from 'react';
import { useAccounts } from './accountsStore';

const DEFAULT_PROFILE = {
  name: '',
  username: '',
  email: '',
  bio: '',
  photo: null, // local image uri, or null for the initials fallback
};

const ProfileContext = createContext({
  profile: DEFAULT_PROFILE,
  loaded: false,
  updateProfile: async () => {},
});

export function ProfileProvider({ children }) {
  const { activeAccount, loaded, updateActiveAccount } = useAccounts();

  const profile = useMemo(
    () => ({
      name: activeAccount?.name || '',
      username: activeAccount?.username || '',
      email: activeAccount?.email || '',
      bio: activeAccount?.bio || '',
      photo: activeAccount?.photo || null,
    }),
    [activeAccount]
  );

  // Only forward profile-shaped fields — never lets a caller accidentally
  // clobber the account's id/apiKey through this door.
  const updateProfile = useCallback(
    (patch) => {
      const { name, username, email, bio, photo } = patch;
      return updateActiveAccount({
        ...(name !== undefined && { name }),
        ...(username !== undefined && { username }),
        ...(email !== undefined && { email }),
        ...(bio !== undefined && { bio }),
        ...(photo !== undefined && { photo }),
      });
    },
    [updateActiveAccount]
  );

  const value = useMemo(() => ({ profile, loaded, updateProfile }), [profile, loaded, updateProfile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  return useContext(ProfileContext);
}
