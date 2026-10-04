import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import webpush from 'web-push';
import { setEnvLine } from './auth';

// npm run push-keys [subject]: makes the web push keys (VAPID) and writes them into .env, only if
// they aren't there yet, since new keys would turn off notifications on every device. The deploy
// script runs it on the droplet with the site's address as the subject. Nothing secret is printed.

let env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const has = (name: string) => new RegExp(`^${name}=.+$`, 'm').test(env);
if (has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY')) {
  console.log('push-keys: .env already has push keys.');
} else {
  const keys = webpush.generateVAPIDKeys();
  env = setEnvLine(env, 'VAPID_PUBLIC_KEY', keys.publicKey);
  env = setEnvLine(env, 'VAPID_PRIVATE_KEY', keys.privateKey);
  const subject = process.argv[2];
  if (subject && !has('VAPID_SUBJECT')) env = setEnvLine(env, 'VAPID_SUBJECT', subject);
  writeFileSync('.env', env);
  chmodSync('.env', 0o600);
  console.log('push-keys: saved to .env. Restart the app for notifications to start.');
}
