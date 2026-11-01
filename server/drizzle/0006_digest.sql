CREATE TABLE `digest_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`hour` integer NOT NULL,
	`minute` integer NOT NULL,
	`include_home` integer DEFAULT 1 NOT NULL,
	`include_keywords` integer DEFAULT 0 NOT NULL,
	`last_sent_on` text,
	`last_status` text,
	`last_http_status` integer,
	`updated_at` integer NOT NULL
);
