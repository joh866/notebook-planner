CREATE TABLE `task_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `blocks` ADD `session_id` text REFERENCES task_sessions(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tasks` ADD `est_edited_at` text;