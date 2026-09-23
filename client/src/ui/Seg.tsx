import { cls } from '../lib/cls'

export interface SegOption<T extends string> {
  value: T
  label: string
}

/** The site's segmented switch (its language switch), for any small choice. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: readonly SegOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div className={cls('seg', disabled && 'off')} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cls(option.value === value && 'on')}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const ON_OFF = [
  { value: 'off', label: 'Вимк.' },
  { value: 'on', label: 'Увімк.' },
] as const

export function OnOff({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Seg
      options={ON_OFF}
      value={value ? 'on' : 'off'}
      label={label}
      disabled={disabled}
      onChange={(next) => {
        onChange(next === 'on')
      }}
    />
  )
}
