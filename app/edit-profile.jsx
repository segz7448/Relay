import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { type, space, radius, useTheme } from "../theme";
import Field from "../components/Field";
import Avatar from "../components/Avatar";
import ActionSheet from "../components/ActionSheet";
import { PrimaryButton } from "../components/Button";
import { useProfile } from "../profileStore";
import { api } from "../api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;
const BIO_MAX = 70;

async function pickImage() {
  const ImagePicker = await import("expo-image-picker");
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  });
  if (result.canceled) return null;
  return result.assets[0];
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { profile, loaded, updateProfile } = useProfile();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Populate the form from the store once it's loaded from disk — not on
  // every `profile` change, so the person's in-progress edits here don't
  // get clobbered if the store updates from elsewhere.
  useEffect(() => {
    if (!loaded || hydrated) return;
    setName(profile.name || "");
    setUsername(profile.username || "");
    setEmail(profile.email || "");
    setBio(profile.bio || "");
    setPhoto(profile.photo || null);
    setHydrated(true);
  }, [loaded, hydrated, profile]);

  async function handlePick() {
    const asset = await pickImage();
    if (asset) setPhoto(asset);
  }

  const photoActions = [
    {
      key: "choose",
      label: "Choose Photo",
      icon: "image-outline",
      onPress: handlePick,
    },
    ...(photo
      ? [
          {
            key: "remove",
            label: "Remove Photo",
            icon: "trash-outline",
            destructive: true,
            onPress: () => setPhoto(null),
          },
        ]
      : []),
  ];

  function validate() {
    const next = {};
    if (!name.trim()) next.name = "Enter a name.";
    if (!USERNAME_RE.test(username.trim())) {
      next.username =
        "Usernames are 3–32 characters: letters, numbers, and underscores, starting with a letter.";
    }
    if (email.trim() && !EMAIL_RE.test(email.trim()))
      next.email = "Enter a valid email address.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await api.updateProfile({
        name: name.trim(),
        username: username.trim().replace(/^@/, ""),
        bio: bio.trim(),
      });
      let remote = saved;
      if (photo && typeof photo !== "string") {
        const type = photo.mimeType || "image/jpeg";
        const ext =
          type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
        const form = new FormData();
        form.append("photo", {
          uri: photo.uri,
          name: photo.fileName || `profile.${ext}`,
          type,
        });
        remote = await api.uploadPhoto(form);
      }
      if (!photo && profile.photo) remote = await api.removePhoto();
      await updateProfile({
        name: remote.name,
        username: remote.username,
        email: remote.email,
        bio: remote.bio,
        photo: remote.photoUrl || null,
      });
      router.back();
    } catch (error) {
      setSaveError(error?.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (!hydrated) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xl * 2,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatarWrap}>
          <Pressable
            onPress={() => setPhotoSheet(true)}
            style={styles.avatarPressable}
          >
            <Avatar
              uri={typeof photo === "string" ? photo : photo?.uri}
              name={name || username || "You"}
              size={96}
            />
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={15} color="#FFFFFF" />
            </View>
          </Pressable>
          <Pressable onPress={() => setPhotoSheet(true)} hitSlop={8}>
            <Text style={styles.photoLabel}>
              {photo ? "Change Photo" : "Set Photo"}
            </Text>
          </Pressable>
        </View>

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          autoCapitalize="words"
          error={errors.name}
        />
        <Field
          label="Username"
          value={username}
          onChangeText={(v) => setUsername(v.replace(/\s/g, ""))}
          placeholder="username"
          error={errors.username}
          helper={
            !errors.username
              ? "People can find you by this username."
              : undefined
          }
        />
        <Field
          label="Email"
          value={email}
          editable={false}
          placeholder="you@example.com"
          keyboardType="email-address"
          textContentType="emailAddress"
          error={errors.email}
          helper="Email changes require account administration."
        />

        <Text style={styles.label}>Bio</Text>
        <View style={styles.bioBox}>
          <TextInput
            value={bio}
            onChangeText={(v) => setBio(v.slice(0, BIO_MAX))}
            placeholder="Add a few words about yourself"
            placeholderTextColor={colors.textMuted}
            style={styles.bioInput}
            multiline
          />
        </View>
        <Text style={styles.bioCounter}>
          {bio.length}/{BIO_MAX}
        </Text>

        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
        <PrimaryButton
          label={saving ? "Saving…" : "Save"}
          loading={saving}
          disabled={saving}
          onPress={handleSave}
        />
      </ScrollView>

      <ActionSheet
        visible={photoSheet}
        onClose={() => setPhotoSheet(false)}
        title="Profile Photo"
        actions={photoActions}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    avatarWrap: { alignItems: "center", marginBottom: space.lg, gap: space.sm },
    avatarPressable: { width: 96, height: 96 },
    cameraBadge: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.bg,
    },
    photoLabel: { ...type.small, color: colors.accent, fontWeight: "600" },
    label: {
      ...type.small,
      color: colors.textSecondary,
      marginBottom: space.xs,
      fontWeight: "600",
    },
    bioBox: {
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      minHeight: 76,
    },
    bioInput: {
      ...type.body,
      color: colors.textPrimary,
      textAlignVertical: "top",
    },
    saveError: { ...type.small, color: colors.danger, marginBottom: space.md },
    bioCounter: {
      ...type.small,
      color: colors.textMuted,
      textAlign: "right",
      marginTop: space.xs,
      marginBottom: space.lg,
    },
  });
}
