import type { AuditingService, MaskConfig, ResolvedAuditingConfig } from './types.js'
import { HttpContext } from '@adonisjs/core/http'
import type { LoggerService } from '@adonisjs/core/types'
import { isDisabled, runWithAuditing, runWithoutAuditing } from './disable_scope.js'

export default class AuditingManager implements AuditingService {
  constructor(
    protected config: ResolvedAuditingConfig,
    protected logger: LoggerService
  ) {}

  isDisabled(): boolean {
    return isDisabled()
  }

  /**
   * Suppress auditing within the callback. Any audits triggered inside —
   * model lifecycle (create/update/delete) and `auditCustom` — are silently
   * skipped. Useful for seeders, bulk migrations, or automation endpoints
   * where audit noise has no value.
   *
   * Nested `withAuditing(...)` re-enables auditing within a narrower scope.
   *
   * Note: this controls the per-scope AsyncLocalStorage flag only. It does
   * NOT bypass the per-model `withoutAudit()` instance flag, which is a
   * stronger explicit signal from the calling code and remains independent.
   */
  withoutAuditing<T>(callback: () => Promise<T>): Promise<T> {
    return runWithoutAuditing(callback)
  }

  /**
   * Force-enable auditing within the callback, escaping any surrounding
   * `withoutAuditing(...)` scope. Use sparingly — intended for legitimate
   * business events that must audit even within bulk-suppressed contexts
   * (e.g., automation API endpoints that wrap the whole request in
   * `withoutAuditing()` but still need to record one specific domain event).
   *
   * Nested scopes follow stack rules: the innermost wrapper wins.
   *
   * Note: this only escapes the SCOPE-level disable. Per-model
   * `withoutAudit()` is independent and still suppresses audits for that
   * specific instance.
   */
  withAuditing<T>(callback: () => Promise<T>): Promise<T> {
    return runWithAuditing(callback)
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

  async getTenantForContext(): Promise<string | null> {
    if (!this.config.tenantResolver) return null
    const ctx = HttpContext.get()
    if (!ctx) return null
    try {
      return await this.config.tenantResolver.resolve(ctx)
    } catch (error) {
      this.logger.warn(
        { err: error },
        'adonis-auditing: tenantResolver threw. Falling back to model.tenantId if present.'
      )
      return null
    }
  }

  async getRequestIdForContext(): Promise<string | null> {
    const ctx = HttpContext.get()
    return ctx?.request.id() ?? null
  }

  getHiddenFields(): MaskConfig {
    return this.config.hiddenFields
  }

  getAuditExclude(): string[] {
    return this.config.auditExclude
  }

  getSkipIfOnlyChanged(): string[] {
    return this.config.skipIfOnlyChanged
  }
}
