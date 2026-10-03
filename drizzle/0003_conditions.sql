ALTER TABLE `blocks` ADD `condition_id` text REFERENCES conditions(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `blocks` ADD `after_task_id` text REFERENCES tasks(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `blocks` ADD `after_block_id` text REFERENCES blocks(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `conditions` ADD `phrase` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `after_task_id` text REFERENCES tasks(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tasks` ADD `after_block_id` text REFERENCES blocks(id) ON UPDATE no action ON DELETE set null;