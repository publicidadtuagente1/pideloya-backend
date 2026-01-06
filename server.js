const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// ===== DB (Supabase Postgres) =====
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }, // importante para Supabase
});

// ===== Helpers =====
async function ensureTables() {
  // Crea tablas mínimas si no existen (MVP)
  await pool.query(`
    create table if not exists settings (
      key text primary key,
      value text not null
    );
  `);

  // defaults
  await pool.query(`
    insert into settings (key, value) values
      ('exchange_rate', '0'),
      ('delivery_config', '{"base_fee":1,"per_km_fee":0.25,"free_km":2,"max_fee":3}')
    on conflict (key) do nothing;
  `);

  await pool.query(`
    create table if not exists merchants (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      category text not null, -- restaurant | store
      has_own_delivery boolean default false,
      is_active boolean default true,
      lat double precision,
      lng double precision,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists products (
      id uuid primary key default gen_random_uuid(),
      merchant_id uuid not null references merchants(id) on delete cascade,
      name text not null,
      price_usd numeric(10,2) not null,
      is_available boolean default true,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists orders (
      id uuid primary key default gen_random_uuid(),
      user_phone text not null,
      merchant_id uuid not null references merchants(id),
      status text not null default 'created',
      payment_method text not null,
      subtotal_usd numeric(10,2) not null,
      delivery_fee_usd numeric(10,2) not null,
      total_usd numeric(10,2) not null,
      exchange_rate_bs_per_usd numeric(12,2) not null default 0,
      total_bs_reference numeric(14,2),
      delivery_lat double precision not null,
      delivery_lng double precision not null,
      notes text,
      created_at timestamptz default now()
    );
  `);
}

// ===== Routes =====
app.get("/health", async (req, res) => {
  try {
    await pool.query("select 1 as ok");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/settings", async (req, res) => {
  const ex = await pool.query(`select value from settings where key='exchange_rate'`);
  const dc = await pool.query(`select value from settings where key='delivery_config'`);
  res.json({
    exchange_rate: Number(ex.rows?.[0]?.value || 0),
    delivery_config: JSON.parse(dc.rows?.[0]?.value || "{}"),
  });
});

app.put("/settings/exchange-rate", async (req, res) => {
  const rate = Number(req.body?.rate);
  if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: "Invalid rate" });

  await pool.query(`update settings set value=$1 where key='exchange_rate'`, [String(rate)]);
  res.json({ ok: true, exchange_rate: rate });
});

app.put("/settings/delivery", async (req, res) => {
  const cfg = req.body || {};
  const payload = {
    base_fee: Number(cfg.base_fee ?? 1),
    per_km_fee: Number(cfg.per_km_fee ?? 0.25),
    free_km: Number(cfg.free_km ?? 2),
    max_fee: Number(cfg.max_fee ?? 3),
  };
  await pool.query(`update settings set value=$1 where key='delivery_config'`, [JSON.stringify(payload)]);
  res.json({ ok: true, delivery_config: payload });
});

app.get("/merchants", async (req, res) => {
  const { category } = req.query;
  const params = [];
  let where = "where is_active=true";
  if (category) {
    params.push(category);
    where += ` and category=$${params.length}`;
  }
  const r = await pool.query(`select * from merchants ${where} order by created_at desc`, params);
  res.json(r.rows);
});

// ===== Start =====
const port = Number(process.env.PORT || 3000);

(async () => {
  try {
    await ensureTables();
    app.listen(port, () => console.log(`PídeloYA API running on port ${port}`));
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
})();
