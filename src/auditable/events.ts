import type Audit from '../audit.js'

declare module '@adonisjs/core/types' {
  interface EventsList {
    'audit:created': { audit: Audit }
  }
}

export {}
