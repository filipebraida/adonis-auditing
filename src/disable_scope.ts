import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<boolean>()

export function isDisabled(): boolean {
  return storage.getStore() === true
}

export function runWithoutAuditing<T>(callback: () => Promise<T>): Promise<T> {
  return storage.run(true, callback)
}

export function runWithAuditing<T>(callback: () => Promise<T>): Promise<T> {
  return storage.run(false, callback)
}
