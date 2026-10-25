import {
  boolean,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Typed view of the tables for queries. The SQL files in db/migrations/ are the
// source of truth for the real structure (checks, triggers, indexes): a test
// (tests/db/catalogues.test.ts) fails if this file and the database disagree.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const governorates = pgTable('governorates', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  nameAr: text('name_ar').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const delegations = pgTable(
  'delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    governorateId: uuid('governorate_id')
      .notNull()
      .references(() => governorates.id),
    slug: text('slug').notNull(),
    nameFr: text('name_fr').notNull(),
    nameAr: text('name_ar'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [unique().on(table.governorateId, table.slug)],
);

export const levels = pgTable(
  'levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    cycle: text('cycle', {
      enum: ['primaire', 'preparatoire', 'secondaire', 'universite'],
    }).notNull(),
    grade: smallint('grade').notNull(),
    nameFr: text('name_fr').notNull(),
    nameAr: text('name_ar').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [unique().on(table.cycle, table.grade)],
);

export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  nameAr: text('name_ar').notNull(),
  status: text('status', { enum: ['approved', 'pending'] })
    .notNull()
    .default('approved'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

// Money is stored as integer millimes: 40.500 DT = 40500.
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  nameAr: text('name_ar').notNull(),
  durationDays: integer('duration_days').notNull(),
  priceVisibilityMillimes: integer('price_visibility_millimes').notNull(),
  priceWithDashboardMillimes: integer(
    'price_with_dashboard_millimes',
  ).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});
