-- Track how many times a task's due_date has been changed.
-- Used by the Executive Assistant add-on to detect procrastinated tasks.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;

-- Trigger: increment reschedule_count whenever due_date changes on an existing row
CREATE OR REPLACE FUNCTION increment_task_reschedule_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only fire on UPDATE (not INSERT), and only when due_date actually changed
  IF TG_OP = 'UPDATE' AND NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    -- Don't count the initial assignment (when old due_date was NULL)
    IF OLD.due_date IS NOT NULL THEN
      NEW.reschedule_count := COALESCE(OLD.reschedule_count, 0) + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_reschedule_count_trigger ON tasks;

CREATE TRIGGER task_reschedule_count_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION increment_task_reschedule_count();
