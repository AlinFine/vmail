-- Persistent mailbox ownership and password authentication
ALTER TABLE `mailboxes` ADD COLUMN `is_permanent` integer DEFAULT 0 NOT NULL;
ALTER TABLE `mailboxes` ADD COLUMN `password_hash` text;
ALTER TABLE `mailboxes` ADD COLUMN `password_salt` text;
ALTER TABLE `mailboxes` ADD COLUMN `verified_at` integer;

CREATE INDEX IF NOT EXISTS `idx_mailboxes_permanent`
ON `mailboxes` (`is_permanent`, `address`);
