// Custom Persona Builder — UI layer (Workstream B drawer).
// Mounts a <dialog> with dimension knobs that compose a recipe and feed it
// into the running sandbox via the existing state machine. Lightweight on
// purpose — the engine (recipe + expand) lives in src/persona-builder/.

import { RECIPE_DEFAULTS, validateRecipe } from '../persona-builder/recipe.js';
import { expandRecipe } from '../persona-builder/expand.js';
import { downloadCustomFixtureZip } from '../persona-builder/export-zip.js';
import {
  INCOME_BANDS,
  SPEND_INTENSITIES,
  DISTRESS_LEVELS,
  CARD_LIMITS,
  CASH_FLOW_BANDS,
  STRESS_TAGS,
} from '../persona-builder/dimensions.js';

const SEGMENTS = ['Retail', 'SME', 'Corporate'];
const ACCOUNT_KINDS = ['CurrentAccount', 'Savings', 'CreditCard', 'Mortgage', 'Finance'];
const PARTY_TYPES = ['Sole', 'Joint', 'Delegate'];
const ACCOUNT_ROLES = [
  'Principal', 'SecondaryOwner', 'PowerOfAttorney',
  'SeniorManagingOfficial', 'Administrator',
  'Beneficiary', 'CustodianForMinor',
];

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v == null || v === false) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  if (opts.onChange) node.addEventListener('change', opts.onChange);
  if (opts.onInput) node.addEventListener('input', opts.onInput);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function row(label, control, help) {
  return el('label', { class: 'builder-row' },
    el('span', { class: 'builder-row-label', text: label }),
    control,
    help ? el('span', { class: 'builder-row-help', text: help }) : null
  );
}

function selectFor(name, options, current, onChange) {
  const sel = el('select', { class: 'builder-control', attrs: { name } });
  for (const opt of options) {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    sel.appendChild(el('option', { text: label, attrs: { value, selected: value === current } }));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function checkbox(name, current, onChange) {
  const wrap = el('label', { class: 'builder-checkbox' });
  const input = el('input', { attrs: { type: 'checkbox', name, checked: !!current } });
  input.addEventListener('change', () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(' '));
  return { wrap, input };
}

function checkboxGroup(name, options, current, onChange) {
  const set = new Set(current);
  const wrap = el('div', { class: 'builder-checkgroup', attrs: { role: 'group', 'aria-label': name } });
  for (const opt of options) {
    const cb = el('input', {
      attrs: {
        type: 'checkbox',
        name,
        value: opt,
        checked: set.has(opt),
      },
    });
    const label = el('label', { class: 'builder-checkgroup-item' }, cb, document.createTextNode(' ' + opt));
    cb.addEventListener('change', () => {
      if (cb.checked) set.add(opt);
      else set.delete(opt);
      onChange([...set]);
    });
    wrap.appendChild(label);
  }
  return wrap;
}

function poolOptionsFromIndex(indexed) {
  return Object.keys(indexed ?? {}).sort();
}

export function mountPersonaBuilder({ pools, currentRecipe, onApply }) {
  const dialog = document.getElementById('builder-dialog');
  if (!dialog) return null;

  const body = document.getElementById('builder-body');
  const validation = document.getElementById('builder-validation');
  const closeBtn = document.getElementById('builder-close');
  const cancelBtn = document.getElementById('builder-cancel');
  const form = document.getElementById('builder-form');

  let recipe = { ...RECIPE_DEFAULTS, ...(currentRecipe ?? {}) };

  function update(patch) {
    recipe = { ...recipe, ...patch };
    revalidate();
  }

  function revalidate() {
    const v = validateRecipe(recipe, pools);
    if (v.ok) {
      validation.textContent = '';
      validation.classList.remove('has-error');
    } else {
      validation.textContent = v.errors[0];
      validation.classList.add('has-error');
    }
  }

  function render() {
    body.replaceChildren();

    body.appendChild(el('h3', { class: 'builder-section', text: '1. Segment' }));
    body.appendChild(row(
      'Segment',
      selectFor('segment', SEGMENTS, recipe.segment, (v) => {
        update({ segment: v });
        render();
      }),
      'Drives AccountType + PartyCategory throughout the bundle.'
    ));

    body.appendChild(el('h3', { class: 'builder-section', text: '2. Identity' }));
    const namePoolOptions = poolOptionsFromIndex(pools.namesByPoolId);
    body.appendChild(row(
      'Calling user — name pool',
      selectFor('name_pool', namePoolOptions, recipe.name_pool, (v) => update({ name_pool: v })),
      'Drawn from /synthetic-identity-pool/names/.'
    ));
    body.appendChild(row(
      'Age band',
      selectFor('age_band', ['22-27', '28-38', '39-50', '51-65', '65-72'], recipe.age_band, (v) => update({ age_band: v })),
    ));
    body.appendChild(row(
      'Emirate',
      selectFor('emirate', ['dubai', 'abu_dhabi', 'sharjah', 'other'], recipe.emirate, (v) => update({ emirate: v })),
    ));

    if (recipe.segment !== 'Retail') {
      const orgPoolOptions = poolOptionsFromIndex(pools.organisationsByPoolId);
      body.appendChild(el('h3', { class: 'builder-section', text: '3. Organisation' }));
      body.appendChild(row(
        'Legal-name pool',
        selectFor('legal_name_pool', orgPoolOptions, recipe.legal_name_pool, (v) => update({ legal_name_pool: v })),
        'Drawn from /synthetic-identity-pool/organisations/.'
      ));
      body.appendChild(row(
        'Signatory — name pool',
        selectFor('signatory_pool', namePoolOptions, recipe.signatory_pool, (v) => update({ signatory_pool: v })),
      ));
      body.appendChild(row(
        'Signatory — AccountRole',
        selectFor('signatory_account_role', ACCOUNT_ROLES, recipe.signatory_account_role, (v) =>
          update({ signatory_account_role: v })),
        'Spec enum (AEExternalAccountRoleCode).'
      ));
      body.appendChild(row(
        'Signatory — PartyType',
        selectFor('signatory_party_type', PARTY_TYPES, recipe.signatory_party_type, (v) =>
          update({ signatory_party_type: v })),
        'Spec enum (AEExternalPartyTypeCode).'
      ));
    }

    body.appendChild(el('h3', { class: 'builder-section', text: `${recipe.segment !== 'Retail' ? '4' : '3'}. Financial profile` }));

    if (recipe.segment === 'Retail') {
      const employerPoolOptions = poolOptionsFromIndex(pools.employersByPoolId);
      body.appendChild(row(
        'Employer pool',
        selectFor('employer_pool', employerPoolOptions, recipe.employer_pool, (v) => update({ employer_pool: v })),
      ));
      body.appendChild(row(
        'Income band',
        selectFor('income_band', Object.keys(INCOME_BANDS), recipe.income_band, (v) => update({ income_band: v })),
        Object.entries(INCOME_BANDS)
          .map(([k, v]) => `${k}=AED ${v.monthly_amount_aed.toLocaleString()}`)
          .join(' · ')
      ));
      const fp = checkbox('flag_payroll', recipe.flag_payroll, (b) => update({ flag_payroll: b }));
      body.appendChild(row('Salary carries Flags=Payroll', fp.wrap));
    } else {
      body.appendChild(row(
        'Cash-flow intensity',
        selectFor('cash_flow_intensity', ['low', 'med', 'high'], recipe.cash_flow_intensity, (v) =>
          update({ cash_flow_intensity: v })),
        cashFlowSummary(recipe.segment)
      ));
      const cpPoolOptions = poolOptionsFromIndex(pools.counterpartiesByPoolId);
      body.appendChild(row(
        'Customer-inflow counterparty pool',
        selectFor('customer_inflow_pool', cpPoolOptions, recipe.customer_inflow_pool, (v) =>
          update({ customer_inflow_pool: v })),
      ));
      body.appendChild(row(
        'Supplier-outflow counterparty pool',
        selectFor('supplier_outflow_pool', cpPoolOptions, recipe.supplier_outflow_pool, (v) =>
          update({ supplier_outflow_pool: v })),
      ));
      body.appendChild(row(
        'Invoice cadence',
        selectFor('invoice_cadence', ['weekly', 'biweekly', 'monthly', 'irregular'], recipe.invoice_cadence,
          (v) => update({ invoice_cadence: v })),
      ));
    }

    body.appendChild(row(
      'Products',
      checkboxGroup('products', ACCOUNT_KINDS, recipe.products, (arr) => update({ products: arr })),
      'Each becomes one account in the bundle.'
    ));
    if (recipe.products?.includes('CreditCard')) {
      body.appendChild(row(
        'Credit-card limit band',
        selectFor('card_limit', Object.keys(CARD_LIMITS), recipe.card_limit, (v) => update({ card_limit: v })),
        Object.entries(CARD_LIMITS).map(([k, v]) => `${k}=AED ${v.toLocaleString()}`).join(' · ')
      ));
    }
    body.appendChild(row(
      'Spend intensity',
      selectFor('spend_intensity', Object.keys(SPEND_INTENSITIES), recipe.spend_intensity, (v) =>
        update({ spend_intensity: v })),
    ));
    body.appendChild(row(
      'Distress level',
      selectFor('distress', Object.keys(DISTRESS_LEVELS), recipe.distress, (v) => update({ distress: v })),
      Object.entries(DISTRESS_LEVELS).map(([k, [lo, hi]]) => `${k}=${lo}-${hi}/yr NSF`).join(' · ')
    ));
    const fxBox = checkbox('fx_activity', recipe.fx_activity, (b) => update({ fx_activity: b }));
    body.appendChild(row('FX-active (cross-currency flows)', fxBox.wrap));
    const cashBox = checkbox('cash_deposit', recipe.cash_deposit, (b) => update({ cash_deposit: b }));
    body.appendChild(row('Cash-deposit activity', cashBox.wrap));

    body.appendChild(el('h3', { class: 'builder-section', text: `${recipe.segment !== 'Retail' ? '5' : '4'}. Stress tags (advisory)` }));
    body.appendChild(checkboxGroup('stress_tags', STRESS_TAGS, recipe.stress_tags ?? [], (arr) =>
      update({ stress_tags: arr })));

    revalidate();
  }

  function cashFlowSummary(segment) {
    const t = CASH_FLOW_BANDS[segment];
    if (!t) return '';
    const med = t.med;
    return `med ≈ AED ${med.customer[0].toLocaleString()}–${med.customer[1].toLocaleString()}/mo customer inflow`;
  }

  function close() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  closeBtn.onclick = close;
  cancelBtn.onclick = close;

  // Workstream C plug-point 3 — "Download static fixtures" emits a
  // layout-identical /fixtures/v1/bundles/<persona>/... zip the TPP can
  // host on their own static origin (works for any language / framework,
  // no JS runtime required). Wired up if the host page has the button.
  const downloadBtn = document.getElementById('builder-download-zip');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const v = validateRecipe(recipe, pools);
      if (!v.ok) {
        validation.textContent = v.errors[0];
        validation.classList.add('has-error');
        return;
      }
      try {
        downloadCustomFixtureZip({ recipe, pools, seed: 1 });
      } catch (err) {
        validation.textContent = `download failed: ${String(err.message ?? err)}`;
        validation.classList.add('has-error');
      }
    };
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const v = validateRecipe(recipe, pools);
    if (!v.ok) return;
    try {
      const persona = expandRecipe(recipe, pools);
      onApply({ recipe, persona });
      close();
    } catch (err) {
      validation.textContent = String(err.message ?? err);
      validation.classList.add('has-error');
    }
  };

  function open(seedRecipe) {
    recipe = { ...RECIPE_DEFAULTS, ...(seedRecipe ?? {}) };
    render();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  return { open };
}
