import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { lookForHour } from '../core/look';
import { auth, SIGNED_OUT } from './client';

// One-person sign-in (spec §3). On localhost without a password the server says sign-in isn't
// required, and the planner opens straight away.

type Gate = 'checking' | 'in' | 'out' | { error: string };

export function SignInGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    auth.state().then(
      (s) => setGate(!s.required || s.signedIn ? 'in' : 'out'),
      (e: unknown) => setGate({ error: e instanceof Error ? e.message : String(e) }),
    );
    // A sign-in that ran out mid-use brings this screen back.
    const out = () => setGate('out');
    window.addEventListener(SIGNED_OUT, out);
    return () => window.removeEventListener(SIGNED_OUT, out);
  }, []);

  if (gate === 'in') return children;
  if (gate === 'out') return <SignIn />;
  return (
    <div className="device">
      <p className="loading">{gate === 'checking' ? 'Loading…' : `Couldn’t load the planner: ${gate.error}`}</p>
    </div>
  );
}

function SignIn() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The saved theme needs a sign-in to read, so this screen goes by the hour (spec §4).
  useEffect(() => {
    const look = lookForHour(new Date().getHours());
    document.body.dataset.mode = look;
    document.body.dataset.theme = `notebook-${look}`;
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(password);
      // Start fresh, so everything loads with the new sign-in.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="signin-card box" onSubmit={(e) => void submit(e)}>
        <h1>Planner</h1>
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          className="box"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="signin-error" role="alert">{error}</p>}
        <button className="box boxbtn" type="submit" disabled={!password || busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
