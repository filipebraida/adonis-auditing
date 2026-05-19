import type { BaseModel } from '@adonisjs/lucid/orm'
import {
  beforeCreate,
  afterCreate,
  beforeUpdate,
  afterUpdate,
  beforeDelete,
  afterDelete,
} from '@adonisjs/lucid/orm'
import type { ModelObject } from '@adonisjs/lucid/types/model'
import type { EmitterService } from '@adonisjs/core/types'
import type { AuditCustomPayload, AuditingService, MaskConfig, MaskStrategy } from '../types.js'
import type { NormalizeConstructor } from '../utils/normalized_constructor.js'
import Audit from '../audit.js'
import { E_AUDIT_COMMENT_MISSING } from '../errors.js'

const FULL_MASK = '******'

/**
 * Look up the masking strategy for a single field. Per-model mask wins over
 * global hiddenFields (more specific). Returns `null` when the field is not
 * masked anywhere.
 */
function resolveMaskStrategy(
  field: string,
  perModel: MaskConfig,
  global: MaskConfig
): MaskStrategy | true | null {
  // Per-model first (more specific).
  if (Array.isArray(perModel)) {
    if (perModel.includes(field)) return true
  } else if (Object.prototype.hasOwnProperty.call(perModel, field)) {
    return perModel[field]
  }
  // Then global.
  if (Array.isArray(global)) {
    if (global.includes(field)) return true
  } else if (Object.prototype.hasOwnProperty.call(global, field)) {
    return global[field]
  }
  return null
}

/**
 * Apply a resolved strategy to a single value. `true` and `string[]` entries
 * collapse to the literal full mask; structured strategies operate on the
 * value's string form. Null / undefined pass through untouched so we don't
 * fabricate data.
 */
function applyMask(value: unknown, strategy: MaskStrategy | true): string | null | undefined {
  if (value === null || value === undefined) return value as null | undefined
  if (strategy === true) return FULL_MASK

  if ('redact' in strategy) {
    return strategy.redact(value)
  }

  const str = String(value)
  const char = strategy.char ?? '*'
  const n = strategy.n

  if (strategy.strategy === 'keep-last') {
    if (str.length <= n) {
      // Value is too short to safely reveal `n` chars — degrade to full mask
      // so we never leak the original string.
      return str.length === 0 ? FULL_MASK : char.repeat(str.length)
    }
    return char.repeat(str.length - n) + str.slice(-n)
  }

  // keep-first
  if (str.length <= n) {
    return str.length === 0 ? FULL_MASK : char.repeat(str.length)
  }
  return str.slice(0, n) + char.repeat(str.length - n)
}

export function withAuditable() {
  return <T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) => {
    class ModelWithAudit extends superclass {
      static auditableName?: string
      static auditExclude: string[] = []
      static auditInclude: string[] = []
      static auditMask: MaskConfig = []
      static auditIf?: (model: any, event: string) => boolean | Promise<boolean>
      static auditCommentRequired: boolean = false

      static resolveAuditableName(): string {
        return this.auditableName ?? this.name
      }

      static filterAuditAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
        if (this.auditInclude.length > 0) {
          const out: Record<string, unknown> = {}
          for (const key of this.auditInclude) {
            if (key in attrs) out[key] = attrs[key]
          }
          return out
        }
        if (this.auditExclude.length > 0) {
          const out: Record<string, unknown> = { ...attrs }
          for (const key of this.auditExclude) delete out[key]
          return out
        }
        return { ...attrs }
      }

      $isAuditDisabled = false

      declare auditComment?: string

      auditTags(): string[] | Promise<string[]> {
        return []
      }

      async withoutAudit<R>(callback: () => Promise<R>): Promise<R> {
        const prev = this.$isAuditDisabled
        this.$isAuditDisabled = true
        try {
          return await callback()
        } finally {
          this.$isAuditDisabled = prev
        }
      }

      async auditCustom(event: string, payload: AuditCustomPayload = {}) {
        const ctor = this.constructor as typeof ModelWithAudit
        const comment = this.auditComment ?? null

        if (ctor.auditCommentRequired && !comment) {
          throw new E_AUDIT_COMMENT_MISSING([ctor.resolveAuditableName(), event])
        }

        try {
          await this.$writeAudit({
            event,
            oldValues: payload.old ?? null,
            newValues: payload.new ?? null,
            tags: payload.tags ?? null,
            metadata: payload.metadata,
            auditComment: comment,
          })
        } finally {
          delete (this as any).auditComment
        }
      }

      audits() {
        const ctor = this.constructor as typeof ModelWithAudit
        return Audit.query()
          .where('auditableType', ctor.resolveAuditableName())
          .where('auditableId', (this as any).id)
      }

      $auditValuesToSave: ModelObject = {}
      $auditDirtyKeys: string[] = []

      $backupAuditValues() {
        this.$auditValuesToSave = { ...this.$original }
        this.$auditDirtyKeys = Object.keys(this.$dirty)
      }

      async $applyGlobalExclude(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
        await ModelWithAudit.#lazyServices()
        const exclude = ModelWithAudit.#auditing!.getAuditExclude()
        if (exclude.length === 0) return obj
        const set = new Set(exclude)
        const out: Record<string, unknown> = {}
        for (const k of Object.keys(obj)) {
          if (!set.has(k)) out[k] = obj[k]
        }
        return out
      }

      static #emitter?: EmitterService
      static #auditing?: AuditingService

      static async #lazyServices() {
        if (!ModelWithAudit.#emitter) {
          const mod = await import('@adonisjs/core/services/emitter')
          ModelWithAudit.#emitter = mod.default
        }
        // Tests boot multiple apps; caching the manager reference would alias
        // to the first boot. Dynamic import + per-call resolve returns the
        // current app's singleton.
        const appModule = await import('@adonisjs/core/services/app')
        const app = appModule.default
        ModelWithAudit.#auditing = await app.container.make('auditing.manager')
      }

      async $writeAudit(opts: {
        event: string
        oldValues: Record<string, unknown> | null
        newValues: Record<string, unknown> | null
        tags?: string[] | null
        metadata?: Record<string, unknown>
        auditComment?: string | null
      }) {
        await ModelWithAudit.#lazyServices()
        if (this.$isAuditDisabled || ModelWithAudit.#auditing!.isDisabled()) return

        const user = await ModelWithAudit.#auditing!.getUserForContext()
        const ctxMeta = await ModelWithAudit.#auditing!.getMetadataForContext()
        const tenantFromCtx = await ModelWithAudit.#auditing!.getTenantForContext()
        const requestId = await ModelWithAudit.#auditing!.getRequestIdForContext()

        const ctor = this.constructor as typeof ModelWithAudit
        const globalMask = ModelWithAudit.#auditing!.getHiddenFields()
        const perModelMask = ctor.auditMask
        const hasAnyMask =
          (Array.isArray(globalMask) ? globalMask.length : Object.keys(globalMask).length) > 0 ||
          (Array.isArray(perModelMask) ? perModelMask.length : Object.keys(perModelMask).length) > 0

        const maskValues = (obj: Record<string, unknown> | null) => {
          if (!obj || !hasAnyMask) return obj
          const out: Record<string, unknown> = {}
          for (const k of Object.keys(obj)) {
            const strategy = resolveMaskStrategy(k, perModelMask, globalMask)
            out[k] = strategy === null ? obj[k] : applyMask(obj[k], strategy)
          }
          return out
        }

        const audit = new Audit()
        audit.userType = user?.type ?? null
        audit.userId = user?.id ?? null
        audit.event = opts.event
        audit.auditableType = ctor.resolveAuditableName()
        audit.auditableId = (this as any).id
        audit.oldValues = maskValues(opts.oldValues)
        audit.newValues = maskValues(opts.newValues)
        const extraTags = await this.auditTags()
        const mergedTags = [...(opts.tags ?? []), ...extraTags]
        audit.tags = mergedTags.length > 0 ? mergedTags : null
        audit.metadata = maskValues({ ...ctxMeta, ...(opts.metadata ?? {}) })!
        if (tenantFromCtx !== null && tenantFromCtx !== undefined) {
          audit.tenantId = tenantFromCtx
        } else {
          const fromModel = (this as any).tenantId
          audit.tenantId = fromModel !== null && fromModel !== undefined ? String(fromModel) : null
        }
        audit.requestId = requestId
        audit.auditComment = opts.auditComment ?? null

        if (this.$trx) {
          audit.useTransaction(this.$trx)
        }

        await audit.save()
        await ModelWithAudit.#emitter!.emit('audit:created', { audit })
      }

      @beforeCreate()
      static async __auditBeforeCreate(model: ModelWithAudit) {
        model.$backupAuditValues()
      }

      @afterCreate()
      static async __auditAfterCreate(model: ModelWithAudit) {
        await ModelWithAudit.#lazyServices()

        // Bail out early if auditing is disabled — no comment check, no audit work.
        // Mirrors the spirit of withoutAudit: this save is not audited; nothing
        // audit-related (including the comment-required guard) should run.
        if (model.$isAuditDisabled || ModelWithAudit.#auditing!.isDisabled()) return

        const ctor = model.constructor as typeof ModelWithAudit
        const comment = model.auditComment ?? null

        const filtered = ctor.filterAuditAttributes(model.$attributes)
        const final = await model.$applyGlobalExclude(filtered)
        if (Object.keys(final).length === 0) return
        if (ctor.auditIf && !(await ctor.auditIf(model, 'created'))) return

        // Only enforce the comment requirement when an audit row is actually
        // about to be written; skip checks above must short-circuit first.
        if (ctor.auditCommentRequired && !comment) {
          throw new E_AUDIT_COMMENT_MISSING([ctor.resolveAuditableName(), 'created'])
        }

        try {
          await model.$writeAudit({
            event: 'created',
            oldValues: null,
            newValues: final,
            tags: ['mutation'],
            auditComment: comment,
          })
        } finally {
          delete (model as any).auditComment
        }
      }

      @beforeUpdate()
      static async __auditBeforeUpdate(model: ModelWithAudit) {
        model.$backupAuditValues()
      }

      @afterUpdate()
      static async __auditAfterUpdate(model: ModelWithAudit) {
        await ModelWithAudit.#lazyServices()

        // Bail out early if auditing is disabled — see __auditAfterCreate.
        if (model.$isAuditDisabled || ModelWithAudit.#auditing!.isDisabled()) return

        const ctor = model.constructor as typeof ModelWithAudit
        const comment = model.auditComment ?? null

        const dirtyKeys = model.$auditDirtyKeys
        if (dirtyKeys.length === 0) return

        const skipList = ModelWithAudit.#auditing!.getSkipIfOnlyChanged()
        if (skipList.length > 0 && dirtyKeys.every((k) => skipList.includes(k))) return

        const oldRaw: Record<string, unknown> = {}
        const newRaw: Record<string, unknown> = {}
        for (const key of dirtyKeys) {
          oldRaw[key] = model.$auditValuesToSave[key]
          newRaw[key] = model.$attributes[key]
        }

        const oldFiltered = ctor.filterAuditAttributes(oldRaw)
        const newFiltered = ctor.filterAuditAttributes(newRaw)
        const oldFinal = await model.$applyGlobalExclude(oldFiltered)
        const newFinal = await model.$applyGlobalExclude(newFiltered)
        if (Object.keys(newFinal).length === 0) return

        if (ctor.auditIf && !(await ctor.auditIf(model, 'updated'))) return

        // Only enforce the comment requirement when an audit row is actually
        // about to be written; skip checks above must short-circuit first.
        if (ctor.auditCommentRequired && !comment) {
          throw new E_AUDIT_COMMENT_MISSING([ctor.resolveAuditableName(), 'updated'])
        }

        try {
          await model.$writeAudit({
            event: 'updated',
            oldValues: oldFinal,
            newValues: newFinal,
            tags: ['mutation'],
            auditComment: comment,
          })
        } finally {
          delete (model as any).auditComment
        }
      }

      @beforeDelete()
      static async __auditBeforeDelete(model: ModelWithAudit) {
        model.$backupAuditValues()
      }

      @afterDelete()
      static async __auditAfterDelete(model: ModelWithAudit) {
        await ModelWithAudit.#lazyServices()

        // Bail out early if auditing is disabled — see __auditAfterCreate.
        if (model.$isAuditDisabled || ModelWithAudit.#auditing!.isDisabled()) return

        const ctor = model.constructor as typeof ModelWithAudit
        const comment = model.auditComment ?? null

        const filtered = ctor.filterAuditAttributes(model.$auditValuesToSave)
        const final = await model.$applyGlobalExclude(filtered)
        if (Object.keys(final).length === 0) return
        if (ctor.auditIf && !(await ctor.auditIf(model, 'deleted'))) return

        // Only enforce the comment requirement when an audit row is actually
        // about to be written; skip checks above must short-circuit first.
        if (ctor.auditCommentRequired && !comment) {
          throw new E_AUDIT_COMMENT_MISSING([ctor.resolveAuditableName(), 'deleted'])
        }

        try {
          await model.$writeAudit({
            event: 'deleted',
            oldValues: final,
            newValues: null,
            tags: ['mutation'],
            auditComment: comment,
          })
        } finally {
          delete (model as any).auditComment
        }
      }
    }
    return ModelWithAudit
  }
}
