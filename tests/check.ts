export function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const act = JSON.stringify(actual);
  const exp = JSON.stringify(expected);
  if (act !== exp) {
    throw new Error(msg ?? `expected ${exp} but got ${act}`);
  }
}

export async function assertRejects(fn: () => Promise<unknown>, msg?: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(msg ?? "expected function to reject but it resolved");
}
