// Native sessions use encrypted SecureStore. Web sessions last only for this tab.
let cached: string | null = null,
  loaded = false;
type Store = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};
let override: Store | undefined;
const listeners = new Set<() => void>();
async function storage(): Promise<Store | null> {
  if (override) return override;
  const { Platform } = await import("react-native");
  return Platform.OS === "web" ? null : await import("expo-secure-store");
}
export function setSessionStore(store: Store) {
  override = store;
  cached = null;
  loaded = false;
}
export async function getSession() {
  if (!loaded) {
    cached = (await (await storage())?.getItemAsync("finance.session")) || null;
    loaded = true;
  }
  return cached;
}
export async function saveSession(token: string | null) {
  const store = await storage();
  if (token) await store?.setItemAsync("finance.session", token);
  else await store?.deleteItemAsync("finance.session");
  cached = token;
  loaded = true;
  listeners.forEach((fn) => fn());
}
export function onSessionChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
