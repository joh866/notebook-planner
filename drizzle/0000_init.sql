CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`category_id` text,
	`task_id` text,
	`start_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`tentative` integer DEFAULT false NOT NULL,
	`label` text,
	`location` text,
	`pinned` integer DEFAULT true NOT NULL,
	`reason` text,
	`rolled_from` text,
	`done` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`builtin` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `class_skips` (
	`class_id` text NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`class_id`, `date`),
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`full_name` text,
	`days` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`time_zone` text DEFAULT 'America/Chicago' NOT NULL,
	`location` text,
	`category_id` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`snoozed_until` text,
	`answered_at` text
);
--> statement-breakpoint
CREATE TABLE `routine_checks` (
	`routine_id` text NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`routine_id`, `date`),
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `routine_slot_exceptions` (
	`slot_id` text NOT NULL,
	`date` text NOT NULL,
	`skipped` integer DEFAULT false NOT NULL,
	`start` text,
	`duration_minutes` integer,
	PRIMARY KEY(`slot_id`, `date`),
	FOREIGN KEY (`slot_id`) REFERENCES `routine_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `routine_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`start` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category_id` text,
	`duration_minutes` integer NOT NULL,
	`repeat` text NOT NULL,
	`repeat_days` text,
	`repeat_every` integer DEFAULT 1 NOT NULL,
	`repeat_from` text,
	`show_streak` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`wake_time` text DEFAULT '09:00' NOT NULL,
	`bed_time` text DEFAULT '00:00' NOT NULL,
	`look` text DEFAULT 'auto' NOT NULL,
	`time_zone` text DEFAULT 'auto' NOT NULL,
	`home_time_zone` text DEFAULT 'America/Chicago' NOT NULL,
	`auto_schedule` integer DEFAULT false NOT NULL,
	`week_start` integer DEFAULT 0 NOT NULL,
	`notify` text NOT NULL,
	`canvas_feed_url` text
);
--> statement-breakpoint
CREATE TABLE `sometime` (
	`task_id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`rolled_from` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`meta` text,
	`notes` text,
	`category_id` text,
	`window` text NOT NULL,
	`due_at` text,
	`due_date` text,
	`short_name` text,
	`est_low` integer,
	`est_high` integer,
	`sitting_minutes` integer,
	`session_minutes` integer,
	`condition_id` text,
	`decision_yes` text,
	`done_at` text,
	`duration_feedback` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`condition_id`) REFERENCES `conditions`(`id`) ON UPDATE no action ON DELETE set null
);
