-- Renames the user_verification_enum value 'verified' to 'approved'.
-- Existing rows using 'verified' are automatically updated to 'approved'.
ALTER TYPE user_verification_enum RENAME VALUE 'verified' TO 'approved';
