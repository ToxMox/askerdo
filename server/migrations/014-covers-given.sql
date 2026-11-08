-- whether a cover came from a list given by hand (review covers with tasks, 1) or the
-- default a review took (0): a given list reads only its tasks. NULL is a row from before the flag.
ALTER TABLE covers ADD COLUMN given INTEGER;
