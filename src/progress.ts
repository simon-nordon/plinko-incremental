type ProgressStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/** Include legacy saves so migration cannot restore progress after a dev reset. */
export function resetAllProgress(storage: ProgressStorage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === 'plinko-prefs' || key?.startsWith('plinko-prefs-') || key?.startsWith('plinko-skills-')) {
      keys.push(key);
    }
  }
  for (const key of keys) storage.removeItem(key);
}
