// Some Electron-based terminals inherit this flag; it must not reach our app.
delete process.env.ELECTRON_RUN_AS_NODE
const { spawn } = require('node:child_process')
const path = require('node:path')
const mode = process.argv[2] || 'dev'
const child = spawn(process.execPath, [path.join(__dirname, '../node_modules/electron-vite/bin/electron-vite.js'), mode], {
  cwd: path.join(__dirname, '..'), env: process.env, stdio: 'inherit'
})
child.on('exit', code => process.exit(code ?? 1))
child.on('error', error => { console.error(error.message); process.exit(1) })
