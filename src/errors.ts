import { createError } from '@poppinss/utils'

export const E_AUDIT_COMMENT_MISSING = createError<[string, string]>(
  'adonis-auditing: %s requires an audit comment for %s events. Set model.auditComment before save.',
  'E_AUDIT_COMMENT_MISSING',
  400
)
