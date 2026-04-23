-- Sales Pipeline, Tasks, and Activities tables

-- Pipeline stages per customer
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL,
    stage TEXT NOT NULL DEFAULT 'Lead',
    notes TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follow-up tasks per customer
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'Pending',
    assigned_to TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity timeline per customer
CREATE TABLE IF NOT EXISTS activities (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    description TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Allow all for anon (matching existing pattern)
CREATE POLICY "Allow all for anon" ON pipeline_stages FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON tasks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON activities FOR ALL TO anon USING (true) WITH CHECK (true);
