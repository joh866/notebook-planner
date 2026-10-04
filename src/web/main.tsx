import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SignInGate } from './SignIn';
import './styles.css';
import './themes.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SignInGate>
      <App />
    </SignInGate>
  </StrictMode>,
);

// Installable on the phone's home screen (spec §3). Only the built app, so development never
// shows a cached page.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
