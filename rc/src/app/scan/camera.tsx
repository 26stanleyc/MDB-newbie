import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useIsFocused } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Vec3 } from '@/api';
import { Button, Icon, MessageState, Screen, Text } from '@/components/ui';
import { parseFocal, toGravity } from '@/lib/capture-meta';
import { prepareImage } from '@/lib/image';
import { pickWallPhotos } from '@/lib/pick-photos';
import { useScanDraft } from '@/store/use-scan-draft';
import { Radius, Spacing } from '@/theme';

const TIPS = [
  'Stand square to the wall.',
  'Fit the whole route in the frame.',
  'Keep steady — good, even light helps.',
];

const PRECISE_TIPS = [
  'Take 3–5 photos of the same wall.',
  'Step left/right between shots for different angles.',
  'Keep the whole wall in frame and overlap the views.',
];

const PRECISE_MIN = 3; // minimum views for a usable 3D reconstruction
const PRECISE_MAX = 5; // cap — more is too much to capture; pick angles that count

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // Screens pushed on top keep this one mounted; only run the camera while it's in front.
  const focused = useIsFocused();
  const [showTips, setShowTips] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const mode = useScanDraft((s) => s.mode);
  const addCapture = useScanDraft((s) => s.addCapture);
  const count = useScanDraft((s) => s.captures.length);
  const precise = mode === 'precise';
  // Insets from the provider: <SafeAreaView> reports a zero top inset inside this
  // full-screen modal, which put the top buttons under the status bar.
  const insets = useSafeAreaInsets();
  // Warm the motion sensor so a fresh gravity vector is ready at the shutter.
  const gravityRef = useRef<Vec3 | undefined>(undefined);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    (async () => {
      const available = await DeviceMotion.isAvailableAsync().catch(() => false);
      if (!available) return;
      DeviceMotion.setUpdateInterval(200);
      sub = DeviceMotion.addListener((d) => {
        const g = toGravity(d);
        if (g) gravityRef.current = g;
      });
    })().catch(() => {}); // web reports motion as available but can't subscribe; gravity is optional
    return () => sub?.remove();
  }, []);

  // Upload existing photos instead of shooting. Quick: one photo → preview.
  // Precise: fill the remaining views; stay here unless there's no camera.
  const upload = async (noCamera = false) => {
    const limit = precise ? PRECISE_MAX - count : 1;
    if (capturing || limit <= 0) return;
    setCapturing(true);
    try {
      const picked = await pickWallPhotos(limit);
      if (picked.length === 0) return;
      picked.forEach(addCapture);
      if (!precise) {
        const img = picked[0].image;
        router.push({
          pathname: '/scan/preview',
          params: { uri: img.uri, width: String(img.width), height: String(img.height) },
        });
      } else if (noCamera && count + picked.length >= PRECISE_MIN) {
        router.push('/scan/preview');
      }
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) return <Screen />; // permissions still loading

  if (!permission.granted) {
    return (
      <Screen>
        <MessageState
          icon="camera"
          title="Camera access needed"
          message="Capitan needs the camera to photograph the wall — or upload a photo you already have."
          actionLabel="Grant access"
          onAction={requestPermission}
        />
        <Button
          title={precise ? `Upload ${PRECISE_MIN}–${PRECISE_MAX} photos` : 'Upload a photo'}
          variant="secondary"
          onPress={() => upload(true)}
          loading={capturing}
        />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const atMax = precise && count >= PRECISE_MAX;

  const capture = async () => {
    if (!cameraRef.current || capturing || atMax) return;
    setCapturing(true);
    try {
      // exif:true so focal length survives; read it BEFORE prepareImage strips EXIF.
      const photo = await cameraRef.current.takePictureAsync({ exif: true });
      if (!photo) return;
      const img = await prepareImage(photo.uri, photo.width, photo.height);
      addCapture({
        image: img,
        meta: {
          originalWidth: photo.width,
          originalHeight: photo.height,
          uploadWidth: img.width,
          uploadHeight: img.height,
          ...parseFocal(photo.exif),
          gravity: gravityRef.current,
        },
      });
      // Quick: straight to preview. Precise: stay on camera to take more views.
      if (!precise) {
        router.push({
          pathname: '/scan/preview',
          params: { uri: img.uri, width: String(img.width), height: String(img.height) },
        });
      }
    } finally {
      setCapturing(false);
    }
  };

  const donePrecise = () => router.push('/scan/preview');

  return (
    <View style={styles.root}>
      {focused ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      ) : null}

      {/* Framing guide */}
      <View pointerEvents="none" style={styles.guideWrap}>
        <View style={styles.guide} />
      </View>

      <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <IconButton icon="xmark" label="Close" onPress={() => router.back()} />
          <View style={styles.topRight}>
            {__DEV__ ? (
              <IconButton icon="ladybug" label="Dev menu" onPress={() => router.push('/dev')} />
            ) : null}
            <IconButton
              icon={showTips ? 'lightbulb.fill' : 'lightbulb'}
              label="Toggle tips"
              onPress={() => setShowTips((v) => !v)}
            />
          </View>
        </View>

        {showTips ? (
          <View style={styles.tips}>
            {(precise ? PRECISE_TIPS : TIPS).map((t) => (
              <Text key={t} color="#fff" variant="caption" style={styles.tipText}>
                • {t}
              </Text>
            ))}
          </View>
        ) : (
          <View />
        )}

        <View style={styles.bottom}>
          {precise ? (
            <View style={styles.countPill}>
              <Text color="#fff" variant="label">
                {count === 0
                  ? `Take 3–${PRECISE_MAX} photos from different angles`
                  : atMax
                    ? `${count} / ${PRECISE_MAX} · tap Done`
                    : `${count} / ${PRECISE_MAX} photos`}
              </Text>
            </View>
          ) : null}
          <View style={styles.shutterRow}>
            <View style={styles.sideSlot}>
              <Pressable
                onPress={() => upload()}
                disabled={capturing || atMax}
                accessibilityRole="button"
                accessibilityLabel={precise ? 'Upload photos from library' : 'Upload a photo from library'}
                hitSlop={8}
                style={[styles.libraryBtn, atMax && styles.shutterDisabled]}
              >
                <Icon name="photo.on.rectangle" size={22} color="#fff" />
              </Pressable>
            </View>
            <Pressable
              onPress={capture}
              disabled={capturing || atMax}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={[styles.shutter, atMax && styles.shutterDisabled]}
            >
              {capturing ? (
                <ActivityIndicator color="#000" />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>
            <View style={styles.sideSlot}>
              {precise && count >= PRECISE_MIN ? (
                <Pressable
                  onPress={donePrecise}
                  accessibilityRole="button"
                  accessibilityLabel="Done capturing"
                  style={styles.doneBtn}
                >
                  <Text color="#000" variant="label">
                    Done
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={styles.iconBtn}
    >
      <Icon name={icon} size={20} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  guideWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guide: {
    width: '82%',
    height: '62%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: Radius.lg,
  },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  topRight: { flexDirection: 'row', gap: Spacing.sm },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  tips: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: 2,
  },
  tipText: { lineHeight: 18 },
  bottom: { paddingBottom: Spacing.xl, gap: Spacing.md },
  countPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Radius.pill,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
  },
  sideSlot: { width: 72, alignItems: 'center', justifyContent: 'center' },
  libraryBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  doneBtn: {
    backgroundColor: '#fff',
    borderRadius: Radius.pill,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  shutterDisabled: { opacity: 0.4 },
});
