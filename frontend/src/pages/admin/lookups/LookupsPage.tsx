// Three lookup masters as tabs on one page. Super_admin-only writes; everyone
// else 403s on POST/PUT (so the form is hidden for non-super-admins).

import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Paper, Stack, Tab, Tabs, TextField,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import PageHeader from '@/components/PageHeader';
import { lookupsApi } from '@/api/lookups.api';
import type { Currency, Locale, Timezone } from '@/types';

export default function LookupsPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <PageHeader title="Lookups" subtitle="Currencies, timezones, and locales" />
      <Paper>
        <Tabs value={tab} onChange={(_, v) => setTab(v as number)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Currencies" />
          <Tab label="Timezones" />
          <Tab label="Locales" />
        </Tabs>
        <Box sx={{ p: 3 }}>
          {tab === 0 && <CurrenciesTab />}
          {tab === 1 && <TimezonesTab />}
          {tab === 2 && <LocalesTab />}
        </Box>
      </Paper>
    </Box>
  );
}

// ---- Currencies ----------------------------------------------------------

function CurrenciesTab() {
  const [rows, setRows] = useState<Currency[]>([]);
  const [form, setForm] = useState<Partial<Currency>>({ decimals: 2 });
  const [error, setError] = useState<string | null>(null);

  async function load() { const r = await lookupsApi.currencies(); setRows(r.data || []); }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await lookupsApi.createCurrency(form);
      setForm({ decimals: 2 });
      await load();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    }
  }

  return (
    <Stack spacing={3}>
      <form onSubmit={save}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Code" size="small" required value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextField label="Name" size="small" required sx={{ flex: 1 }} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Symbol" size="small" required sx={{ width: 80 }} value={form.symbol || ''} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
          <TextField label="Decimals" size="small" type="number" sx={{ width: 100 }} value={form.decimals ?? 2} onChange={(e) => setForm({ ...form, decimals: Number(e.target.value) })} />
          <Button type="submit" variant="contained">Add / Upsert</Button>
        </Stack>
      </form>
      {error && <Alert severity="error">{error}</Alert>}
      <Table size="small">
        <TableHead><TableRow>
          <TableCell>Code</TableCell><TableCell>Name</TableCell><TableCell>Symbol</TableCell><TableCell align="right">Decimals</TableCell>
        </TableRow></TableHead>
        <TableBody>{rows.map((r) => (
          <TableRow key={r.code}><TableCell>{r.code}</TableCell><TableCell>{r.name}</TableCell><TableCell>{r.symbol}</TableCell><TableCell align="right">{r.decimals}</TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </Stack>
  );
}

// ---- Timezones -----------------------------------------------------------

function TimezonesTab() {
  const [rows, setRows] = useState<Timezone[]>([]);
  const [form, setForm] = useState<Partial<Timezone>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() { const r = await lookupsApi.timezones(); setRows(r.data || []); }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { await lookupsApi.createTimezone(form); setForm({}); await load(); }
    catch (err: unknown) { setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed'); }
  }

  return (
    <Stack spacing={3}>
      <form onSubmit={save}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="IANA name" size="small" required placeholder="Asia/Kolkata" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Display name" size="small" required sx={{ flex: 1 }} value={form.display_name || ''} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <TextField label="UTC offset" size="small" required sx={{ width: 110 }} placeholder="+05:30" value={form.utc_offset || ''} onChange={(e) => setForm({ ...form, utc_offset: e.target.value })} />
          <Button type="submit" variant="contained">Add / Upsert</Button>
        </Stack>
      </form>
      {error && <Alert severity="error">{error}</Alert>}
      <Table size="small">
        <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Display</TableCell><TableCell>UTC</TableCell></TableRow></TableHead>
        <TableBody>{rows.map((r) => (
          <TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell>{r.display_name}</TableCell><TableCell>{r.utc_offset}</TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </Stack>
  );
}

// ---- Locales -------------------------------------------------------------

function LocalesTab() {
  const [rows, setRows] = useState<Locale[]>([]);
  const [form, setForm] = useState<Partial<Locale>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() { const r = await lookupsApi.locales(); setRows(r.data || []); }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { await lookupsApi.createLocale(form); setForm({}); await load(); }
    catch (err: unknown) { setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed'); }
  }

  return (
    <Stack spacing={3}>
      <form onSubmit={save}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Code" size="small" required placeholder="en-IN" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextField label="Name" size="small" required sx={{ flex: 1 }} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Native name" size="small" sx={{ flex: 1 }} value={form.native_name || ''} onChange={(e) => setForm({ ...form, native_name: e.target.value })} />
          <Button type="submit" variant="contained">Add / Upsert</Button>
        </Stack>
      </form>
      {error && <Alert severity="error">{error}</Alert>}
      <Table size="small">
        <TableHead><TableRow><TableCell>Code</TableCell><TableCell>Name</TableCell><TableCell>Native</TableCell></TableRow></TableHead>
        <TableBody>{rows.map((r) => (
          <TableRow key={r.code}><TableCell>{r.code}</TableCell><TableCell>{r.name}</TableCell><TableCell>{r.native_name || '—'}</TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </Stack>
  );
}
