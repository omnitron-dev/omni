/** Read-only compatibility requirements for POSTGRES_MAIL_OUTBOX_SCHEMA.
 * Plain data: importing the PostgreSQL persistence entry does not load a driver,
 * database module, migration runner, or create a connection. */
export const POSTGRES_MAIL_OUTBOX_REQUIREMENTS = {
  name: 'titan-mailer.postgres-outbox',
  tables: {
    mail_outbox: {
      columns: {
        id: { type: 'int8', nullable: false, default: true },
        delivery_id: { type: 'uuid', nullable: false, default: true },
        recipient: { type: 'text', nullable: false },
        subject: { type: 'text', nullable: false },
        body: { type: 'text', nullable: false },
        html: { type: 'text', nullable: true },
        attempts: { type: 'int4', nullable: false, defaultExpression: '0' },
        next_attempt_at: { type: 'timestamptz', nullable: false, defaultExpression: 'now()' },
        created_at: { type: 'timestamptz', nullable: false, defaultExpression: 'now()' },
        expires_at: { type: 'timestamptz', nullable: true },
        last_error_kind: { type: 'text', nullable: true },
        failed_at: { type: 'timestamptz', nullable: true },
      },
      insert: true,
      unique: [['id'], ['delivery_id']],
    },
    mail_delivery_events: {
      columns: {
        delivery_id: { type: 'uuid', nullable: false },
        state: { type: 'text', nullable: false },
        attempts: { type: 'int4', nullable: false },
        error_kind: { type: 'text', nullable: true },
        updated_at: { type: 'timestamptz', nullable: false, defaultExpression: 'now()' },
      },
      insert: true,
      unique: [['delivery_id']],
    },
  },
} as const;
