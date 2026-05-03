import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<true>()

export function isDisabled(): boolean {
  return storage.getStore() === true
}

export function runDisabled<T>(callback: () => Promise<T>): Promise<T> {
  return storage.run(true, callback)
}
