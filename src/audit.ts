import type { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { ModelObject } from '@adonisjs/lucid/types/model'

const jsonColumn = {
  consume: (value: unknown) => {
    if (value === null || value === undefined) return null
    return typeof value === 'string' ? JSON.parse(value) : value
  },
  prepare: (value: unknown) => (value ? JSON.stringify(value) : null),
  serialize: (value: unknown) => (value ? value : null),
}

export default class Audit extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userType: string | null

  @column()
  declare userId: string | null

  @column()
  declare event: string

  @column()
  declare auditableType: string

  @column()
  declare auditableId: number

  @column(jsonColumn)
  declare oldValues: ModelObject | null

  @column(jsonColumn)
  declare newValues: ModelObject | null

  @column(jsonColumn)
  declare tags: string[] | null

  @column(jsonColumn)
  declare metadata: ModelObject | null

  @column()
  declare tenantId: string | null

  @column()
  declare auditComment: string | null

  @column()
  declare requestId: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  changes(): Record<string, { old: any; new: any }> {
    const old = this.oldValues ?? {}
    const next = this.newValues ?? {}
    const fields = new Set([...Object.keys(old), ...Object.keys(next)])
    const result: Record<string, { old: any; new: any }> = {}
    for (const f of fields) {
      result[f] = { old: old[f], new: next[f] }
    }
    return result
  }

  changesFor(field: string): { old: any; new: any } | undefined {
    return this.changes()[field]
  }

  changedFields(): string[] {
    return Object.keys(this.changes())
  }

  changesDisplay(opts?: { labels?: Record<string, string>; separator?: string }): string {
    const sep = opts?.separator ?? ' → '
    const labels = opts?.labels ?? {}
    return Object.entries(this.changes())
      .map(([f, { old, new: n }]) => {
        const label = labels[f] ?? f
        const oldStr = old === undefined ? 'undefined' : JSON.stringify(old)
        const newStr = n === undefined ? 'undefined' : JSON.stringify(n)
        return `${label}: ${oldStr}${sep}${newStr}`
      })
      .join('\n')
  }

  maskedFields(): string[] {
    const next = this.newValues ?? {}
    return Object.entries(next)
      .filter(([, v]) => v === '******')
      .map(([k]) => k)
  }

  hasMaskedFields(): boolean {
    return this.maskedFields().length > 0
  }
}
