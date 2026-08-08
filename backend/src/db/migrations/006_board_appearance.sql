-- MenuBoard 006 — Board appearance (color + photo)
--
-- Boards, Orders, Users screens in the Android app need a way to tell boards apart at a
-- glance beyond their name. `color` is a hex swatch (`#RRGGBB`) an admin picks per board in
-- the Admin Portal; `photo_path` is the storage path of an uploaded board photo, following
-- the same "path, not URL" convention as `users.avatar_path`. Both are optional — a board
-- with neither falls back to the app's existing deterministic per-board icon.

ALTER TABLE boards
  ADD COLUMN color       VARCHAR(7)   NULL AFTER description,
  ADD COLUMN photo_path  VARCHAR(500) NULL AFTER color;
