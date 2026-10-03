CREATE TABLE `feed_items` (
	`uid` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`task_id` text,
	`snapshot` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `canvas_synced_at` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `canvas_note` text;