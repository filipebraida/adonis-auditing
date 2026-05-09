import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'

export default class AuditPrune extends BaseCommand {
  static commandName = 'audit:prune'
  static description = 'Prune audit log rows by age and/or per-record retention'
  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({
    description: 'Delete audits older than N days',
    alias: 'd',
  })
  declare days?: number

  @flags.number({
    description:
      'Per (auditableType, auditableId) group, keep only the N most recent audits and delete the rest',
    alias: 'k',
  })
  declare keep?: number

  @flags.string({
    description: 'Restrict pruning to a single auditableType (model name)',
    alias: 'm',
  })
  declare model?: string

  @flags.boolean({
    description: 'Show how many rows would be deleted without actually deleting them',
  })
  declare dryRun?: boolean

  async run() {
    if (this.days === undefined && this.keep === undefined) {
      this.logger.error(
        'audit:prune requires at least one of --days or --keep. See `node ace audit:prune --help`.'
      )
      this.exitCode = 1
      return
    }

    if (this.days !== undefined && (!Number.isFinite(this.days) || this.days < 0)) {
      this.logger.error('--days must be a non-negative number.')
      this.exitCode = 1
      return
    }

    if (this.keep !== undefined && (!Number.isFinite(this.keep) || this.keep < 0)) {
      this.logger.error('--keep must be a non-negative number.')
      this.exitCode = 1
      return
    }

    const dryRun = this.dryRun === true
    const { default: Audit } = await import('../src/audit.js')
    const db = await this.app.container.make('lucid.db')

    let totalAffected = 0

    if (this.days !== undefined) {
      const dialect = db.connection().dialect
      const cutoffString = DateTime.now()
        .minus({ days: this.days })
        .toFormat((dialect as { dateTimeFormat: string }).dateTimeFormat)

      const builder = Audit.query().where('createdAt', '<', cutoffString)
      if (this.model) builder.where('auditableType', this.model)

      if (dryRun) {
        const result = await builder.clone().count('* as cnt')
        const row = result[0] as any
        const cnt = Number(row.$extras?.cnt ?? row.cnt ?? 0)
        totalAffected += cnt
      } else {
        const deleted = await builder.delete()
        totalAffected += Number(Array.isArray(deleted) ? deleted[0] : deleted) || 0
      }
    }

    if (this.keep !== undefined) {
      const connection = db.connection()
      const knex = connection.getWriteClient()
      const subQuery = knex('audits')
        .select('id')
        .select(
          knex.raw(
            'ROW_NUMBER() OVER (PARTITION BY auditable_type, auditable_id ORDER BY created_at DESC, id DESC) AS rn'
          )
        )
      if (this.model) subQuery.where('auditable_type', this.model)

      const wrapped = knex.select('id').from(subQuery.as('ranked')).where('rn', '>', this.keep)

      if (dryRun) {
        const rows = await wrapped
        totalAffected += rows.length
      } else {
        const rows = await wrapped
        const ids = rows.map((row: { id: number }) => row.id)
        if (ids.length > 0) {
          const deleted = await knex('audits').whereIn('id', ids).delete()
          totalAffected += Number(deleted) || 0
        }
      }
    }

    const parts: string[] = []
    if (this.days !== undefined) parts.push(`days=${this.days}`)
    if (this.keep !== undefined) parts.push(`keep=${this.keep}`)
    if (this.model) parts.push(`model=${this.model}`)
    if (dryRun) parts.push('dry-run')
    const suffix = parts.length ? ` (${parts.join(', ')})` : ''

    if (dryRun) {
      this.logger.info(`Would prune ${totalAffected} audit row(s)${suffix}`)
    } else {
      this.logger.success(`Pruned ${totalAffected} audit row(s)${suffix}`)
    }
  }
}
