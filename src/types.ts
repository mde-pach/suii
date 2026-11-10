// Shared types for suii.

export type FieldType = 'choice' | 'multi' | 'confirm' | 'rank' | 'buckets';

/** One option as written in the template, before rendering. */
export interface RawOption {
  label: string;
  value?: string;
  disabled?: boolean | string;
  default?: boolean | string;
  bucket?: string;
  if?: boolean | string;
}

/** Options generated from an array in the render context. */
export interface RawOptionsFrom {
  from: string;
  label: string;
  value?: string;
  disabled?: boolean | string;
  default?: boolean | string;
  bucket?: string;
  if?: boolean | string;
  limit?: number;
}

export interface RawBucket {
  id: string;
  label: string;
}

export interface RawField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  default?: boolean;
  min?: number;
  max?: number;
  top?: number;
  buckets?: RawBucket[];
  options?: RawOption[] | RawOptionsFrom;
}

export interface RawTemplate {
  title: string;
  intro?: string;
  fields: RawField[];
  submit?: string;
  cancel?: boolean | string;
}

/** An option after rendering: label is final markdown, value is the output value. */
export interface Option {
  label: string;
  value: string;
  disabled: boolean;
  default: boolean;
  bucket?: string;
}

export interface Bucket {
  id: string;
  label: string;
}

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required: boolean;
  /** confirm fields only. */
  default: boolean;
  min?: number;
  max?: number;
  top?: number;
  buckets: Bucket[];
  options: Option[];
}

/** A fully rendered form, ready to be written into an issue. */
export interface Form {
  title: string;
  intro: string;
  fields: Field[];
  submitLabel: string;
  cancel: boolean;
  cancelLabel: string;
}

export type FieldValue = string | string[] | boolean | Record<string, string[]> | null;
export type Values = Record<string, FieldValue>;

export type Status =
  | 'answered'
  | 'defaulted'
  | 'cancelled'
  | 'expired'
  | 'contested'
  | 'empty'
  | 'aborted'
  | 'error';
