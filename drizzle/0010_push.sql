CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`zone` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sent_notifications` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` text NOT NULL
);
