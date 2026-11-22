-- Replace the project-owned schema in one transaction during rebuild.
DROP SCHEMA IF EXISTS retail CASCADE;
CREATE SCHEMA retail;
SET search_path = retail, public;

CREATE TABLE raw_line (
    source_sheet text NOT NULL,
    source_row integer NOT NULL CHECK (source_row > 1),
    invoice text NOT NULL,
    stock_code text NOT NULL,
    description text,
    quantity integer NOT NULL,
    invoice_at timestamp NOT NULL,
    source_price numeric NOT NULL,
    customer_id text,
    country text NOT NULL,
    excel_date_serial numeric NOT NULL,
    PRIMARY KEY (source_sheet, source_row)
);
\copy raw_line FROM '.build/raw.csv' WITH (FORMAT csv)
ANALYZE raw_line;
