-- Toosh 006: Somnet is a network choice for SIM card records. Widens the allowed values only; no row changes.
ALTER TABLE sim_cards DROP CONSTRAINT IF EXISTS sim_cards_provider_check;
ALTER TABLE sim_cards ADD CONSTRAINT sim_cards_provider_check CHECK (provider IN ('HORMUUD', 'SOMTEL', 'SOMNET', 'GOLIS', 'OTHER'));
