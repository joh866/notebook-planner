CREATE TABLE `routine_step_checks` (
	`step_id` text NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`step_id`, `date`),
	FOREIGN KEY (`step_id`) REFERENCES `routine_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `routine_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`title` text NOT NULL,
	`minutes` integer,
	`waiting` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `task_steps` ADD `minutes` integer;--> statement-breakpoint
ALTER TABLE `task_steps` ADD `waiting` integer DEFAULT false NOT NULL;