ALTER TABLE `stories` ADD `home_source_count` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD `feed_badge` text;
--> statement-breakpoint
CREATE TABLE `digest_log` (
	`id` text PRIMARY KEY NOT NULL,
	`sent_at` integer NOT NULL,
	`mode` text NOT NULL,
	`reason` text NOT NULL,
	`count` integer NOT NULL,
	`http_status` integer
);
--> statement-breakpoint
CREATE TABLE `trusted_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_sources_kind_value` ON `trusted_sources` (`kind`,`value`);
