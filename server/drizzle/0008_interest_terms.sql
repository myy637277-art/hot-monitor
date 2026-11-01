DROP TABLE `interests`;
--> statement-breakpoint
CREATE TABLE `interests` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`terms` text NOT NULL,
	`created_at` integer NOT NULL
);
