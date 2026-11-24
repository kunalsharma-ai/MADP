'use client';

/** An on/off switch. It only reports the click: the caller decides what happens (e.g. ask for a reason first). */
export function Toggle({
  on,
  onClick,
  label,
  disabled,
  pending,
  size = 'md',
  readOnly,
}: {
  on: boolean;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  /** shows the switch half-way while a change waits for its reason or is saving */
  pending?: boolean;
  size?: 'sm' | 'md';
  /** shows the state only (for people who can't change it, or a list of rules) */
  readOnly?: boolean;
}) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const shift = size === 'sm' ? 'translate-x-4' : 'translate-x-5';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-readonly={readOnly || undefined}
      tabIndex={readOnly ? -1 : undefined}
      onClick={readOnly ? undefined : onClick}
      className={`relative ${readOnly ? 'cursor-default' : 'cursor-pointer'} inline-flex shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${track} ${on ? 'bg-teal' : 'bg-fg-3/40'} ${pending ? 'opacity-60' : ''}`}
    >
      <span
        aria-hidden
        className={`inline-block rounded-full bg-white shadow transition-transform ${knob} ${on ? shift : 'translate-x-0'}`}
      />
    </button>
  );
}

/** A toggle with its state written next to it. */
export function ToggleLabel({
  on,
  onText = 'On',
  offText = 'Off',
}: {
  on: boolean;
  onText?: string;
  offText?: string;
}) {
  return (
    <span className={`text-[12.5px] font-medium ${on ? 'text-teal' : 'text-fg-3'}`}>
      {on ? onText : offText}
    </span>
  );
}
