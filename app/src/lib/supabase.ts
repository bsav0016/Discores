import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = url !== '' && anonKey !== '';

// SecureStore values are limited to ~2KB and a Supabase session can exceed that, so chunk them.
const CHUNK = 1800;
const secureStorage = {
  async getItem(key: string) {
    const count = await SecureStore.getItemAsync(`${key}.n`);
    if (count === null) return null;
    let out = '';
    for (let i = 0; i < Number(count); i++) {
      out += (await SecureStore.getItemAsync(`${key}.${i}`)) ?? '';
    }
    return out;
  },
  async setItem(key: string, value: string) {
    await secureStorage.removeItem(key);
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [''];
    for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}.${i}`, parts[i]);
    await SecureStore.setItemAsync(`${key}.n`, String(parts.length));
  },
  async removeItem(key: string) {
    const count = await SecureStore.getItemAsync(`${key}.n`);
    for (let i = 0; i < Number(count ?? 0); i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};

const webStorage = {
  getItem: async (k: string) => globalThis.localStorage?.getItem(k) ?? null,
  setItem: async (k: string, v: string) => void globalThis.localStorage?.setItem(k, v),
  removeItem: async (k: string) => void globalThis.localStorage?.removeItem(k),
};

export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
