import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { routeForNotification } from './pushRules';

/**
 * While signed in:
 * - a notification that arrives with the app open is not shown (the screens already update); it just triggers a sync,
 *   so the badges and lists catch up.
 * - tapping a notification, from the lock screen or when the app was closed, opens the screen it is about and syncs.
 */
export function usePushTaps(enabled: boolean, sync: () => Promise<void>) {
  const router = useRouter();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const live = enabled && (Platform.OS === 'ios' || Platform.OS === 'android');

  useEffect(() => {
    if (!live) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
      }),
    });
    const sub = Notifications.addNotificationReceivedListener(() => void syncRef.current());
    return () => sub.remove();
  }, [live]);

  useEffect(() => {
    if (!live || !last) return;
    if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = `${last.notification.request.identifier}:${last.notification.date}`;
    if (handled.current === id) return;
    handled.current = id;
    const route = routeForNotification(last.notification.request.content.data);
    if (route) router.push(route);
    void syncRef.current();
  }, [live, last, router]);
}
