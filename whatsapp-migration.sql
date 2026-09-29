-- WhatsApp module tables
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS whatsapp_blasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message TEXT NOT NULL,
    attachment JSONB,
    sender TEXT,
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    read_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','completed','failed','cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_blast_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blast_id UUID NOT NULL REFERENCES whatsapp_blasts(id) ON DELETE CASCADE,
    acct_no TEXT,
    clinic_name TEXT,
    contact_name TEXT,
    product_type TEXT,
    phone_raw TEXT,
    phone_wa TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','read','failed','skipped')),
    error TEXT,
    wa_message_id TEXT,
    sent_at TIMESTAMPTZ,
    ack_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_blast_recipients_blast ON whatsapp_blast_recipients(blast_id);
CREATE INDEX IF NOT EXISTS idx_wa_blast_recipients_msg ON whatsapp_blast_recipients(wa_message_id);

ALTER TABLE whatsapp_blasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_blast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON whatsapp_blasts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON whatsapp_blast_recipients FOR ALL TO anon USING (true) WITH CHECK (true);
