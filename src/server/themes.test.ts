import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { SettingsView } from '../shared/api';
import { createApp } from './app';
import { openDb } from './db/client';
import { seed } from './db/seed';

// Themes (spec §4, §13): a day theme and a night theme, Notebook by default.

describe('theme settings', () => {
  it('default to the Notebook pair, save each one, and refuse unknown themes', async () => {
    const db = openDb(':memory:');
    seed(db);
    const app = createApp({ db, now: () => DateTime.utc() });
    const get = async () => (await (await app.request('/api/settings')).json()) as SettingsView;
    const patch = (body: unknown) => app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    expect(await get()).toMatchObject({ dayTheme: 'notebook-day', nightTheme: 'notebook-night' });
    expect((await patch({ dayTheme: 'sepia', nightTheme: 'hearth-dusk' })).status).toBe(200);
    expect((await patch({ nightTheme: 'sleek-dark' })).status).toBe(200);
    expect(await get()).toMatchObject({ dayTheme: 'sepia', nightTheme: 'sleek-dark' });
    expect((await patch({ dayTheme: 'neon' })).status).toBe(400);
  });
});
