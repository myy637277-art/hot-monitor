CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_pause` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`last_error` text,
	`last_error_at` integer,
	`last_status` text
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`published_at` integer,
	`simhash` text,
	`embedding` blob,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_dedupe_idx` ON `items` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `items_fetched_idx` ON `items` (`fetched_at`);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stories_updated_idx` ON `stories` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `story_items` (
	`story_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`story_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `story_items_item_idx` ON `story_items` (`item_id`);
--> statement-breakpoint
CREATE TABLE `fetch_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crawl_budget` (
	`source_id` text NOT NULL,
	`day` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`paused_until` integer,
	`pause_reason` text,
	PRIMARY KEY(`source_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `search_state` (
	`id` text PRIMARY KEY NOT NULL,
	`last_request_at` integer
);
--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`day` text NOT NULL,
	`source_id` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`items` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `source_id`)
);
