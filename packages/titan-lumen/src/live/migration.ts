import { createHash } from 'node:crypto';
import type { Migration } from '@omnitron-dev/titan-database/migration';
import type { LumenAuthoringDatabase } from './schema.js';

// An explicit schema contract supplies a stable digest. Runtime DI never applies DDL.
const contract = 'lumen-authoring-v1:documents(corpus:varchar128,path:varchar1024,revision:bigint,content:text,bytes:bigint,hash:varchar64,access:varchar128,updated:varchar32,author:varchar256,origin:varchar16,seed:varchar64);pk(corpus,path);revisions(same-without-origin-seed);pk(corpus,path,revision);fk(corpus,path)->documents(restrict);all-not-null';

export const lumenAuthoringMigration: Migration<LumenAuthoringDatabase> = {
  name: 'lumen_001_durable_authoring',
  checksum: createHash('sha256').update(contract).digest('hex'),
  async up(db) {
    await db.schema.createTable('lumen_documents')
      .addColumn('corpus', 'varchar(128)', column => column.notNull())
      .addColumn('path', 'varchar(1024)', column => column.notNull())
      .addColumn('revision', 'bigint', column => column.notNull())
      .addColumn('content', 'text', column => column.notNull())
      .addColumn('bytes', 'bigint', column => column.notNull())
      .addColumn('hash', 'varchar(64)', column => column.notNull())
      .addColumn('access', 'varchar(128)', column => column.notNull())
      .addColumn('updated', 'varchar(32)', column => column.notNull())
      .addColumn('author', 'varchar(256)', column => column.notNull())
      .addColumn('origin', 'varchar(16)', column => column.notNull())
      .addColumn('seed', 'varchar(64)', column => column.notNull())
      .addPrimaryKeyConstraint('lumen_documents_pk', ['corpus', 'path']).execute();
    await db.schema.createTable('lumen_document_revisions')
      .addColumn('corpus', 'varchar(128)', column => column.notNull())
      .addColumn('path', 'varchar(1024)', column => column.notNull())
      .addColumn('revision', 'bigint', column => column.notNull())
      .addColumn('content', 'text', column => column.notNull())
      .addColumn('bytes', 'bigint', column => column.notNull())
      .addColumn('hash', 'varchar(64)', column => column.notNull())
      .addColumn('access', 'varchar(128)', column => column.notNull())
      .addColumn('updated', 'varchar(32)', column => column.notNull())
      .addColumn('author', 'varchar(256)', column => column.notNull())
      .addPrimaryKeyConstraint('lumen_document_revisions_pk', ['corpus', 'path', 'revision'])
      .addForeignKeyConstraint('lumen_document_revisions_document_fk', ['corpus', 'path'], 'lumen_documents', ['corpus', 'path'], constraint => constraint.onDelete('restrict')).execute();
  },
  async down(db) {
    await db.schema.dropTable('lumen_document_revisions').execute();
    await db.schema.dropTable('lumen_documents').execute();
  },
};
