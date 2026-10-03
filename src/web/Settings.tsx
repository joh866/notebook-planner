import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import type { CategoryView, SettingsView } from '../shared/api';
import { categoryName, catStyle, CUSTOM_COLORS, findCategory, nextColor } from './cats';
import { classTitle } from './ClassDialog';
import { api, deviceZone, type Changed, type ClassRow, type SettingsPatch } from './client';
import { XIcon } from './icons';
import { TimePicker } from './TimePicker';
import { clampDayTime, classLine, NOTIFY_ROWS, zoneCity, zoneList } from './settingsSheet';

interface Props {
  settings: SettingsView;
  categories: CategoryView[];
  /** A dialog is open on top, so Escape is its to handle. */
  covered: boolean;
  /** Runs a change, reloads, and says the message with Undo. */
  change: <T>(run: () => Promise<Changed<T>>, message: string | null) => Promise<unknown>;
  say: (message: string) => void;
  onEditClass: (id: string | 'new') => void;
  /** Wake or bed time changed, so the folded hours start folded again. */
  onDayTimes: () => void;
  /** Opens the time log (spec §13). */
  onTimeLog: () => void;
  onClose: () => void;
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

async function testNotification(say: (m: string) => void) {
  if (!('Notification' in window)) return say('This browser can’t show notifications.');
  try {
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return say('Notifications are blocked for this site. Allow them in your browser’s site settings.');
    new Notification('CHEM 10100 lecture in 10 minutes', { body: 'This is a test notification.' });
    say('Sent. Check your notifications.');
  } catch {
    say('This browser can’t show notifications here. They’ll work once the app is installed.');
  }
}

/** The gear button's sheet (spec §13). Every change saves right away. */
export function Settings({ settings: st, categories, covered, change, say, onEditClass, onDayTimes, onTimeLog, onClose }: Props) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canvas, setCanvas] = useState(st.canvasFeedUrl ?? '');
  const [savedCanvas, setSavedCanvas] = useState(st.canvasFeedUrl);
  if (savedCanvas !== st.canvasFeedUrl) {
    setSavedCanvas(st.canvasFeedUrl);
    setCanvas(st.canvasFeedUrl ?? '');
  }
  const [newCat, setNewCat] = useState('');
  const sheet = useRef<HTMLElement>(null);

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
    void patch({ canvasFeedUrl: url || null }, url ? 'Saved. Canvas assignments will show up here once the feed is connected in a later step.' : 'Cleared.');
  };

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
          <h3>Time log</h3>
          <div className="srow">
            <span className="grow sub2">What you finished, with the estimate next to how long it took.</span>
            <button className="box boxbtn" onClick={onTimeLog}>Open</button>
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
          <div className="srow">
            <div className="grow">
              <div>Google Calendar</div>
              <div className="sub2">Show your Google events here, and send planned blocks back to Google.</div>
            </div>
            <button className="box boxbtn" onClick={() => say('Google Calendar comes in a later step.')}>
              Connect
            </button>
          </div>
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
          </div>
        </section>

        <section>
          <h3>Notifications</h3>
          <p className="hint">These start working once the app is online (a later step). Your choices are saved now.</p>
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
      </aside>
    </div>
  );
}
