import { pushApi } from './client';

// Turning notifications on and off for this device (spec §13, §14). The service worker (sw.js,
// registered only in the built app) receives the pushes. On iPhone, push works only in the app
// added to the home screen.

export type PushSupport = 'ok' | 'install-first' | 'unsupported';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Whether this browser can get notifications here, or needs the home screen app first (iPhone). */
export function pushSupport(): PushSupport {
  if (isIos() && !installed()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

/** The service worker, if one is running here (not in development). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** This device's subscription, if notifications are on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await (await worker())?.pushManager.getSubscription()) ?? null;
}

/** The public key as the bytes `subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const keysOf = (sub: PushSubscription) => {
  const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  return { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } };
};

/** Asks for permission and subscribes. Returns a message to show when it can't. */
export async function turnOn(publicKey: string): Promise<string | null> {
  const reg = (await worker()) ?? (await navigator.serviceWorker.ready.catch(() => null));
  if (!reg) return 'Notifications need the online app, not this development server.';
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm !== 'granted') return 'Notifications are blocked for this site. Allow them in your browser’s or phone’s settings, then try again.';
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await pushApi.subscribe(keysOf(sub));
  return null;
}

/** Stops notifications on this device. */
export async function turnOff(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await pushApi.unsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/** When the app opens: tells the server this device's time zone again, in case it traveled. */
export async function refreshPush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub && Notification.permission === 'granted') await pushApi.subscribe(keysOf(sub));
}
