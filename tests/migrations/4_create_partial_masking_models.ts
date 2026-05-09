import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('cards', (table) => {
      table.increments('id').notNullable()
      table.text('label').notNullable()
      table.text('credit_card').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('tokens', (table) => {
      table.increments('id').notNullable()
      table.text('label').notNullable()
      table.text('code').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('profiles', (table) => {
      table.increments('id').notNullable()
      table.text('name').notNullable()
      table.text('phone').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('services', (table) => {
      table.increments('id').notNullable()
      table.text('name').notNullable()
      table.text('api_key').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('pins', (table) => {
      table.increments('id').notNullable()
      table.text('label').notNullable()
      table.text('code').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    // Doc table for global hiddenFields backwards-compat test (its own
    // distinct table so it doesn't clash with the existing `docs` schema).
    this.schema.createTable('mask_docs', (table) => {
      table.increments('id').notNullable()
      table.text('title').notNullable()
      table.text('secret').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })

    // Generic "user-like" record for the `true` shorthand test.
    this.schema.createTable('mask_users', (table) => {
      table.increments('id').notNullable()
      table.text('name').notNullable()
      table.text('password').nullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('cards')
    this.schema.dropTable('tokens')
    this.schema.dropTable('profiles')
    this.schema.dropTable('services')
    this.schema.dropTable('pins')
    this.schema.dropTable('mask_docs')
    this.schema.dropTable('mask_users')
  }
}
