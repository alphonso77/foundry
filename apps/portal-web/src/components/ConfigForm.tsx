import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { BlueprintManifest, InputField, ValidationError } from '../types';

type FieldValue = string | boolean | string[];
type Values = Record<string, FieldValue>;

interface Props {
  manifest: BlueprintManifest;
  serverErrors: ValidationError[];
  submitting: boolean;
  onSubmit: (config: Record<string, unknown>) => void;
}

function initialValues(fields: InputField[]): Values {
  const values: Values = {};
  for (const field of fields) {
    switch (field.type) {
      case 'string':
        values[field.key] = field.default ?? '';
        break;
      case 'boolean':
        values[field.key] = field.default ?? false;
        break;
      case 'select':
        values[field.key] = field.default ?? field.options[0]?.value ?? '';
        break;
      case 'multiselect':
        values[field.key] = field.default ?? [];
        break;
    }
  }
  return values;
}

// Client-side mirror of the contract's validation rules (required + pattern) for UX.
// The server remains the source of truth.
function clientValidate(fields: InputField[], values: Values): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === 'string') {
      const str = typeof value === 'string' ? value : '';
      if (field.required && !str.trim()) {
        errors[field.key] = `${field.label} is required.`;
      } else if (str && field.pattern && !new RegExp(field.pattern).test(str)) {
        errors[field.key] = `${field.label} has an invalid format.`;
      }
    } else if (field.type === 'select') {
      const str = typeof value === 'string' ? value : '';
      if (field.required && !str) {
        errors[field.key] = `${field.label} is required.`;
      }
    }
  }
  return errors;
}

function Control({
  field,
  value,
  onChange,
}: {
  field: InputField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  switch (field.type) {
    case 'string':
      return (
        <input
          id={field.key}
          className="field__input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <label className="toggle">
          <input
            id={field.key}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="toggle__track" aria-hidden="true" />
        </label>
      );
    case 'select':
      return (
        <select
          id={field.key}
          className="field__input"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="checkbox-group">
          {field.options.map((opt) => (
            <label className="checkbox" key={opt.value}>
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, opt.value]
                      : selected.filter((v) => v !== opt.value),
                  )
                }
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }
  }
}

export function ConfigForm({ manifest, serverErrors, submitting, onSubmit }: Props) {
  const fields = manifest.inputs.fields;
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const serverErrorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const err of serverErrors) {
      map[err.field] = err.message;
    }
    return map;
  }, [serverErrors]);

  function setValue(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors = clientValidate(fields, values);
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    onSubmit(values as Record<string, unknown>);
  }

  return (
    <form className="config-form" onSubmit={handleSubmit} noValidate>
      {fields.map((field) => {
        const error = clientErrors[field.key] ?? serverErrorMap[field.key];
        const required = 'required' in field && field.required === true;
        return (
          <div className="field" key={field.key}>
            <label className="field__label" htmlFor={field.key}>
              {field.label}
              {required ? <span className="field__req"> *</span> : null}
            </label>
            <Control field={field} value={values[field.key]} onChange={(v) => setValue(field.key, v)} />
            {field.help ? <p className="field__help">{field.help}</p> : null}
            {error ? <p className="field__error">{error}</p> : null}
          </div>
        );
      })}
      <button className="btn btn--primary" type="submit" disabled={submitting}>
        {submitting ? 'Generating…' : 'Generate & download'}
      </button>
    </form>
  );
}
