import type { ComponentProps } from 'react';

// Native selection keeps platform keyboard navigation, typeahead and screen-reader support.
export default function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`ui-field ui-select ${className}`} />;
}
