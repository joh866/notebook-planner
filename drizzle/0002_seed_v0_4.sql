-- Data migration: applies the spec v0.4 seed changes (§16) to a database seeded with v0.3.
-- Rows are matched by seed id, and each change only applies when the row still has its v0.3 values,
-- so anything the user created or changed is left alone. On an empty database this does nothing,
-- so `npm run seed` still fills it.
CREATE TEMP TABLE `_v04` AS SELECT
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'gratitude' AND `duration_minutes` = 15) AS `gratitude_ok`,
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'dorm' AND `duration_minutes` = 60) AS `dorm_ok`,
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'laundry' AND `title` = 'Laundry' AND `duration_minutes` = 60)
		AND NOT EXISTS (SELECT 1 FROM `routine_steps` WHERE `routine_id` = 'laundry') AS `laundry_ok`,
	(SELECT COUNT(*) FROM `task_steps` WHERE `task_id` = 'shopping') = 3
		AND (SELECT COUNT(*) FROM `task_steps` WHERE `task_id` = 'shopping' AND `done` = 0 AND (
			(`id` = 'shopping-step-1' AND `title` = 'Small towels for gym and bathroom') OR
			(`id` = 'shopping-step-2' AND `title` = 'Razor') OR
			(`id` = 'shopping-step-3' AND `title` = 'Shower mat (ask roommates about cost and who buys)'))) = 3 AS `shopping_ok`,
	EXISTS (SELECT 1 FROM `tasks` WHERE `id` = 'epiphany' AND `title` = 'Go through the Epiphany ML project'
		AND `meta` = 'Understand it, then maybe build on it' AND `window` = 'ongoing' AND `done_at` IS NULL) AS `epiphany_ok`,
	EXISTS (SELECT 1 FROM `tasks` WHERE `id` = 'epiphany')
		AND NOT EXISTS (SELECT 1 FROM `tasks` WHERE `id` = 'epiphany-build') AS `decision_ok`;
--> statement-breakpoint
UPDATE `routines` SET `duration_minutes` = 5 WHERE `id` = 'gratitude' AND (SELECT `gratitude_ok` FROM `_v04`);
--> statement-breakpoint
UPDATE `routines` SET `duration_minutes` = 30 WHERE `id` = 'dorm' AND (SELECT `dorm_ok` FROM `_v04`);
--> statement-breakpoint
UPDATE `routines` SET `duration_minutes` = 140 WHERE `id` = 'laundry' AND (SELECT `laundry_ok` FROM `_v04`);
--> statement-breakpoint
INSERT INTO `routine_steps` (`id`, `routine_id`, `title`, `minutes`, `waiting`, `sort_order`)
	SELECT * FROM (VALUES
		('laundry-step-1', 'laundry', 'Load the washer', 10, 0, 0),
		('laundry-step-2', 'laundry', 'Washing', 55, 1, 1),
		('laundry-step-3', 'laundry', 'Move to the dryer', 5, 0, 2),
		('laundry-step-4', 'laundry', 'Drying', 55, 1, 3),
		('laundry-step-5', 'laundry', 'Fold and put away', 15, 0, 4))
	WHERE (SELECT `laundry_ok` FROM `_v04`);
--> statement-breakpoint
UPDATE `task_steps` SET `title` = CASE `id`
		WHEN 'shopping-step-1' THEN 'Ask roommates about the shower mat (cost, which one, who buys)'
		WHEN 'shopping-step-2' THEN 'Small towels for the gym and bathroom'
		WHEN 'shopping-step-3' THEN 'Razor' END
	WHERE `task_id` = 'shopping' AND (SELECT `shopping_ok` FROM `_v04`);
--> statement-breakpoint
INSERT INTO `task_steps` (`id`, `task_id`, `title`, `sort_order`)
	SELECT 'shopping-step-4', 'shopping', 'Shower mat', 3 WHERE (SELECT `shopping_ok` FROM `_v04`);
--> statement-breakpoint
UPDATE `tasks` SET `title` = 'Go through the Epiphany ML project and understand it', `meta` = NULL, `window` = 'week'
	WHERE `id` = 'epiphany' AND (SELECT `epiphany_ok` FROM `_v04`);
--> statement-breakpoint
INSERT INTO `tasks` (`id`, `title`, `meta`, `category_id`, `window`, `decision_yes`, `sort_order`)
	SELECT 'epiphany-build', 'Build my own project based on Epiphany?', 'Decide after going through it.',
		(SELECT `id` FROM `categories` WHERE `id` = 'growth'), 'decide',
		'{"makeTask":{"title":"Build a project based on Epiphany","window":"soon"}}', 15
	WHERE (SELECT `decision_ok` FROM `_v04`);
--> statement-breakpoint
DROP TABLE `_v04`;
