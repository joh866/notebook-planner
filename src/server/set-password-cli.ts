import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashPassword, newSecret, setEnvLine } from './auth';

// npm run set-password: asks for the sign-in password twice without showing it, then writes its hash
// (AUTH_PASSWORD_HASH) and a session secret (SESSION_SECRET) into .env. Nothing secret is printed.
// Running it again changes the password and signs every device out.

/** Asks a question without echoing what's typed. */
function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  let asked = false;
  out._writeToOutput = (s: string) => {
    if (!asked) {
      process.stdout.write(s);
      asked = true;
    }
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

if (!process.stdin.isTTY) {
  console.error('set-password: run this in a terminal, so the password can be typed without showing.');
  process.exit(1);
}
const password = await askHidden('New sign-in password: ');
if (password.length < 10) {
  console.error('set-password: use at least 10 characters. Nothing changed.');
  process.exit(1);
}
if ((await askHidden('Type it again: ')) !== password) {
  console.error('set-password: the two didn’t match. Nothing changed.');
  process.exit(1);
}

let env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
env = setEnvLine(env, 'AUTH_PASSWORD_HASH', hashPassword(password));
env = setEnvLine(env, 'SESSION_SECRET', newSecret());
writeFileSync('.env', env);
// Only this user can read it.
chmodSync('.env', 0o600);
console.log('set-password: saved to .env. Restart the app for it to take effect; every device will need to sign in again.');
