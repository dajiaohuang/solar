import { useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number; onValueChange: (value: number) => void
}

/** Preserve empty/sign/decimal editing without committing it as zero or NaN.
 * Leaving an incomplete field restores its last accepted numeric value. */
export function NumberDraftInput({ value, onValueChange, ...props }: Props) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState('')
  return <input {...props} type="number" value={editing ? draft : value}
    onFocus={event => { setDraft(String(value)); setEditing(true); props.onFocus?.(event) }}
    onChange={event => {
      setDraft(event.target.value)
      if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) onValueChange(event.target.valueAsNumber)
    }}
    onBlur={event => { setEditing(false); props.onBlur?.(event) }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setEditing(false); event.currentTarget.blur() }
      else if (event.key === 'Enter') event.currentTarget.blur()
      props.onKeyDown?.(event)
    }} />
}
