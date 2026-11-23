'use strict';

const format = new Intl.NumberFormat('ru');
const decimal = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
const status = document.getElementById('status');
const reload = document.getElementById('reload');
const show = (id, value) => { document.getElementById(id).textContent = value; };

async function refresh() {
  reload.disabled = true;
  status.textContent = 'Загрузка…';
  try {
    const response = await fetch('/metrics', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Metrics unavailable');
    const { uptimeSeconds, requests, serverErrors, memory, cpu } = await response.json();
    show('uptime', `${format.format(uptimeSeconds)} с`);
    show('requests', format.format(requests));
    show('errors', format.format(serverErrors));
    show('memory', `${decimal.format(memory.rssBytes / 1048576)} МиБ`);
    show('heap', `${decimal.format(memory.heapUsedBytes / 1048576)} МиБ`);
    show('cpu', `${decimal.format(cpu.userSeconds + cpu.systemSeconds)} с`);
    status.textContent = 'Данные обновлены в ' + new Date().toLocaleTimeString('ru');
  } catch {
    status.textContent = 'Метрики недоступны. Попробуйте обновить страницу.';
  } finally {
    reload.disabled = false;
  }
}

reload.addEventListener('click', refresh);
refresh();
