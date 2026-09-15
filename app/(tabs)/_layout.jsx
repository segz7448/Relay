import { Tabs } from 'expo-router';
import { type, useTheme } from '../../theme';
import { useNotifications } from '../../notifications';
import GlassTabBar from '../../components/GlassTabBar';

export default function TabsLayout() {
  const { unreadCount } = useNotifications();
  const { colors } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} unreadCount={unreadCount} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { ...type.h1, fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      {/* Messages builds its own header (avatar, title, search, compose)
          so it can switch into a "N selected" bulk-action header too. */}
      <Tabs.Screen name="index" options={{ headerShown: false }} />
      <Tabs.Screen name="relay" options={{ title: 'Server Relay', headerShown: false }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
