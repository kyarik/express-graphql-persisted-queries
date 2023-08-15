import { assert } from './assert';
import { UNIT_KIB } from './constants';
import { isNumber, isObject } from './typeguards';
import type { ParsedOptions } from './types';

export function parseOptions(options: unknown): ParsedOptions {
  assert(isObject(options), 'The options passed to the bodyParser middleware must be an object.');

  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  const maxSize = isNumber(options.maxSize) ? options.maxSize : 100 * UNIT_KIB;

  return { maxSize };
}
