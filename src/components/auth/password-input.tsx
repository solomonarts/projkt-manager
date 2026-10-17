'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = {
  name: string;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  autoFocus?: boolean;
};

export default function PasswordInput({
  name,
  autoComplete,
  minLength,
  maxLength,
  required = true,
  autoFocus,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();

  return (
    <span className="password-input-wrap">
      <input
        id={inputId}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        required={required}
        autoFocus={autoFocus}
      />
      <button
        className="password-visibility-toggle"
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={inputId}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
      </button>
    </span>
  );
}
