import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { codeFromUrl, normalizeCode } from '@/lib/invite';
import { Button, colors, s } from '@/lib/ui';

/** Scans a friend's QR code and hands the code to the invite screen, which asks before anything is sent. */
export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [notice, setNotice] = useState<string | null>(null);
  const handled = useRef(false);

  function onScanned(data: string) {
    if (handled.current) return;
    const code = codeFromUrl(data) ?? normalizeCode(data);
    if (!code) {
      setNotice("That QR code isn't a Discores invite.");
      return;
    }
    handled.current = true;
    router.replace({ pathname: '/friend/[code]', params: { code } });
  }

  if (!permission) return <View style={s.screen} />;

  if (!permission.granted) {
    return (
      <View style={[s.screen, s.pad, { justifyContent: 'center', gap: 10 }]}>
        <Text style={s.h2}>Camera access</Text>
        <Text style={s.body}>
          Discores uses the camera only to read a friend's QR code. Nothing is recorded or saved.
        </Text>
        {!permission.canAskAgain && (
          <Text style={s.muted}>Camera access is turned off. Enable it for Discores in your phone's settings.</Text>
        )}
        {permission.canAskAgain && <Button title="Allow camera" onPress={requestPermission} />}
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 0 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => onScanned(data)}
      />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 8, backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>
          {notice ?? "Point the camera at your friend's Discores QR code"}
        </Text>
        <Button title="Cancel" variant="soft" onPress={() => router.back()} style={{ marginTop: 0 }} />
      </View>
    </View>
  );
}
