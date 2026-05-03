import type { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { ModelObject } from '@adonisjs/lucid/types/model'

const jsonColumn = {
  consume: (value: string | null) => (value ? JSON.parse(value) : null),
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

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
