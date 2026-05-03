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

    this.schema.createTable('orders', (table) => {
      table.increments('id').notNullable()
      table.text('title').notNullable()
      table.text('stripe_intent').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('accounts', (table) => {
      table.increments('id').notNullable()
      table.text('name').notNullable()
      table.text('global_secret').nullable()
      table.text('local_secret').nullable()
      table.text('password').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('sessions', (table) => {
      table.increments('id').notNullable()
      table.text('label').notNullable()
      table.text('token').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('items', (table) => {
      table.increments('id').notNullable()
      table.text('label').notNullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('posts')
    this.schema.dropTable('users')
    this.schema.dropTable('orders')
    this.schema.dropTable('accounts')
    this.schema.dropTable('sessions')
    this.schema.dropTable('items')
  }
}
