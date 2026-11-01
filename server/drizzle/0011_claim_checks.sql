CREATE TABLE `claim_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`story_id` text NOT NULL,
	`status` text NOT NULL,
	`relevant` integer,
	`authentic` integer,
	`reason` text NOT NULL,
	`judged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_checks_owner` ON `claim_checks` (`kind`,`owner_id`,`story_id`);
