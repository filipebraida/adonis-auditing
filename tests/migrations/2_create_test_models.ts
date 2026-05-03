import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('posts', (table) => {
      table.increments('id').notNullable()
      table.text('title').notNullable()
      table.text('body').nullable()
      table.text('status').notNullable().defaultTo('draft')
      table.text('secret').nullable()
      table.integer('view_count').notNullable().defaultTo(0)
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('users', (table) => {
      table.increments('id').notNullable()
      table.text('email').notNullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('posts')
    this.schema.dropTable('users')
  }
}
