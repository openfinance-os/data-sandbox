import { track } from './analytics.js';
import { incomeAndCommitments, reconcileSweeps, insuranceCommitments } from './core/analysis.js';

// Each lab reads the published static fixtures (wire payloads only) and runs the
// same calculation as examples/labs/run.mjs, so a result can be checked against
// the answer key without installing anything.
const FIXTURES = '../fixtures/v1/';
const PROFILES = ['rich', 'median', 'sparse'];
const { labs, corpusVersion, referenceDate } = await fetch('../dist/labs.json').then((r) =>
  r.json(),
);
let answerKeys;
const loadAnswers = () =>
  (answerKeys ??= fetch('../dist/lab-answers.json').then((r) => {
    if (!r.ok) throw new Error(`answer key: HTTP ${r.status}`);
    return r.json();
  }));

document.getElementById('context').textContent =
  `Corpus ${corpusVersion} · reference date ${referenceDate.slice(0, 10)}. Every figure below is computed from synthetic payloads.`;

async function readEnvelopes(paths) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([endpoint, rel]) => {
      const response = await fetch(FIXTURES + rel);
      if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
      return [endpoint, await response.json()];
    }),
  );
  return Object.fromEntries(entries);
}

async function runLab(lab, lfi) {
  const { primary, roles } = lab.sources[lfi];
  const envelopes = await readEnvelopes(primary);
  if (lab.id === 'income') return incomeAndCommitments(envelopes);
  if (lab.id === 'cover') {
    return { banking: incomeAndCommitments(envelopes), insurance: insuranceCommitments(envelopes) };
  }
  if (lab.id === 'reconciliation') {
    const roleJourneys = {};
    for (const [role, paths] of Object.entries(roles))
      roleJourneys[role] = await readEnvelopes(paths);
    return reconcileSweeps(envelopes, roleJourneys);
  }
  // consent: the static fixtures can only show the authorised read; the revocation
  // step is simulated here. `npm run mock` returns a real HTTP 403 for it.
  const [first] = Object.values(envelopes);
  return {
    observedBeforeRevocation: first.Data.Transaction.length,
    revoked: 403,
    simulated: true,
    authority: 'API Hub',
    decision: 'insufficient-authority',
    currentFinancialAnswer: null,
    instruction: 'Do not present cached observations as a currently authorised result.',
  };
}

function summarise(lab, result) {
  const income = (r) =>
    r.byCurrency.length
      ? r.byCurrency
          .map(
            (g) =>
              `${g.currency}: income ${g.income}, fixed commitments ${g.commitments}, remainder ${g.remainder}`,
          )
          .join('; ') +
        `. ${r.unknownClassificationCount} of ${r.bookedCount} booked rows in ${r.month} carry no classification.`
      : `No classified rows in ${r.month}; ${r.unknownClassificationCount} of ${r.bookedCount} booked rows carry no classification.`;
  if (lab.id === 'income') return income(result);
  if (lab.id === 'cover') {
    return `${result.insurance.policies.length} insurance policies observed. Banking: ${income(result.banking)}`;
  }
  if (lab.id === 'reconciliation') {
    return `${result.matched.length} cross-bank sweeps matched, ${result.unresolved.length} unresolved (status: ${result.status}).`;
  }
  return `${result.observedBeforeRevocation} transactions read while consent was valid. After revocation the API Hub answers 403, so the current answer is withheld. The revocation step is simulated here; the local mock returns a real HTTP 403.`;
}

for (const lab of labs) {
  const section = document.createElement('section');
  section.className = 'lab';
  section.setAttribute('aria-labelledby', `lab-${lab.id}`);
  const title = document.createElement('h2');
  title.id = `lab-${lab.id}`;
  title.textContent = lab.title;
  const task = document.createElement('p');
  task.textContent = lab.task;

  const controls = document.createElement('div');
  controls.className = 'lab-controls';
  const profileLabel = document.createElement('label');
  profileLabel.textContent = 'Data profile';
  const profile = document.createElement('select');
  for (const lfi of PROFILES) {
    const option = document.createElement('option');
    option.value = lfi;
    option.textContent = lfi[0].toUpperCase() + lfi.slice(1);
    profile.append(option);
  }
  profileLabel.append(profile);
  const run = document.createElement('button');
  run.type = 'button';
  run.textContent = 'Run in browser';
  const explore = document.createElement('a');
  explore.href = `index.html?persona=${lab.persona}&corpus=${corpusVersion}`;
  explore.textContent = 'Explore this persona';
  controls.append(profileLabel, run, explore);

  const output = document.createElement('div');
  output.setAttribute('aria-live', 'polite');
  const summary = document.createElement('p');
  summary.className = 'lab-summary';
  const check = document.createElement('p');
  check.className = 'lab-check';
  const result = document.createElement('pre');
  result.dataset.result = lab.id;
  result.tabIndex = 0;
  output.append(summary, check, result);

  run.addEventListener('click', async () => {
    const lfi = profile.value;
    run.disabled = true;
    summary.textContent = 'Running…';
    check.textContent = '';
    result.textContent = '';
    try {
      const value = await runLab(lab, lfi);
      summary.textContent = summarise(lab, value);
      result.textContent = JSON.stringify(value, null, 2);
      if (lab.id !== 'consent') {
        const expected = (await loadAnswers())[lab.id][lfi];
        check.textContent =
          JSON.stringify(expected) === JSON.stringify(value)
            ? `Matches the answer key for the ${lfi} profile.`
            : `Differs from the answer key for the ${lfi} profile.`;
      }
    } catch (err) {
      summary.textContent = `Could not run this lab: ${err.message}`;
    } finally {
      run.disabled = false;
    }
  });

  const local = document.createElement('details');
  const localSummary = document.createElement('summary');
  localSummary.textContent = 'Run it locally instead';
  const command = document.createElement('pre');
  command.tabIndex = 0;
  command.textContent = `npm ci\nnpm run build:site\n${lab.commands}`;
  local.append(localSummary, command);

  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.textContent = 'Inspect answer key';
  const answer = document.createElement('pre');
  answer.dataset.answer = lab.id;
  answer.tabIndex = 0;
  reveal.addEventListener('click', async () => {
    const keys = await loadAnswers();
    answer.textContent = JSON.stringify(keys[lab.id], null, 2);
    track('lab_answer_view', { lab_id: lab.id });
  });
  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = 'I reproduced the result';
  done.addEventListener('click', () => {
    track('lab_complete', { lab_id: lab.id });
    done.textContent = 'Marked complete for this session';
    done.disabled = true;
  });
  const keyControls = document.createElement('div');
  keyControls.className = 'lab-controls';
  keyControls.append(reveal, done);

  section.append(title, task, controls, output, local, keyControls, answer);
  document.getElementById('labs').append(section);
}
