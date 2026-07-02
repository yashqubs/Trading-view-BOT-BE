// PM2 process manager config (Section 16/18 of PROJECT_DOCUMENTATION.md).
// Single fork instance only — IG session state and the in-memory secrets
// cache are per-process; running multiple instances would create competing
// IG sessions and could double-process webhook signals.
module.exports = {
  apps: [
    {
      name: 'trading_view_bot',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      // PM2's default kill_timeout (1.6s) is shorter than the app's own
      // graceful-shutdown drain (InFlightSignalTracker waits up to 15s for
      // an in-flight signal to finish before exiting — see main.ts's
      // app.enableShutdownHooks()). Without raising this, PM2 SIGKILLs the
      // process before that drain can ever complete, defeating it entirely.
      kill_timeout: 16000,
      env: {
        NODE_ENV: 'production',
      },
      time: true,
    },
  ],
};
