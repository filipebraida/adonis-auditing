import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('tenanted_widgets', (table) => {
      table.increments('id').notNullable()
      table.text('name').notNullable()
      table.text('tenant_id').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('tenanted_widgets')
  }
}
