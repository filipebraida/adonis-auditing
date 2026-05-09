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
import type { AuditCustomPayload, AuditingService } from '../types.js'
import type { NormalizeConstructor } from '../utils/normalized_constructor.js'
import Audit from '../audit.js'

export function withAuditable() {
  return <T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) => {
    class ModelWithAudit extends superclass {
      static auditableName?: string
      static auditExclude: string[] = []
      static auditInclude: string[] = []
      static auditMask: string[] = []

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
        await this.$writeAudit({
          event,
          oldValues: payload.old ?? null,
          newValues: payload.new ?? null,
          tags: payload.tags ?? null,
          metadata: payload.metadata,
        })
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
      }) {
        await ModelWithAudit.#lazyServices()
        if (this.$isAuditDisabled || ModelWithAudit.#auditing!.isDisabled()) return

        const user = await ModelWithAudit.#auditing!.getUserForContext()
        const ctxMeta = await ModelWithAudit.#auditing!.getMetadataForContext()
        const tenantFromCtx = await ModelWithAudit.#auditing!.getTenantForContext()

        const ctor = this.constructor as typeof ModelWithAudit
        const masked = new Set<string>([
          ...ModelWithAudit.#auditing!.getHiddenFields(),
          ...ctor.auditMask,
        ])
        const maskValues = (obj: Record<string, unknown> | null) => {
          if (!obj || masked.size === 0) return obj
          const out: Record<string, unknown> = {}
          for (const k of Object.keys(obj)) {
            out[k] = masked.has(k) ? '******' : obj[k]
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
        const ctor = model.constructor as typeof ModelWithAudit
        const filtered = ctor.filterAuditAttributes(model.$attributes)
        const final = await model.$applyGlobalExclude(filtered)
        if (Object.keys(final).length === 0) return
        await model.$writeAudit({
          event: 'created',
          oldValues: null,
          newValues: final,
          tags: ['mutation'],
        })
      }

      @beforeUpdate()
      static async __auditBeforeUpdate(model: ModelWithAudit) {
        model.$backupAuditValues()
      }

      @afterUpdate()
      static async __auditAfterUpdate(model: ModelWithAudit) {
        const ctor = model.constructor as typeof ModelWithAudit
        const dirtyKeys = model.$auditDirtyKeys
        if (dirtyKeys.length === 0) return

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

        await model.$writeAudit({
          event: 'updated',
          oldValues: oldFinal,
          newValues: newFinal,
          tags: ['mutation'],
        })
      }

      @beforeDelete()
      static async __auditBeforeDelete(model: ModelWithAudit) {
        model.$backupAuditValues()
      }

      @afterDelete()
      static async __auditAfterDelete(model: ModelWithAudit) {
        const ctor = model.constructor as typeof ModelWithAudit
        const filtered = ctor.filterAuditAttributes(model.$auditValuesToSave)
        const final = await model.$applyGlobalExclude(filtered)
        if (Object.keys(final).length === 0) return
        await model.$writeAudit({
          event: 'deleted',
          oldValues: final,
          newValues: null,
          tags: ['mutation'],
        })
      }
    }
    return ModelWithAudit
  }
}
