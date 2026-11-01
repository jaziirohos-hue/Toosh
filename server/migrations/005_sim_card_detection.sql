-- Toosh 005: SIM cards detected on a phone. Additive only (new nullable columns).
-- Which phone and SIM slot a record came from, so the same SIM is not offered twice and its EVC number can be
-- linked to the right SIM. Nothing here controls the real SIM.
ALTER TABLE sim_cards ADD COLUMN sim_slot integer CHECK (sim_slot IS NULL OR sim_slot BETWEEN 0 AND 7);
ALTER TABLE sim_cards ADD COLUMN sim_subscription_id integer CHECK (sim_subscription_id IS NULL OR sim_subscription_id >= 0);
ALTER TABLE sim_cards ADD COLUMN detected_device_id uuid;
