ALTER TABLE `stories` ADD `summary_zh` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD `relevant` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD `hotness` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD `credibility` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD `credibility_reason` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD `ai_mode` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD `scored_at` integer;
--> statement-breakpoint
CREATE TABLE `ai_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domain_reputation` (
	`domain` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`score` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `x_account_reputation` (
	`handle` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL
);
