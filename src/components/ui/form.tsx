'use client';

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />;
}
export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className || ''}`} />;
}
export function TextAreaInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input ${props.className || ''}`} />;
}
export function CheckInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="checkbox" className={`ui-checkbox ${props.className || ''}`} />;
}
export function FormField({
  label,
  children,
  help,
  required,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  required?: boolean;
  /** Use htmlFor when the field includes extra interactive controls or a custom select. */
  htmlFor?: string;
}) {
  const title = (
    <span className="field-label">
      {label}
      {required && <span aria-hidden="true"> *</span>}
    </span>
  );
  const hint = help && <span className="muted mt-1 block text-xs">{help}</span>;
  if (htmlFor) {
    return (
      <div className="block">
        <label htmlFor={htmlFor}>{title}</label>
        {children}
        {hint}
      </div>
    );
  }
  return (
    <label className="block">
      {title}
      {children}
      {hint}
    </label>
  );
}
