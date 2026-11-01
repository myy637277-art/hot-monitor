CREATE TABLE `job_runs` (
	`name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
