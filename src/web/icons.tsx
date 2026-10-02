// Hand-drawn icons from design/prototype-6.html.

export const PinIcon = () => (
  <svg className="ic" viewBox="0 0 16 16" aria-label="Pinned">
    <title>Pinned by you. The planner won’t move it.</title>
    <path fill="currentColor" d="M10.2 1.3 14.7 5.8l-1.4.6-2.4 2.4.2 3-1.3 1.3-2.7-2.7L3.4 14.1H2v-1.4l3.7-3.7L3 6.3 4.3 5l3 .2 2.4-2.4z" />
  </svg>
);

export const PencilIcon = () => (
  <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-label="Penciled in">
    <title>Penciled in by the planner. It may move this.</title>
    <path d="M10.8 2.4l2.8 2.8-7.9 7.9-3.5.7.7-3.5z" />
    <path d="M9.3 3.9l2.8 2.8" />
  </svg>
);

export const RepeatIcon = () => (
  <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Repeats">
    <title>Repeats</title>
    <path d="M2.5 7.5a5.5 5.5 0 0 1 9.4-3.4l1.3 1.3M13.2 2v3.4H9.8M13.5 8.5a5.5 5.5 0 0 1-9.4 3.4l-1.3-1.3M2.8 14v-3.4h3.4" />
  </svg>
);

export const PlusIcon = () => (
  <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/** The square checkbox with a drawn tick. */
export function Check({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className="cb"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Done: ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}
