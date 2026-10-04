-- Separate database for `npm test`, so tests never touch dev data.
CREATE DATABASE motion_test OWNER motion;
