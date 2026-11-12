/** Share reads within one render only, so later renders still observe file changes. */
export function cacheImageLoader(load: (path: string) => Promise<string>) {
  const reads = new Map<string, Promise<string>>();
  return (path: string): Promise<string> => {
    let read = reads.get(path);
    if (!read) {
      read = Promise.resolve().then(() => load(path));
      reads.set(path, read);
    }
    return read;
  };
}
