import type { AuditingService, ResolvedAuditingConfig } from './types.js'
import { HttpContext } from '@adonisjs/core/http'
import type { LoggerService } from '@adonisjs/core/types'
import { isDisabled, runDisabled } from './disable_scope.js'

export default class AuditingManager implements AuditingService {
  constructor(
    protected config: ResolvedAuditingConfig,
    protected logger: LoggerService
  ) {}

  isDisabled(): boolean {
    return isDisabled()
  }

  disabled<T>(callback: () => Promise<T>): Promise<T> {
    return runDisabled(callback)
  }

  async getUserForContext(): Promise<{ id: string; type: string } | null> {
    const ctx = HttpContext.get()
    if (!ctx) {
      this.logger.warn(
        'adonis-auditing: cannot read HttpContext (asyncLocalStorage disabled?). Skipping user resolution.'
      )
      return null
    }
    return this.config.userResolver.resolve(ctx)
  }

  async getMetadataForContext(): Promise<Record<string, unknown>> {
    const ctx = HttpContext.get()
    if (!ctx) {
      return {}
    }

    const promiseResults = await Promise.allSettled(
      Object.entries(this.config.resolvers).map(
        async ([key, resolver]) => [key, await resolver.resolve(ctx)] as const
      )
    )

    return Object.fromEntries(
      promiseResults
        .map((result) => {
          if (result.status === 'fulfilled') return result.value
          this.logger.warn(
            { reason: result.reason },
            'adonis-auditing: a metadata resolver rejected'
          )
          return null
        })
        .filter((value): value is readonly [string, unknown] => value !== null)
    )
  }

  getHiddenFields(): string[] {
    return this.config.hiddenFields
  }

  getAuditExclude(): string[] {
    return this.config.auditExclude
  }
}
