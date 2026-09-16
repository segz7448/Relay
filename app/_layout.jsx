import { useEffect } from "react";
import { View, Text } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "../theme";
import { AccountsProvider, useAccounts } from "../accountsStore";
import { NotificationsProvider } from "../notifications";
import { CallProvider } from "../callStore";
import { ProfileProvider } from "../profileStore";
import { NotificationPrefsProvider } from "../notificationPrefs";
import { PrivacySecurityProvider } from "../privacySecurity";
import { ToastProvider } from "../components/Toast";
import { ConfirmProvider } from "../components/ConfirmDialog";
import { StatusBurstProvider } from "../components/StatusBurst";
import { OfflineBanner } from "../components/StateViews";

function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const { colors, scheme } = useTheme();
  const { loaded, loadError, accounts, addingAccount, endAddAccount } = useAccounts();
  const hasSession = accounts.length > 0;
  const onAuthStack = segments[0] === "auth";

  useEffect(() => {
    if (!loaded) return;
    if (!hasSession && !onAuthStack) router.replace("/auth/welcome");
    // While adding a second/third account, hasSession is already true —
    // stay on the auth stack instead of bouncing back to '/' like a
    // stray visit to /auth would. The flag clears itself below the
    // moment the person actually leaves the auth stack (success or back).
    if (hasSession && onAuthStack && !addingAccount) router.replace("/");
  }, [loaded, hasSession, onAuthStack, addingAccount]);

  useEffect(() => {
    if (!onAuthStack && addingAccount) endAddAccount();
  }, [onAuthStack, addingAccount, endAddAccount]);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (loadError) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 28 }}><Text style={{ color: colors.textPrimary, fontSize: 20, fontWeight: "700" }}>Secure sign-in data could not be read</Text><Text style={{ color: colors.textSecondary, marginTop: 10 }}>Relay kept your saved session unchanged. Restart the app and try again.</Text></View>;

  return (
    <NotificationsProvider>
      <CallProvider>
        <StatusBar style={scheme === "light" ? "dark" : "light"} />
        <OfflineBanner />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: "default",
            animationDuration: 260,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="search"
            options={{ headerShown: false, presentation: "modal" }}
          />
          <Stack.Screen
            name="compose"
            options={{ title: "New Message", presentation: "modal" }}
          />
          <Stack.Screen
            name="create-bot"
            options={{ title: "New bot", presentation: "modal" }}
          />
          <Stack.Screen name="conversation/[id]" options={{ title: "" }} />
          <Stack.Screen name="contact/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="call/[id]" options={{ headerShown: false }} />
          <Stack.Screen
            name="bot/[id]/index"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="bot/[id]/activity"
            options={{ title: "Activity" }}
          />
          <Stack.Screen
            name="bot/[id]/edit"
            options={{ title: "Edit bot", presentation: "modal" }}
          />
          <Stack.Screen
            name="bot/[id]/settings"
            options={{ title: "Settings" }}
          />
          <Stack.Screen
            name="bot/[id]/commands"
            options={{ title: "Commands" }}
          />
          <Stack.Screen
            name="bot/[id]/command-edit"
            options={{ title: "Command", presentation: "modal" }}
          />
          <Stack.Screen name="bot/[id]/users" options={{ title: "Users" }} />
          <Stack.Screen
            name="bot/[id]/conversations"
            options={{ title: "Conversations" }}
          />
          <Stack.Screen
            name="bot/[id]/webhook"
            options={{ title: "Webhook" }}
          />
          <Stack.Screen
            name="bot/[id]/webhook-deliveries"
            options={{ title: "Webhook Deliveries" }}
          />
          <Stack.Screen
            name="bot/[id]/user/[userId]/index"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="bot/[id]/user/[userId]/history"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="bot/[id]/files" options={{ title: "Files" }} />
          <Stack.Screen
            name="bot/[id]/analytics"
            options={{ title: "Analytics" }}
          />
          <Stack.Screen
            name="edit-profile"
            options={{ title: "Edit Profile", presentation: "modal" }}
          />
          <Stack.Screen
            name="settings-appearance"
            options={{ title: "Appearance" }}
          />
          <Stack.Screen
            name="settings-notifications"
            options={{ title: "Notifications and Sounds" }}
          />
          <Stack.Screen
            name="notifications"
            options={{ title: "Notifications" }}
          />
          <Stack.Screen
            name="settings-privacy"
            options={{ title: "Privacy and Security" }}
          />
          <Stack.Screen
            name="settings-privacy-rules"
            options={{ title: "Privacy" }}
          />
          <Stack.Screen
            name="settings-blocked-users"
            options={{ title: "Blocked Users" }}
          />
          <Stack.Screen
            name="settings-active-sessions"
            options={{ title: "Active Sessions" }}
          />
          <Stack.Screen
            name="settings-devices"
            options={{ title: "Devices" }}
          />
          <Stack.Screen
            name="settings-login-activity"
            options={{ title: "Login Activity" }}
          />
          <Stack.Screen
            name="settings-developer"
            options={{ title: "Developer" }}
          />
          <Stack.Screen
            name="agent-connection"
            options={{ title: "Connect an Agent" }}
          />
          <Stack.Screen
            name="settings-api-keys"
            options={{ title: "API Keys" }}
          />
          <Stack.Screen
            name="settings-api-key-create"
            options={{ title: "New API Key", presentation: "modal" }}
          />
          <Stack.Screen
            name="settings-bot-tokens"
            options={{ title: "Bot Tokens" }}
          />
          <Stack.Screen
            name="settings-webhooks"
            options={{ title: "Webhooks" }}
          />
          <Stack.Screen
            name="settings-webhook-edit"
            options={{ title: "Webhook", presentation: "modal" }}
          />
          <Stack.Screen
            name="settings-api-docs"
            options={{ title: "API Documentation" }}
          />
          <Stack.Screen
            name="settings-ip-allowlist"
            options={{ title: "IP Allowlist" }}
          />
          <Stack.Screen
            name="settings-security-alerts"
            options={{ title: "Security Alerts" }}
          />
          <Stack.Screen
            name="settings-passcode"
            options={{ title: "Passcode Lock" }}
          />
          <Stack.Screen
            name="settings-two-step"
            options={{ title: "Two-Step Verification" }}
          />
          <Stack.Screen name="settings-about" options={{ title: "About" }} />
          <Stack.Screen
            name="settings-licenses"
            options={{ title: "Licenses" }}
          />
          <Stack.Screen name="settings-help" options={{ title: "Help" }} />
          <Stack.Screen
            name="server/create"
            options={{ title: "New server", presentation: "modal" }}
          />
          <Stack.Screen
            name="server/[id]/index"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="server/[id]/channels"
            options={{ title: "Channels" }}
          />
          <Stack.Screen
            name="server/[id]/create-channel"
            options={{ title: "New channel", presentation: "modal" }}
          />
          <Stack.Screen
            name="server/[id]/channel/[channelId]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="server/[id]/members"
            options={{ title: "Members" }}
          />
          <Stack.Screen name="server/[id]/bots" options={{ title: "Bots" }} />
          <Stack.Screen
            name="server/[id]/add-bot"
            options={{ title: "Add bot", presentation: "modal" }}
          />
          <Stack.Screen name="server/[id]/files" options={{ title: "Files" }} />
          <Stack.Screen
            name="server/[id]/settings"
            options={{ title: "Settings" }}
          />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
        </Stack>
      </CallProvider>
    </NotificationsProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AccountsProvider>
        <ProfileProvider>
          <NotificationPrefsProvider>
            <PrivacySecurityProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <StatusBurstProvider>
                    <RootLayoutNav />
                  </StatusBurstProvider>
                </ConfirmProvider>
              </ToastProvider>
            </PrivacySecurityProvider>
          </NotificationPrefsProvider>
        </ProfileProvider>
      </AccountsProvider>
    </ThemeProvider>
  );
}
