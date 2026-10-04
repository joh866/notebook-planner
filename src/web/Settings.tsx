import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { DateTime } from 'luxon';
import type { CanvasSync, CategoryView, GoogleStatus, SettingsView } from '../shared/api';
import { partnerOf, themeById, THEMES, type ThemeId } from '../shared/themes';
import { fmtTime } from './format';
import { categoryName, catStyle, CUSTOM_COLORS, findCategory, nextColor } from './cats';
import { classTitle } from './ClassDialog';
import { api, auth, deviceZone, googleApi, pushApi, type Changed, type ClassRow, type SettingsPatch } from './client';
import { currentSubscription, pushSupport, turnOff, turnOn } from './push';
import { XIcon } from './icons';
import { TimePicker } from './TimePicker';
import { clampDayTime, classLine, googleSyncMessage, NOTIFY_ROWS, pushBlocker, pushTestMessage, zoneCity, zoneList } from './settingsSheet';

interface Props {
  settings: SettingsView;
  categories: CategoryView[];
  /** A dialog is open on top, so Escape is its to handle. */
  covered: boolean;
  /** Runs a change, reloads, and says the message with Undo. */
  change: <T>(run: () => Promise<Changed<T>>, message: string | null | ((item: T) => string | null)) => Promise<unknown>;
  say: (message: string) => void;
  onEditClass: (id: string | 'new') => void;
  /** Wake or bed time changed, so the folded hours start folded again. */
  onDayTimes: () => void;
  /** Opens the time log (spec §13). */
  onTimeLog: () => void;
  /** Reloads the schedule after a change made outside `change` (Google Calendar). */
  onReload: () => void;
  onClose: () => void;
}

/** "today 2:15pm" or "Oct 3, 2:15pm" for the last Canvas check or Google sync. */
function canvasWhen(at: string): string {
  const d = DateTime.fromISO(at).toLocal();
  const time = fmtTime(d.hour * 60 + d.minute);
  return d.hasSame(DateTime.local(), 'day') ? `today ${time}` : `${d.toFormat('LLL d')}, ${time}`;
}

/** A theme picker (spec §13). Its own kind (day or night) is listed first; any theme can be picked. */
function ThemePick({ label, value, first, onPick }: { label: string; value: ThemeId; first: 'day' | 'night'; onPick: (id: ThemeId) => void }) {
  const groups = first === 'day' ? (['day', 'night'] as const) : (['night', 'day'] as const);
  return (
    <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value as ThemeId)}>
      {groups.map((g) => (
        <optgroup key={g} label={g === 'day' ? 'Day themes' : 'Night themes'}>
          {THEMES.filter((x) => x.mode === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** A row of buttons where one is chosen. */
function Seg<V extends string | number>({ value, options, label, onPick }: { value: V; options: [V, string][]; label: string; onPick: (v: V) => void }) {
  return (
    <div className="segc" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => v !== value && onPick(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A text field that saves when you leave it or press Enter. */
function Commit({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  // A new saved value (after Undo, say) replaces what's typed.
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setV(value);
  }
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

let zonesCache: string[] | null = null;
const knownZones = () => {
  try {
    zonesCache ??= Intl.supportedValuesOf('timeZone');
  } catch {
    zonesCache = [];
  }
  return zonesCache;
};

/** Notifications on this device: on or off, or why they can't be (spec §13). */
function PushDevice({ say }: { say: (m: string) => void }) {
  const [publicKey, setPublicKey] = useState<string | null | undefined>(undefined);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushApi.state().then((p) => setPublicKey(p.publicKey), () => setPublicKey(null));
    currentSubscription().then((s) => setOn(!!s), () => {});
  }, []);
  if (publicKey === undefined) return null;
  const blocker = pushBlocker(pushSupport(), publicKey);
  if (blocker) return <p className="hint">{blocker}</p>;
  const flip = async () => {
    setBusy(true);
    try {
      if (on) {
        await turnOff();
        setOn(false);
        say('Notifications are off on this device.');
      } else {
        const problem = await turnOn(publicKey!);
        if (problem) return say(problem);
        setOn(true);
        say('Notifications are on for this device.');
      }
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="srow">
      <div className="grow">
        <div>This device</div>
        <div className="sub2">{on ? 'Notifications are on here.' : 'Notifications are off here.'}</div>
      </div>
      <button className="box boxbtn" disabled={busy} onClick={() => void flip()}>
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  );
}

/**
 * Google Calendar (spec §14): Connect, which calendars to read, write-back to a "Planner" calendar,
 * Sync now, and Disconnect. `onChanged` reloads the schedule, since Google events show on it.
 */
function GoogleRows({ say, onChanged }: { say: (m: string) => void; onChanged: () => void }) {
  const [g, setG] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    googleApi.status().then(setG, () => {});
  }, []);
  const act = async <T,>(run: () => Promise<T>, done: (r: T) => void) => {
    setBusy(true);
    try {
      done(await run());
      setG(await googleApi.status());
      onChanged();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = () => window.location.assign('/api/google/connect');
  if (!g) return null;

  if (!g.connected || g.expired) {
    return (
      <div className="srow">
        <div className="grow">
          <div>Google Calendar</div>
          <div className="sub2">
            {!g.configured
              ? 'Not set up on the server yet. The steps are in GOOGLE.md.'
              : g.expired
                ? 'Google ended the sign-in, so events aren’t updating. Connect again to pick up where it left off.'
                : 'Show your Google events here, and optionally send planned blocks back to Google.'}
          </div>
        </div>
        <button className="box boxbtn" disabled={!g.configured} onClick={connect}>
          {g.expired ? 'Connect again' : 'Connect'}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="srow">
        <div className="grow">
          <div>Google Calendar</div>
          <div className="sub2">
            Connected{g.email ? ` as ${g.email}` : ''}. {g.syncedAt ? `Synced ${canvasWhen(g.syncedAt)}: ${g.note ?? ''}.` : 'Not synced yet.'} It syncs again every 15 minutes.
          </div>
        </div>
      </div>
      {g.calendars.map((c) => (
        <div className="srow" key={c.id}>
          <button
            className="cb"
            role="checkbox"
            aria-checked={c.on}
            aria-label={`Show ${c.name}`}
            disabled={busy}
            onClick={() => void act(() => googleApi.update({ calendars: { [c.id]: !c.on } }), () => {})}
          />
          <div className="grow">{c.name}</div>
        </div>
      ))}
      <div className="srow">
        <button
          className="cb"
          role="checkbox"
          aria-checked={g.writeBack}
          aria-label="Send planned blocks to Google"
          disabled={busy}
          onClick={() => void act(
            () => googleApi.update({ writeBack: !g.writeBack }),
            () => say(g.writeBack ? 'Planned blocks are off the Planner calendar in Google.' : 'Planned blocks now go to a “Planner” calendar in Google.'),
          )}
        />
        <div className="grow">
          <div>Send planned blocks to Google</div>
          <div className="sub2">Tasks, Quick things, and events you placed go to a “Planner” calendar, from yesterday to a month ahead.</div>
        </div>
      </div>
      <div className="srow">
        <span className="grow" />
        <button className="box boxbtn" disabled={busy} onClick={() => void act(() => googleApi.sync(), (r) => say(googleSyncMessage(r, g.writeBack)))}>
          Sync now
        </button>
        <button className="box boxbtn" disabled={busy} onClick={() => void act(() => googleApi.disconnect(), () => say('Google Calendar is disconnected. Its events are off the schedule.'))}>
          Disconnect
        </button>
      </div>
    </>
  );
}

async function testNotification(say: (m: string) => void) {
  try {
    say(pushTestMessage(await pushApi.test()));
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
  }
}

/** The gear button's sheet (spec §13). Every change saves right away. */
export function Settings({ settings: st, categories, covered, change, say, onEditClass, onDayTimes, onTimeLog, onReload, onClose }: Props) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canvas, setCanvas] = useState(st.canvasFeedUrl ?? '');
  const [savedCanvas, setSavedCanvas] = useState(st.canvasFeedUrl);
  if (savedCanvas !== st.canvasFeedUrl) {
    setSavedCanvas(st.canvasFeedUrl);
    setCanvas(st.canvasFeedUrl ?? '');
  }
  const [newCat, setNewCat] = useState('');
  /** Sign out shows only when the server has a sign-in (spec §3). */
  const [signedIn, setSignedIn] = useState(false);
  const sheet = useRef<HTMLElement>(null);

  useEffect(() => {
    auth.state().then((a) => setSignedIn(a.required && a.signedIn), () => {});
  }, []);

  const signOut = async () => {
    try {
      await auth.signOut();
      window.location.reload();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };

  // Classes and counts change elsewhere too, so they're fetched again whenever the app reloads.
  useEffect(() => {
    api.listClasses().then((c) => setClasses([...c].sort((a, b) => a.code.localeCompare(b.code) || a.start.localeCompare(b.start))), () => {});
    api.categoryCounts().then(setCounts, () => {});
  }, [st, categories]);

  useEffect(() => sheet.current?.focus(), []);

  useEffect(() => {
    if (covered) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [covered, onClose]);

  const patch = (body: SettingsPatch, message: string | null = null) => change(() => api.patchSettings(body), message);

  const dayTime = (which: 'wake' | 'bed', raw: string) => {
    if (!/^\d\d:\d\d$/.test(raw)) return;
    const { value, note } = clampDayTime(which, raw);
    onDayTimes();
    void patch(which === 'wake' ? { wakeTime: value } : { bedTime: value }, note);
  };

  const device = deviceZone();
  const zones = zoneList(knownZones(), device, st.timeZone === 'auto' ? device : st.timeZone, st.homeTimeZone);

  const saveCanvas = () => {
    const url = canvas.trim();
    if (url) {
      try {
        new URL(url);
      } catch {
        return say('That doesn’t look like a link. In Canvas, copy the whole Calendar Feed link.');
      }
    }
    if (url === (st.canvasFeedUrl ?? '')) return;
    void (async () => {
      await patch({ canvasFeedUrl: url || null }, url ? null : 'Cleared.');
      if (url) await checkCanvas('Saved.');
    })();
  };

  /** Fetches the feed now (spec §14). It also runs on its own every few hours. */
  const checkCanvas = (lead = '') => change(() => api.syncCanvas(), (r: CanvasSync) => {
    if (r.error) return `${lead} Couldn’t check Canvas: ${r.error}.`.trim();
    const what = r.added || r.updated
      ? `${r.added ? `${r.added} new` : ''}${r.added && r.updated ? ', ' : ''}${r.updated ? `${r.updated} updated` : ''}`
      : 'nothing new';
    return `${lead} Checked Canvas: ${r.seen} assignment${r.seen === 1 ? '' : 's'}, ${what}.`.trim();
  });

  const rename = (c: CategoryView, raw: string) => {
    const name = raw.trim();
    if (!name || name === c.name) return;
    const same = findCategory(categories, name);
    if (same && same.id !== c.id) return say(`There’s already a category called “${same.name}”.`);
    void change(() => api.patchCategory(c.id, { name }), `Renamed “${c.name}” to “${name}”.`);
  };
  const recolor = (c: CategoryView) => {
    if (!c.color) return;
    const color = CUSTOM_COLORS[(CUSTOM_COLORS.indexOf(c.color) + 1) % CUSTOM_COLORS.length]!;
    void change(() => api.patchCategory(c.id, { color }), null);
  };
  const addCat = () => {
    const name = categoryName(newCat);
    if (!name) return;
    const same = findCategory(categories, name);
    if (same) return say(`There’s already a category called “${same.name}”.`);
    setNewCat('');
    void change(() => api.addCategory(name, nextColor(categories)), `Made a new category, “${name}”.`);
  };

  return (
    <div className="sheet-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Settings" ref={sheet} tabIndex={-1}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="del" style={{ opacity: 0.8 }} aria-label="Close settings" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <section>
          <h3>Your day</h3>
          <p className="hint">The schedule opens on these hours, and the planner uses them for free time. Earlier and later hours fold away until you need them.</p>
          <div className="srow">
            <span className="grow">Usually up by</span>
            <TimePicker label="Usually up by" value={st.wakeTime} onCommit={(v) => dayTime('wake', v)} />
          </div>
          <div className="srow">
            <span className="grow">Usually asleep by</span>
            <TimePicker label="Usually asleep by" value={st.bedTime} onCommit={(v) => dayTime('bed', v)} />
          </div>
        </section>

        <section>
          <h3>Look</h3>
          <div className="srow">
            <div className="grow">
              <div>Day or night</div>
              <div className="sub2">Automatic switches to night at 8pm and back to day at 8am.</div>
            </div>
            <Seg label="Day or night" value={st.look} options={[['auto', 'Automatic'], ['day', 'Day'], ['night', 'Night']]} onPick={(look) => void patch({ look })} />
          </div>
          <div className="srow">
            <span className="grow">Day theme</span>
            <ThemePick label="Day theme" value={st.dayTheme} first="day"
              onPick={(dayTheme) => void patch({ dayTheme, nightTheme: partnerOf(dayTheme) }, `${themeById(dayTheme)!.name} by day, ${themeById(partnerOf(dayTheme))!.name} at night.`)} />
          </div>
          <div className="srow">
            <span className="grow">Night theme</span>
            <ThemePick label="Night theme" value={st.nightTheme} first="night" onPick={(nightTheme) => void patch({ nightTheme })} />
          </div>
        </section>

        <section>
          <h3>Time log</h3>
          <div className="srow">
            <span className="grow sub2">What you finished, with the estimate next to how long it took.</span>
            <button className="box boxbtn" onClick={onTimeLog}>Open</button>
          </div>
        </section>

        <section>
          <h3>Time zone</h3>
          <p className="hint">Automatic follows this device. Classes happen on {zoneCity(st.homeTimeZone)} time, so they show converted when you’re away.</p>
          <div className="srow">
            <span className="grow">Show times in</span>
            <select
              aria-label="Time zone"
              value={st.timeZone}
              onChange={(e) => {
                const timeZone = e.target.value;
                void patch({ timeZone }, timeZone === 'auto' ? `Following this device (${zoneCity(device)} time).` : `Showing times in ${zoneCity(timeZone)} time.`);
              }}
            >
              <option value="auto">Automatic ({zoneCity(device)})</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section>
          <h3>Planning</h3>
          <div className="srow">
            <button
              className="cb"
              role="checkbox"
              aria-checked={st.autoSchedule}
              aria-label="Schedule new tasks automatically"
              onClick={() => void patch({ autoSchedule: !st.autoSchedule })}
            />
            <div className="grow">
              <div>Schedule new tasks automatically</div>
              <div className="sub2">
                When you add a task that’s due soon, or meant for today or this week, the planner pencils it into your next free time. When this is off, new tasks wait in your list until you press Plan or drag them in.
              </div>
            </div>
          </div>
          <div className="srow">
            <span className="grow">Weeks start on</span>
            <Seg label="Weeks start on" value={st.weekStart} options={[[0, 'Sunday'], [1, 'Monday']]} onPick={(weekStart) => void patch({ weekStart })} />
          </div>
        </section>

        <section>
          <h3>Weekly classes</h3>
          {classes.map((c) => (
            <div className="srow" key={c.id}>
              <span className="swatch" style={catStyle(categories, c.categoryId ?? 'class')}></span>
              <div className="grow">
                <div>{classTitle(c)}</div>
                <div className="sub2">{classLine(c)}</div>
              </div>
              <button className="pill" onClick={() => onEditClass(c.id)}>
                Edit
              </button>
            </div>
          ))}
          <div className="srow">
            <button className="box boxbtn" onClick={() => onEditClass('new')}>
              Add a weekly class
            </button>
          </div>
        </section>

        <section>
          <h3>Categories</h3>
          <p className="hint">Edit a name to rename it. In the add box, #name files a task under that category, and a new #name makes a new one.</p>
          {categories.map((c) => (
            <div className="srow" key={c.id}>
              <button
                className="swatch"
                style={catStyle(categories, c.id)}
                disabled={!c.color}
                aria-label={c.color ? `Change ${c.name}’s color` : 'Built-in color'}
                title={c.color ? 'Change color' : 'Built-in color'}
                onClick={() => recolor(c)}
              />
              <Commit className="wide" value={c.name} aria-label={`${c.name} name`} onCommit={(v) => rename(c, v)} />
              <span className="sub2">
                {counts[c.id] ?? 0} task{counts[c.id] === 1 ? '' : 's'}
              </span>
            </div>
          ))}
          <div className="srow">
            <input
              className="wide"
              value={newCat}
              placeholder="New category, then Enter"
              aria-label="New category"
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCat()}
            />
          </div>
        </section>

        <section>
          <h3>Connections</h3>
          <GoogleRows say={say} onChanged={onReload} />
          <div className="srow wrap">
            <div className="full">
              <div>Canvas calendar feed</div>
              <div className="sub2">In Canvas, open Calendar, then Calendar Feed, and copy the link.</div>
            </div>
            <input
              className="wide"
              type="url"
              value={canvas}
              placeholder="Paste the feed link"
              aria-label="Canvas feed link"
              onChange={(e) => setCanvas(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveCanvas()}
            />
            <button className="box boxbtn" onClick={saveCanvas}>
              Save
            </button>
            {st.canvasFeedUrl && (
              <div className="full srow">
                <span className="grow sub2">
                  {st.canvasSyncedAt ? `Checked ${canvasWhen(st.canvasSyncedAt)}: ${st.canvasNote ?? ''}.` : 'Not checked yet.'} It checks again every 3 hours.
                </span>
                <button className="box boxbtn" onClick={() => void checkCanvas()}>Check now</button>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3>Notifications</h3>
          <PushDevice say={say} />
          {NOTIFY_ROWS.map((n) => (
            <div className="srow" key={n.key}>
              <button
                className="cb"
                role="checkbox"
                aria-checked={st.notify[n.key]}
                aria-label={n.label}
                onClick={() => void patch({ notify: { [n.key]: !st.notify[n.key] } })}
              />
              <div className="grow">
                <div>{n.label}</div>
                <div className="sub2">{n.sub}</div>
              </div>
            </div>
          ))}
          <div className="srow">
            <button className="box boxbtn" onClick={() => void testNotification(say)}>
              Send a test notification
            </button>
          </div>
        </section>

        {signedIn && (
          <section>
            <h3>Sign out</h3>
            <div className="srow">
              <span className="grow sub2">This device will need the password again.</span>
              <button className="box boxbtn" onClick={() => void signOut()}>Sign out</button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
