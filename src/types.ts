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

export interface AuditingConfig {
  userResolver: () => Promise<{ default: new () => UserResolver }>
  resolvers: Record<string, () => Promise<{ default: new () => Resolver }>>
  hiddenFields?: string[]
  auditExclude?: string[]
  tenantResolver?: () => Promise<{ default: new () => TenantResolver }>
  skipIfOnlyChanged?: string[]
}

export interface ResolvedAuditingConfig {
  userResolver: UserResolver
  resolvers: Record<string, Resolver>
  hiddenFields: string[]
  auditExclude: string[]
  tenantResolver: TenantResolver | null
  skipIfOnlyChanged: string[]
}

export interface AuditingService {
  getUserForContext(): Promise<{ id: string; type: string } | null>
  getMetadataForContext(): Promise<Record<string, unknown>>
  getTenantForContext(): Promise<string | null>
  getHiddenFields(): string[]
  getAuditExclude(): string[]
  getSkipIfOnlyChanged(): string[]
  isDisabled(): boolean
  disabled<T>(callback: () => Promise<T>): Promise<T>
}

export interface AuditCustomPayload {
  old?: Record<string, unknown>
  new?: Record<string, unknown>
  tags?: string[]
  metadata?: Record<string, unknown>
}
