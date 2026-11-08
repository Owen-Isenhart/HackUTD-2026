-- Allow forwarded Gmail and Google Calendar email in the same message pipeline as texts. Safe to run again.
ALTER TABLE hackutd_finance.text_message DROP CONSTRAINT IF EXISTS text_message_platform_check;
ALTER TABLE hackutd_finance.text_message ADD CONSTRAINT text_message_platform_check CHECK (platform IN ('sms', 'imessage', 'email'));
