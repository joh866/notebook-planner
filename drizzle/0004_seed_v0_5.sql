-- Data migration: spec v0.5 conditions (§10, §16). Waiting is no longer a window: a task with a
-- check-in question keeps its own window and carries the question as an "if" condition. Seed rows
-- are matched by id and only change while they still have their v0.4 values. Anything the user made
-- that was waiting goes to Soon, where Yes on a check-in used to send it. On an empty database this
-- does nothing, so `npm run seed` still fills it.
UPDATE `conditions` SET `phrase` = CASE `id`
		WHEN 'cold' THEN 'once the cold is fully gone'
		WHEN 'arch' THEN 'if I get into ARCH'
		WHEN 'qnet' THEN 'once the QNet certificate arrives' END
	WHERE `phrase` IS NULL AND (
		(`id` = 'cold' AND `question` = 'Is the cold fully gone?') OR
		(`id` = 'arch' AND `question` = 'Did you get into ARCH?') OR
		(`id` = 'qnet' AND `question` = 'Has the QNet certificate arrived?'));
--> statement-breakpoint
UPDATE `tasks` SET `window` = 'week' WHERE `id` IN ('gym', 'boxing', 'arch-reading') AND `window` = 'waiting';
--> statement-breakpoint
UPDATE `tasks` SET `window` = 'soon' WHERE `window` = 'waiting';
--> statement-breakpoint
-- A question already answered Yes doesn't hold anything back.
UPDATE `tasks` SET `condition_id` = NULL
	WHERE `condition_id` IN (SELECT `id` FROM `conditions` WHERE `answered_at` IS NOT NULL);
--> statement-breakpoint
UPDATE `tasks` SET `after_task_id` = 'get-book'
	WHERE `id` = 'muqaddimah' AND `after_task_id` IS NULL AND `after_block_id` IS NULL
		AND EXISTS (SELECT 1 FROM `tasks` WHERE `id` = 'get-book');
--> statement-breakpoint
UPDATE `tasks` SET `after_task_id` = 'muqaddimah'
	WHERE `id` = 'response' AND `after_task_id` IS NULL AND `after_block_id` IS NULL
		AND EXISTS (SELECT 1 FROM `tasks` WHERE `id` = 'muqaddimah');
