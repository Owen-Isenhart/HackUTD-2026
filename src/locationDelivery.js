import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

const task = 'hands-off-offer-region';
const storageKey = 'hands-off-location-device';
const origin = process.env.EXPO_PUBLIC_FINANCE_API_URL?.replace(/\/+$/, '');

export async function loadDeliveryDevice() {
  const saved = await SecureStore.getItemAsync(storageKey);
  if (!saved) return null;
  const device = JSON.parse(saved);
  return device.origin === origin && Date.parse(device.expiresAt) > Date.now() ? device : null;
}

export async function registerDeliveryDevice(ownerToken) {
  const response = await fetch(`${origin}/api/v1/devices`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  if (!response.ok) throw new Error('Device registration failed.');
  const device = { ...await response.json(), origin };
  await SecureStore.setItemAsync(storageKey, JSON.stringify(device), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return device;
}

export async function stopNativeDelivery() {
  if (await TaskManager.isAvailableAsync() && await Location.hasStartedGeofencingAsync(task)) await Location.stopGeofencingAsync(task);
}

export async function clearDeliveryDevice(ownerToken, device) {
  await SecureStore.deleteItemAsync(storageKey);
  await stopNativeDelivery();
  if (device) await fetch(`${origin}/api/v1/devices/${device.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
}

export async function nativeDeliveryAvailable() {
  return TaskManager.isAvailableAsync();
}

export async function registerDeliveryRegions(ownerToken, requestPermission = false) {
  if (!await nativeDeliveryAvailable()) return 'foreground_only';
  if (requestPermission) {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return 'permission_required';
  }
  const background = await (requestPermission ? Location.requestBackgroundPermissionsAsync() : Location.getBackgroundPermissionsAsync());
  if (!background.granted) return 'permission_required';
  const response = await fetch(`${origin}/api/v1/location/regions`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  if (!response.ok) throw new Error('Could not load offer regions.');
  const { regions } = await response.json();
  if (!regions.length) {
    await stopNativeDelivery();
    return 'no_regions';
  }
  await Location.startGeofencingAsync(task, regions);
  return 'active';
}

export async function submitDeliveryFix(device, fix, signal) {
  const { latitude, longitude, accuracy } = fix.coords;
  const controller = signal ? null : new AbortController();
  const timeout = controller && setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${origin}/api/v1/location/events`, {
      method: 'POST', signal: signal ?? controller.signal,
      headers: { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: Crypto.randomUUID(), deviceId: device.id, source: 'live', type: 'fix',
        fix: { coords: { latitude, longitude, accuracy }, timestamp: fix.timestamp } }),
    });
    if (!response.ok) throw new Error('Location event unavailable.');
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

TaskManager.defineTask(task, async ({ data, error }) => {
  if (error || data?.eventType !== Location.GeofencingEventType.Enter) return;
  let timer;
  try {
    const device = await loadDeliveryDevice();
    if (!device) return;
    const fix = await Location.getLastKnownPositionAsync({ maxAge: 5000, requiredAccuracy: 60 })
      ?? await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 7000); }),
      ]);
    if (fix) await submitDeliveryFix(device, fix);
  } catch {
    // Geofence delivery is best-effort. A stale fix is never retried after a wakeup.
  } finally {
    clearTimeout(timer);
  }
});
