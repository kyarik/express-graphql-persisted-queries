import type { AnyFunction, Maybe } from './types';

export function isFunction(value: unknown): value is AnyFunction {
  return typeof value === 'function';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function nonNull<T>(value: Maybe<T>): value is T {
  return value != null;
}
