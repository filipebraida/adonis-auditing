type AbstractConstructor<T> = abstract new (...args: any[]) => T

export type NormalizeConstructor<T extends AbstractConstructor<any>> = {
  new (...args: any[]): InstanceType<T>
} & Omit<T, 'constructor'>
