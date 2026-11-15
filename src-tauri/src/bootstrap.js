const invoke = (command) => window.__TAURI_INTERNALS__.invoke(command);
const start = document.querySelector('#start');
const cancel = document.querySelector('#cancel');
const progress = document.querySelector('progress');
const status = document.querySelector('#status');
start.onclick = async () => {
  start.disabled = true;
  try { await invoke('bootstrap_start'); }
  catch (error) { status.textContent = String(error); start.disabled = false; }
};
cancel.onclick = () => invoke('bootstrap_cancel');
async function poll() {
  try {
    const state = await invoke('bootstrap_status');
    const busy = state.status === 'installing' || state.status === 'retrying';
    status.textContent = state.message;
    progress.hidden = !busy;
    cancel.hidden = !busy;
    start.disabled = busy;
    start.textContent = state.status === 'needed' ? 'Set up Tangent' : 'Resume setup';
  } catch (error) { status.textContent = String(error); }
  setTimeout(poll, 300);
}
poll();
