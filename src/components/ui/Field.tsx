import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  optionalLabel?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, optionalLabel, description, error, className, children }: FieldProps) {
  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <div className="ui-field__label-row">
        <label className="ui-field__label" htmlFor={htmlFor}>{label}</label>
        {optionalLabel && <span className="ui-field__optional">{optionalLabel}</span>}
      </div>
      {children}
      {error ? (
        <p className="ui-field__message ui-field__message--error" id={`${htmlFor}-error`}>{error}</p>
      ) : description ? (
        <p className="ui-field__message" id={`${htmlFor}-description`}>{description}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  optionalLabel?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

export function TextField({ label, optionalLabel, description, error, fieldClassName, className, id, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = error ? `${inputId}-error` : description ? `${inputId}-description` : undefined;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      optionalLabel={optionalLabel}
      description={description}
      error={error}
      className={fieldClassName}
    >
      <input
        id={inputId}
        className={["ui-field__control", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        {...props}
      />
    </Field>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  optionalLabel?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

export function SelectField({ label, optionalLabel, description, error, fieldClassName, className, id, children, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = error ? `${inputId}-error` : description ? `${inputId}-description` : undefined;
  return (
    <Field label={label} htmlFor={inputId} optionalLabel={optionalLabel} description={description} error={error} className={fieldClassName}>
      <select
        id={inputId}
        className={["ui-field__control", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  optionalLabel?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

export function TextAreaField({ label, optionalLabel, description, error, fieldClassName, className, id, ...props }: TextAreaFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = error ? `${inputId}-error` : description ? `${inputId}-description` : undefined;
  return (
    <Field label={label} htmlFor={inputId} optionalLabel={optionalLabel} description={description} error={error} className={fieldClassName}>
      <textarea
        id={inputId}
        className={["ui-field__control", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        {...props}
      />
    </Field>
  );
}
