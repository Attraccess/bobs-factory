# Independent self-hosting

Install a verified binary and prepare/authenticate Git, delivery CLI and selected
coding agents. Local startup uses `bobs-factory --repo PATH --agent codex`.
Configured startup uses `bobs-factory --home ~/.bobs-factory start` and
`<home>/config.json`. See [configuration](CONFIG_FILE.md).

For Linear, create your own OAuth app and configure `LINEAR_CLIENT_ID`,
`LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`, `BOBS_FACTORY_BASE_URL` and
`BOBS_FACTORY_HOST_EXTERNAL=true`. Use `bobs-factory self-auth-linear`, then
`self-add-repo URL WORKSPACE`. Provider credentials remain under your control.
Use the canonical setup skills for GitHub, GitLab and Slack integrations. No
upstream hosted enrollment, auth key or paid control service is supported.

The dashboard binds to loopback on 3457. OAuth/webhooks normally use port 3456
(or local repository launcher port + 1). Expose only the webhook listener through
your existing ingress. ngrok remains supported; zrok2 (#39) is separate work.
A tunnel does not authorize public dashboard access; remote protection (#40)
and independent identity overlays (#57) remain separate work. Preserve existing
PWA secure-origin/version guard limitations.

## Linux systemd (user service)

Replace the executable, home and working directory with absolute paths owned by
this service account. Put this in `~/.config/systemd/user/bobs-factory.service`:

```ini
[Unit]
Description=Bob’s Factory
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/USER
ExecStart=/home/USER/.local/bin/bobs-factory --home /home/USER/.bobs-factory start
Restart=on-failure
TimeoutStopSec=120

[Install]
WantedBy=default.target
```

Run `systemctl --user daemon-reload` then `systemctl --user enable --now
bobs-factory`. For upgrades/migration, disable automatic restart and verify agents
and descendants stopped. A system-level service needs an explicit `User=`.

## macOS launchd

Place an approved definition in `~/Library/LaunchAgents/de.attraccess.bobs-factory.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>de.attraccess.bobs-factory</string>
<key>ProgramArguments</key><array>
<string>/Users/USER/.local/bin/bobs-factory</string>
<string>--home</string><string>/Users/USER/.bobs-factory</string><string>start</string>
</array>
<key>WorkingDirectory</key><string>/Users/USER</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/Users/USER/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>KeepAlive</key><true/>
<key>RunAtLoad</key><true/>
</dict></plist>
```

Use `launchctl bootstrap gui/$(id -u) PATH_TO_PLIST` after replacing USER and
validating the paths. Use `bootout` before upgrades/migration so KeepAlive cannot
restart the old consumer. Retain original definitions and credentials for recovery.
