// Storage operations must finish in order: an old sign-out cannot erase a
// credential written by a subsequent sign-in, including after a rejected write.
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  };
}
