CREATE TABLE `watches` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`since` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`story_id` text NOT NULL,
	`keyword` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`channel` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_watch_story_idx` ON `notifications` (`watch_id`,`story_id`);
