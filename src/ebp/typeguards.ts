import type { Maybe } from './types';

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

export function nonNull<T>(value: Maybe<T>): value is T {
  return value != null;
}
