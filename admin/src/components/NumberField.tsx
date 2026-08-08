/**
 * Kept as its own module so the form pages that already import `NumberField` from here keep
 * working; the implementation now lives beside the other field wrappers.
 */
export { NumberField, type NumberFieldProps } from './form/fields';
