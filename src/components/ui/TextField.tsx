import type { ComponentProps } from 'react';

export default function TextField({ className = '', ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`ui-field ${className}`} />;
}

export function TextArea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`ui-field ui-textarea ${className}`} />;
}

export function Checkbox({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input {...props} type="checkbox" className={`ui-checkbox ${className}`} />;
}
