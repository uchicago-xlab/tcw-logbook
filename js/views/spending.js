// Spending — bespoke ledger over Project/Planning/spending.json.
// Statuses: spent (money used), burned (money wasted), allocated (committed,
// unused). Spent/burned entries may draw down an allocation via allocationId;
// remaining balances and all totals are computed, never stored. Every change
// is one commit; conflicts are detected via the file's sha like the editor.
import { h, clear, chip, toast } from '../ui.js';
import { getFile, putFile } from '../github.js';
import { cached, revalidate, invalidate } from '../cache.js';
import { currentUser } from '../state.js';

const FILE = 'Project/Planning/spending.json';
const STATUSES = ['spent', 'burned', 'allocated'];

const fetchLedger = async () => JSON.parse((await getFile(FILE)).text);

export async function renderSpending() {
  const container = h('div');
  const formSlot = h('div');
  const count = h('span');
  let entries = [];

  // Redraw from a background refetch — but never over an open form.
  function applyFresh(data) {
    if (!document.body.contains(container) || formSlot.firstChild) return;
    entries = data.entries;
    draw();
  }

  let data;
  try {
    data = await cached('spending', fetchLedger, applyFresh);
  } catch (err) {
    if (err.status === 404) {
      return h('div.card', {},
        h('h2', {}, 'Spending ledger not found'),
        h('div.hint', { style: 'margin:0' },
          `Expected ${FILE} in the notes folder — commit it (see Planning/Spending) to start tracking.`));
    }
    throw err;
  }
  entries = data.entries;

  function draw() {
    const totals = computeTotals(entries);
    count.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
    clear(container).append(
      tiles(totals),
      entries.length
        ? ledgerTable(entries, totals, { onEdit: openForm, onDelete: del })
        : h('div.card', {}, h('div.hint', { style: 'margin:0' }, 'No entries yet — add the first one with “+ Add entry”.')),
    );
  }

  // The single write path. Always fetches fresh: the sha drives conflict
  // detection, and applying the mutation to just-read data means concurrent
  // edits to different entries merge naturally.
  async function commitChange(mutate, message) {
    const f = await getFile(FILE);
    const fresh = JSON.parse(f.text);
    mutate(fresh.entries);
    await putFile(FILE, JSON.stringify(fresh, null, 2) + '\n', message, f.sha);
    entries = fresh.entries;
    invalidate('spending');
    revalidate('spending', fetchLedger).then((d) => d && applyFresh(d)).catch(() => {});
    draw();
  }

  function openForm(entry = null) {
    clear(formSlot).append(entryForm(entry, () => clear(formSlot)));
    formSlot.scrollIntoView({ block: 'nearest' });
  }

  async function del(entry) {
    const uses = entries.filter((e) => e.allocationId === entry.id).length;
    if (uses) {
      toast(`${uses} drawdown${uses > 1 ? 's' : ''} reference this allocation — unlink them first.`, 'error');
      return;
    }
    if (!confirm(`Delete "${trunc(entry.what)}" (${fmt(entry.amount, entry.approx)})?`)) return;
    const user = await currentUser().catch(() => null);
    try {
      await commitChange((list) => {
        const i = list.findIndex((e) => e.id === entry.id);
        if (i < 0) throw new Error('This entry was already deleted.');
        if (list.some((e) => e.allocationId === entry.id)) {
          throw new Error('Drawdowns reference this allocation — unlink them first.');
        }
        list.splice(i, 1);
      }, `Spending: delete ${fmt(entry.amount)} ${entry.status} — ${trunc(entry.what)}${by(user)}`);
      toast('Entry deleted ✓');
    } catch (err) {
      toast(conflict(err) ? 'Conflict: the ledger changed — try again.' : `Couldn't delete: ${err.message}`, 'error');
    }
  }

  function entryForm(entry, onClose) {
    const isEdit = !!entry;
    const today = new Date().toISOString().slice(0, 10);
    const totals = computeTotals(entries);

    const date = h('input', { type: 'date', value: entry?.date || today });
    const what = h('input', { type: 'text', placeholder: 'What — tie it to an experiment', autocomplete: 'off', value: entry?.what || '' });
    const who = h('input', { type: 'text', placeholder: 'Who', autocomplete: 'off', value: entry?.who || '', style: 'width:110px' });
    const amount = h('input', { type: 'number', min: '0.01', step: '0.01', placeholder: '0.00', value: entry?.amount ?? '', style: 'width:110px' });
    const approx = h('input', { type: 'checkbox', ...(entry?.approx ? { checked: '' } : {}) });

    // An allocation with drawdowns must stay an allocation — changing its
    // status would orphan the entries drawn from it.
    const locked = isEdit && entry.status === 'allocated' && entries.some((e) => e.allocationId === entry.id);
    const status = h('select', {
      ...(locked ? { disabled: '', title: 'Drawdowns reference this allocation — unlink them to change its status.' } : {}),
      onchange: () => { allocWrap.style.display = status.value === 'allocated' ? 'none' : ''; warning.textContent = ''; warned = false; },
    }, STATUSES.map((s) => h('option', { value: s, ...(s === (entry?.status || 'spent') ? { selected: '' } : {}) }, s)));

    const allocOptions = entries.filter((e) => e.status === 'allocated' && e.id !== entry?.id);
    const alloc = h('select', {},
      h('option', { value: '' }, '— no allocation —'),
      allocOptions.map((a) => {
        const r = totals.remaining.get(a.id);
        return h('option', {
          value: a.id,
          ...(a.id === entry?.allocationId ? { selected: '' } : {}),
        }, `${trunc(a.what, 36)} (${fmt(r.value, r.approx)} left)`);
      }));
    const allocWrap = h('span', { style: (entry?.status || 'spent') === 'allocated' ? 'display:none' : '' }, alloc);

    const warning = h('div.hint', { style: 'flex-basis:100%;margin:0;color:var(--danger)' });
    let warned = false;

    const save = h('button', { class: 'primary' }, isEdit ? 'Save' : 'Add');
    const submit = async () => {
      if (!what.value.trim()) { what.focus(); return; }
      if (!date.value) { date.focus(); return; }
      const amt = Number(amount.value);
      if (!Number.isFinite(amt) || amt <= 0) { amount.focus(); return; }
      const fields = {
        date: date.value,
        what: what.value.trim(),
        who: who.value.trim(),
        amount: amt,
        approx: approx.checked,
        status: status.value,
        allocationId: status.value === 'allocated' ? null : (alloc.value || null),
      };

      // Overshooting an allocation warns once, then saves — real spending
      // can exceed what was set aside, and the ledger should record reality.
      if (fields.allocationId && !warned) {
        const r = totals.remaining.get(fields.allocationId);
        const headroom = r.value + (entry?.allocationId === fields.allocationId ? entry.amount : 0);
        if (amt > headroom) {
          warning.textContent = `Exceeds this allocation's remaining ${fmt(Math.max(0, headroom))} — saving records an overshoot. Click again to save anyway.`;
          warned = true;
          return;
        }
      }

      save.disabled = true;
      const user = await currentUser().catch(() => null);
      try {
        if (isEdit) {
          await commitChange((list) => {
            const t = list.find((e) => e.id === entry.id);
            if (!t) throw new Error('This entry was deleted by someone else.');
            if (t.status === 'allocated' && fields.status !== 'allocated' && list.some((e) => e.allocationId === t.id)) {
              throw new Error('Drawdowns reference this allocation — unlink them to change its status.');
            }
            Object.assign(t, fields);
          }, `Spending: edit ${fmt(fields.amount)} ${fields.status} — ${trunc(fields.what)}${by(user)}`);
          toast('Entry saved ✓');
        } else {
          await commitChange((list) => {
            list.push({ id: crypto.randomUUID(), ...fields });
          }, `Spending: add ${fmt(fields.amount)} ${fields.status} — ${trunc(fields.what)}${by(user)}`);
          toast('Entry added ✓');
        }
        onClose();
      } catch (err) {
        save.disabled = false;
        toast(conflict(err) ? 'Conflict: the ledger changed while saving — try again.' : `Couldn't save: ${err.message}`, 'error');
      }
    };
    save.addEventListener('click', submit);
    what.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    const form = h('div.card.task-form', {},
      date, what, who, amount,
      h('label', { style: 'display:flex;align-items:center;gap:5px;margin:0;font-weight:400;font-size:13px' }, approx, '≈'),
      status, allocWrap,
      save,
      h('button', { onclick: onClose }, 'Cancel'),
      warning,
    );
    setTimeout(() => what.focus(), 0);
    return form;
  }

  draw();

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, 'Spending'),
      h('div.grow'),
      h('button', {
        class: 'primary',
        onclick: () => { if (formSlot.firstChild) clear(formSlot); else openForm(); },
      }, '+ Add entry'),
    ),
    h('div.meta-line', {},
      count, ' · every change is one commit to ', h('code', {}, FILE),
      ' · budget context in ', h('a', { href: '#/p/Project/Experiments/ImplementationDetails.md' }, 'ImplementationDetails'), ' §5.'),
    formSlot,
    container,
  );
}

// ---------- accounting ----------
// gone      = Σ spent + burned (drawdowns included — the money is gone)
// remaining = per allocation: amount − Σ linked drawdowns (may go negative)
// unused    = Σ max(0, remaining) — clamping makes committed = gone + unused
//             hold even when an allocation is overshot
function computeTotals(entries) {
  let gone = 0;
  let goneApprox = false;
  const remaining = new Map();
  for (const e of entries) {
    if (e.status === 'allocated') {
      remaining.set(e.id, { value: e.amount, approx: !!e.approx, drawdowns: 0 });
    }
  }
  for (const e of entries) {
    if (e.status === 'allocated') continue;
    gone += e.amount;
    goneApprox = goneApprox || !!e.approx;
    const r = e.allocationId && remaining.get(e.allocationId);
    if (r) {
      r.value -= e.amount;
      r.approx = r.approx || !!e.approx;
      r.drawdowns += 1;
    }
  }
  let unused = 0;
  let unusedApprox = false;
  for (const r of remaining.values()) {
    unused += Math.max(0, r.value);
    unusedApprox = unusedApprox || (r.value > 0 && r.approx);
  }
  return {
    gone, goneApprox,
    unused, unusedApprox,
    committed: gone + unused,
    committedApprox: goneApprox || unusedApprox,
    remaining,
  };
}

function fmt(n, approx = false) {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(Math.round(abs * 100) / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${approx ? '~' : ''}${n < 0 ? '−' : ''}$${s}`;
}

const trunc = (s, n = 50) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const by = (user) => (user ? ` (by @${user.login})` : '');
const conflict = (err) => err.status === 409 || err.status === 422;

// ---------- rendering ----------
function tiles(totals) {
  const tile = (label, value) => h('div.tile', {},
    h('div.tile-num', {}, value),
    h('div.tile-label', {}, label));
  return h('div.tiles', {},
    tile('Spent / burned', fmt(totals.gone, totals.goneApprox)),
    tile('Allocated, unused', fmt(totals.unused, totals.unusedApprox)),
    tile('Total committed', fmt(totals.committed, totals.committedApprox)),
  );
}

function ledgerTable(entries, totals, { onEdit, onDelete }) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  const rows = sorted.map((e) => {
    const r = e.status === 'allocated' ? totals.remaining.get(e.id) : null;
    const source = e.allocationId ? byId.get(e.allocationId) : null;
    return h('tr', {},
      h('td', { style: 'white-space:nowrap' }, e.date),
      h('td', {},
        e.what,
        source ? h('div.spend-remaining', {}, `↳ drawn from: ${trunc(source.what, 60)}`) : null,
      ),
      h('td', {}, e.who),
      h('td.num', {},
        fmt(e.amount, e.approx),
        r ? h('div', { class: `spend-remaining${r.value < 0 ? ' neg' : ''}` },
          r.value < 0
            ? `overdrawn by ${fmt(-r.value, r.approx)}`
            : `${fmt(r.value, r.approx)} remaining`) : null,
      ),
      h('td', {}, chip(e.status)),
      h('td.actions', {},
        h('button', { onclick: () => onEdit(e), title: 'Edit entry' }, 'edit'),
        h('button', { onclick: () => onDelete(e), title: 'Delete entry' }, '×'),
      ),
    );
  });

  return h('div.card', { style: 'padding:6px 8px' },
    h('table.ledger', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Date'), h('th', {}, 'What'), h('th', {}, 'Who'),
        h('th.num', {}, 'Amount'), h('th', {}, 'Status'), h('th'))),
      h('tbody', {}, rows),
    ));
}
