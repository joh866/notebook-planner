CREATE TABLE `google_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`refresh_token` text,
	`email` text,
	`write_back` integer DEFAULT false NOT NULL,
	`planner_calendar_id` text,
	`synced_at` text,
	`note` text,
	`connected_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`on` integer DEFAULT false NOT NULL,
	`primary` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_events` (
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`link` text,
	`busy` integer DEFAULT true NOT NULL,
	`start_at` text,
	`end_at` text,
	`start_date` text,
	`end_date` text,
	PRIMARY KEY(`calendar_id`, `event_id`),
	FOREIGN KEY (`calendar_id`) REFERENCES `google_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `google_pushed` (
	`block_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`sent` text NOT NULL
);
