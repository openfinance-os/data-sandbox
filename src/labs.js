import { track } from './analytics.js';
const { labs, corpusVersion, referenceDate } = await fetch('../dist/labs.json').then((r) =>
  r.json(),
);
document.getElementById('context').textContent =
  `Corpus ${corpusVersion}; reference ${referenceDate}. Five minutes to a first result is a target awaiting user validation.`;
for (const lab of labs) {
  const section = document.createElement('section');
  section.style.marginBlock = '2rem';
  const title = document.createElement('h2');
  title.textContent = lab.title;
  const task = document.createElement('p');
  task.textContent = lab.task;
  const command = document.createElement('pre');
  command.style.whiteSpace = 'pre-wrap';
  command.textContent = `npm ci\nnpm run build:site\n${lab.commands}`;
  const link = document.createElement('a');
  link.href = `index.html?persona=${lab.persona}&corpus=${corpusVersion}`;
  link.textContent = 'Explore this persona';
  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.textContent = 'Inspect answer key';
  const answer = document.createElement('pre');
  answer.style.whiteSpace = 'pre-wrap';
  reveal.addEventListener('click', async () => {
    const keys = await fetch('../dist/lab-answers.json').then((r) => r.json());
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
  section.append(title, task, command, link, document.createElement('br'), reveal, done, answer);
  document.getElementById('labs').append(section);
}
