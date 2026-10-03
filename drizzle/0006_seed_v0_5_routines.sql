-- Data migration: spec v0.5 routines (§10 "Routine steps", §16). Meditate and Gratitude become steps
-- of the morning routine, and their check history moves onto those steps, so gratitude keeps its
-- streak. The night routine gets its steps, and Supplements is added. Each change only applies
-- while the seed rows are as the seed left them. On an empty database this does nothing, so
-- `npm run seed` still fills it.
CREATE TEMP TABLE `_v05r` AS SELECT
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'morning')
		AND NOT EXISTS (SELECT 1 FROM `routine_steps` WHERE `routine_id` = 'morning') AS `morning_ok`,
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'meditate' AND `title` = 'Meditate 10 min') AS `meditate_ok`,
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'gratitude' AND `title` = 'Gratitude, 5 things') AS `gratitude_ok`,
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'night')
		AND NOT EXISTS (SELECT 1 FROM `routine_steps` WHERE `routine_id` = 'night') AS `night_ok`,
	EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'night')
		AND NOT EXISTS (SELECT 1 FROM `routines` WHERE `id` = 'supplements') AS `supplements_ok`;
--> statement-breakpoint
INSERT INTO `routine_steps` (`id`, `routine_id`, `title`, `minutes`, `waiting`, `show_streak`, `sort_order`)
	SELECT * FROM (VALUES
		('morning-step-1', 'morning', 'Brush teeth', NULL, 0, 0, 0),
		('morning-step-2', 'morning', 'Shower', NULL, 0, 0, 1),
		('morning-step-3', 'morning', 'Breakfast', NULL, 0, 0, 2),
		('morning-step-4', 'morning', 'Get dressed', NULL, 0, 0, 3))
	WHERE (SELECT `morning_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routine_steps` (`id`, `routine_id`, `title`, `minutes`, `waiting`, `show_streak`, `sort_order`)
	SELECT 'morning-step-5', 'morning', 'Meditate',
		COALESCE((SELECT `duration_minutes` FROM `routines` WHERE `id` = 'meditate' AND (SELECT `meditate_ok` FROM `_v05r`)), 10), 0,
		COALESCE((SELECT `show_streak` FROM `routines` WHERE `id` = 'meditate' AND (SELECT `meditate_ok` FROM `_v05r`)), 0), 4
	WHERE (SELECT `morning_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routine_steps` (`id`, `routine_id`, `title`, `minutes`, `waiting`, `show_streak`, `sort_order`)
	SELECT 'morning-step-6', 'morning', 'Gratitude journal, 5 things',
		COALESCE((SELECT `duration_minutes` FROM `routines` WHERE `id` = 'gratitude' AND (SELECT `gratitude_ok` FROM `_v05r`)), 5), 0,
		COALESCE((SELECT `show_streak` FROM `routines` WHERE `id` = 'gratitude' AND (SELECT `gratitude_ok` FROM `_v05r`)), 1), 5
	WHERE (SELECT `morning_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routine_step_checks` (`step_id`, `date`)
	SELECT 'morning-step-5', `date` FROM `routine_checks`
	WHERE `routine_id` = 'meditate' AND (SELECT `morning_ok` AND `meditate_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routine_step_checks` (`step_id`, `date`)
	SELECT 'morning-step-6', `date` FROM `routine_checks`
	WHERE `routine_id` = 'gratitude' AND (SELECT `morning_ok` AND `gratitude_ok` FROM `_v05r`);
--> statement-breakpoint
DELETE FROM `routine_slot_exceptions` WHERE `slot_id` IN (
	SELECT `id` FROM `routine_slots` WHERE
		(`routine_id` = 'meditate' AND (SELECT `morning_ok` AND `meditate_ok` FROM `_v05r`)) OR
		(`routine_id` = 'gratitude' AND (SELECT `morning_ok` AND `gratitude_ok` FROM `_v05r`)));
--> statement-breakpoint
DELETE FROM `routine_slots` WHERE
	(`routine_id` = 'meditate' AND (SELECT `morning_ok` AND `meditate_ok` FROM `_v05r`)) OR
	(`routine_id` = 'gratitude' AND (SELECT `morning_ok` AND `gratitude_ok` FROM `_v05r`));
--> statement-breakpoint
DELETE FROM `routine_checks` WHERE
	(`routine_id` = 'meditate' AND (SELECT `morning_ok` AND `meditate_ok` FROM `_v05r`)) OR
	(`routine_id` = 'gratitude' AND (SELECT `morning_ok` AND `gratitude_ok` FROM `_v05r`));
--> statement-breakpoint
DELETE FROM `routines` WHERE
	(`id` = 'meditate' AND (SELECT `morning_ok` AND `meditate_ok` FROM `_v05r`)) OR
	(`id` = 'gratitude' AND (SELECT `morning_ok` AND `gratitude_ok` FROM `_v05r`));
--> statement-breakpoint
UPDATE `routines` SET `title` = 'Night routine'
	WHERE `id` = 'night' AND `title` = 'Night routine and journal' AND (SELECT `night_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routine_steps` (`id`, `routine_id`, `title`, `minutes`, `waiting`, `show_streak`, `sort_order`)
	SELECT * FROM (VALUES
		('night-step-1', 'night', 'Journal', NULL, 0, 0, 0),
		('night-step-2', 'night', 'Brush teeth', NULL, 0, 0, 1),
		('night-step-3', 'night', 'Change', NULL, 0, 0, 2),
		('night-step-4', 'night', 'Read', NULL, 0, 0, 3),
		('night-step-5', 'night', 'Put electronics away', NULL, 0, 0, 4))
	WHERE (SELECT `night_ok` FROM `_v05r`);
--> statement-breakpoint
-- Supplements goes right after the night routine in the checklist.
UPDATE `routines` SET `sort_order` = `sort_order` + 1
	WHERE `sort_order` > (SELECT `sort_order` FROM `routines` WHERE `id` = 'night') AND (SELECT `supplements_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routines` (`id`, `title`, `category_id`, `duration_minutes`, `repeat`, `repeat_every`, `show_streak`, `sort_order`)
	SELECT 'supplements', 'Supplements', (SELECT `id` FROM `categories` WHERE `id` = 'routine'), 5, 'daily', 1, 0,
		(SELECT `sort_order` FROM `routines` WHERE `id` = 'night') + 1
	WHERE (SELECT `supplements_ok` FROM `_v05r`);
--> statement-breakpoint
INSERT INTO `routine_steps` (`id`, `routine_id`, `title`, `minutes`, `waiting`, `show_streak`, `sort_order`)
	SELECT * FROM (VALUES
		('supplements-step-1', 'supplements', 'Creatine', NULL, 0, 0, 0),
		('supplements-step-2', 'supplements', 'Mystery powder', NULL, 0, 0, 1))
	WHERE (SELECT `supplements_ok` FROM `_v05r`);
--> statement-breakpoint
DROP TABLE `_v05r`;
