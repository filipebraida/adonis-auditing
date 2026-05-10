import type { HttpContext } from '@adonisjs/core/http'

export interface UserResolver {
  resolve(ctx: HttpContext): Promise<{ id: string; type: string } | null>
}

export interface Resolver {
  resolve(ctx: HttpContext): Promise<unknown>
}

export interface TenantResolver {
  resolve(ctx: HttpContext): Promise<string | null> | string | null
}

/**
 * Per-field masking strategy. Controls how a sensitive value is rewritten
 * before it reaches the audit row, so the row keeps useful "shape" without
 * leaking the secret itself.
 */
export type MaskStrategy =
  | { strategy: 'keep-last'; n: number; char?: string }
  | { strategy: 'keep-first'; n: number; char?: string }
  | { redact: (value: unknown) => string }

/**
 * Masking config. Either a list of field names (each gets the literal
 * '******' full mask, the original/legacy form), or a per-field record
 * mapping field name to either `true` (alias for full mask) or a
 * {@link MaskStrategy}.
 */
export type MaskConfig = string[] | Record<string, true | MaskStrategy>

export interface AuditingConfig {
  userResolver: () => Promise<{ default: new () => UserResolver }>
  resolvers: Record<string, () => Promise<{ default: new () => Resolver }>>
  hiddenFields?: MaskConfig
  auditExclude?: string[]
  tenantResolver?: () => Promise<{ default: new () => TenantResolver }>
  skipIfOnlyChanged?: string[]
}

export interface ResolvedAuditingConfig {
  userResolver: UserResolver
  resolvers: Record<string, Resolver>
  hiddenFields: MaskConfig
  auditExclude: string[]
  tenantResolver: TenantResolver | null
  skipIfOnlyChanged: string[]
}

export interface AuditingService {
  getUserForContext(): Promise<{ id: string; type: string } | null>
  getMetadataForContext(): Promise<Record<string, unknown>>
  getTenantForContext(): Promise<string | null>
  getRequestIdForContext(): Promise<string | null>
  getHiddenFields(): MaskConfig
  getAuditExclude(): string[]
  getSkipIfOnlyChanged(): string[]
  isDisabled(): boolean
  /**
   * Suppress auditing within the callback. Audits triggered inside —
   * lifecycle and custom — are silently skipped. Stack-aware: a nested
   * `withAuditing(...)` re-enables within its scope. Does NOT bypass
   * per-model `withoutAudit()`.
   */
  withoutAuditing<T>(callback: () => Promise<T>): Promise<T>
  /**
   * Force-enable auditing within the callback, escaping a surrounding
   * `withoutAuditing(...)` scope. The innermost wrapper wins. Does NOT
   * bypass per-model `withoutAudit()`.
   */
  withAuditing<T>(callback: () => Promise<T>): Promise<T>
}

export interface AuditCustomPayload {
  old?: Record<string, unknown>
  new?: Record<string, unknown>
  tags?: string[]
  metadata?: Record<string, unknown>
}
