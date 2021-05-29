export function assert(condition: unknown, msg: string): asserts condition {
  const booleanCondition = Boolean(condition);

  if (!booleanCondition) {
    throw new TypeError(msg);
  }
}
