// Atualização automática pelo GitHub Releases (electron-updater): confere ao abrir e a cada 6 h,
// e também quando você clica em "Procurar atualização" na aba Config. Baixa em segundo plano e avisa
// no topo do app. O instalador novo só entra quando você clicar em "Reiniciar e atualizar" ou ao fechar
// o app. Cada arquivo vem com SHA-512 no latest.yml e é conferido.
const { app, ipcMain } = require('electron');

let janela = null;
let updater = null;
let ultimo = { estado: 'parado' };

// Mensagem curta para o que deu errado: Release incompleta no GitHub ou sem internet.
const motivo = (err) => {
  const m = String((err && err.message) || '');
  if (/404|latest\.yml|Cannot find/i.test(m)) return 'A versão mais recente no GitHub está incompleta (falta o latest.yml ou o instalador).';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|net::|network/i.test(m)) return 'Sem conexão com o GitHub agora.';
  return 'Não deu para procurar agora.';
};

const avisar = (dados) => {
  ultimo = { ...ultimo, ...dados };
  if (janela && !janela.isDestroyed()) janela.webContents.send('atualizacao', ultimo);
};

function conferir() {
  if (!updater) return Promise.resolve();
  if (ultimo.estado === 'baixando' || ultimo.estado === 'pronta') return Promise.resolve(); // já tem uma a caminho
  avisar({ estado: 'procurando', erro: null });
  return updater.checkForUpdates().catch((err) => avisar({ estado: 'erro', erro: motivo(err) }));
}

ipcMain.handle('atualizacao:info', () => ({ versao: app.getVersion(), instalado: app.isPackaged, ...ultimo }));
ipcMain.handle('atualizacao:checar', () => {
  if (!app.isPackaged) return { estado: 'dev' };
  conferir();
  return ultimo;
});
ipcMain.handle('atualizacao:instalar', () => { if (updater && ultimo.estado === 'pronta') updater.quitAndInstall(false, true); });

let iniciado = false;
function iniciar(win) {
  janela = win;
  if (iniciado || !app.isPackaged) return; // rodando pelo código-fonte não há o que atualizar
  iniciado = true;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (i) => avisar({ estado: 'baixando', versao: i.version, pct: 0 }));
  updater.on('update-not-available', () => avisar({ estado: 'atualizado', verificadoEm: Date.now() }));
  updater.on('download-progress', (p) => avisar({ estado: 'baixando', pct: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (i) => avisar({ estado: 'pronta', versao: i.version }));
  updater.on('error', (err) => {
    console.warn('[atualizacao]', err && err.message);
    if (ultimo.estado !== 'pronta') avisar({ estado: 'erro', erro: motivo(err) });
  });
  setTimeout(conferir, 15_000);
  setInterval(conferir, 6 * 3_600_000);
}

module.exports = { iniciar };
